import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { access, chmod, type FileHandle, open, realpath, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
// XEON-PATCH: P15
import { attempt, attemptAsync, repeatAsync } from "@xeon/contracts";
import { pathToFileURL } from "node:url";
// XEON-PATCH: P4
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
// XEON-PATCH: P5
import type { CancelScope } from "@xeon/contracts/services";
// XEON-PATCH: P3
import { createWin32Provider } from "../../src/providers/win32.ts";
import {
  FileError,
  getOrThrow,
  type ShellExecOptions,
  type TextLine,
} from "../../src/upstream/env/index.ts";
import { NodeExecutionEnv } from "../../src/upstream/env/node.ts";
import { errnoCodeOf } from "../support/errno.ts";
import { hostPlatform } from "../support/platform.ts";

// XEON-PATCH: P5
const BACKGROUND_CONTEXT: CancelScope = { abortSignal: undefined };
// XEON-PATCH: P3
const platform = hostPlatform();

const tempDirs: string[] = [];
const chmodRestorePaths: string[] = [];

function createTempDir(): string {
  const dir = join(tmpdir(), `pi-durable-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/**
 * Remove a test directory. On Windows, `taskkill /T` runs asynchronously and can miss descendants such as Git Bash's
 * `sleep`, so a killed command's processes can hold the directory for a while after `exec` settles; retry until they
 * exit.
 */
async function removeTempDir(dir: string): Promise<void> {
  let attempt = 0;
  // XEON-PATCH: P15
  await repeatAsync<undefined>(async () => {
    try {
      rmSync(dir, { recursive: true, force: true });
      return { value: undefined };
    } catch (error) {
      // XEON-PATCH: P14
      const code = errnoCodeOf(error);
      if (attempt >= 80 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY"))
        throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return undefined;
    }
  });
}

function abortedContext() {
  const controller = new AbortController();
  controller.abort();
  // XEON-PATCH: P5
  return { abortSignal: controller.signal };
}

// XEON-PATCH: P14
function isFileHandle(value: unknown): value is FileHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    typeof value.read === "function" &&
    "close" in value &&
    typeof value.close === "function"
  );
}

async function fileHandlePrototype(path: string): Promise<FileHandle> {
  const handle = await open(path, "r");
  await handle.close();
  // XEON-PATCH: P14
  const prototype: unknown = Object.getPrototypeOf(handle);
  if (!isFileHandle(prototype)) throw new Error("FileHandle prototype has no read and close");
  return prototype;
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // XEON-PATCH: P15
  await repeatAsync<undefined>(async () => {
    if (await condition()) return { value: undefined };
    if (Date.now() > deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return undefined;
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    // XEON-PATCH: P15
    promise.finally(() => clearTimeout(timeoutId)).then(resolve, reject);
  });
}

async function collectShellOutput(
  env: NodeExecutionEnv,
  command: string,
  options: ShellExecOptions | undefined,
  context: Parameters<NodeExecutionEnv["exec"]>[2],
): Promise<{ result: Awaited<ReturnType<NodeExecutionEnv["exec"]>>; output: string }> {
  let output = "";
  const result = await env.exec(
    command,
    {
      ...options,
      onOutput: (text) => {
        output += text;
      },
    },
    context,
  );
  return { result, output };
}

function toBashSingleQuotedArg(value: string): string {
  return `'${value.replace(/\\/g, "/").replace(/'/g, `'"'"'`)}'`;
}

function createInheritedStdioCommand(pidFile: string): string {
  return (
    'node -e "' +
    "const fs=require('fs');" +
    "const {spawn}=require('child_process');" +
    "const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});" +
    "fs.writeFileSync(process.argv[1], String(child.pid));" +
    "child.unref();" +
    "console.log('child-exiting');" +
    '" ' +
    toBashSingleQuotedArg(pidFile)
  );
}

function cleanupDetachedChild(pidFile: string): void {
  if (!existsSync(pidFile)) return;
  const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  // XEON-PATCH: P14
  attempt(() => execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" }));
}

class FailingSpillExecutionEnv extends NodeExecutionEnv {
  override async createTempFile(
    options: Parameters<NodeExecutionEnv["createTempFile"]>[0],
    context: Parameters<NodeExecutionEnv["createTempFile"]>[1],
  ) {
    if (options?.prefix === "pi-output-") {
      return { ok: true as const, value: join(this.cwd, "missing", "spill.log") };
    }
    return super.createTempFile(options, context);
  }
}

afterEach(async () => {
  // XEON-PATCH: P4
  mock.restore();
  // XEON-PATCH: P15
  await Promise.all(
    chmodRestorePaths.splice(0).map(async (path) => {
      // XEON-PATCH: P14
      await attemptAsync(async () => {
        await access(path);
        await chmod(path, 0o700);
      });
    }),
  );
  // XEON-PATCH: P15
  await Promise.all(tempDirs.splice(0).map((dir) => removeTempDir(dir)));
}, 15_000);

describe("NodeExecutionEnv filesystem", () => {
  it("reads, writes, lists, and removes files and directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    expect(getOrThrow(await env.absolutePath("nested/child", BACKGROUND_CONTEXT))).toBe(
      join(root, "nested/child"),
    );
    expect(getOrThrow(await env.joinPath([root, "nested", "child"], BACKGROUND_CONTEXT))).toBe(
      join(root, "nested", "child"),
    );
    getOrThrow(await env.createDir("nested/child", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("nested/child/file.txt", "hel", BACKGROUND_CONTEXT));
    getOrThrow(await env.appendFile("nested/child/file.txt", "lo", BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.readTextFile("nested/child/file.txt", BACKGROUND_CONTEXT))).toBe(
      "hello",
    );
    expect(
      getOrThrow(
        await env.readTextLines("nested/child/file.txt", { maxLines: 1 }, BACKGROUND_CONTEXT),
      ),
    ).toEqual(["hello"]);
    expect(
      Buffer.from(
        getOrThrow(await env.readBinaryFile("nested/child/file.txt", BACKGROUND_CONTEXT)),
      ).toString("utf8"),
    ).toBe("hello");

    const entries = getOrThrow(await env.listDir("nested/child", BACKGROUND_CONTEXT));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "file.txt",
      path: join(root, "nested/child/file.txt"),
      kind: "file",
      size: 5,
    });
    expect(typeof entries[0]!.mtimeMs).toBe("number");

    expect(getOrThrow(await env.exists("nested/child/file.txt", BACKGROUND_CONTEXT))).toBe(true);
    getOrThrow(await env.remove("nested/child/file.txt", undefined, BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.exists("nested/child/file.txt", BACKGROUND_CONTEXT))).toBe(false);
  });

  it("expands home-relative paths and file URLs", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    expect(getOrThrow(await env.absolutePath("~/pi-node-env-test", BACKGROUND_CONTEXT))).toBe(
      join(homedir(), "pi-node-env-test"),
    );
    const filePath = join(root, "file with spaces.txt");
    expect(
      getOrThrow(await env.absolutePath(pathToFileURL(filePath).href, BACKGROUND_CONTEXT)),
    ).toBe(filePath);
  });

  it("returns fileInfo for files, directories, and symlinks without following symlinks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.createDir("dir", { recursive: true }, BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("dir/file.txt", "hello", BACKGROUND_CONTEXT));
    await symlink(join(root, "dir/file.txt"), join(root, "file-link"));
    await symlink(join(root, "dir"), join(root, "dir-link"));

    expect(getOrThrow(await env.fileInfo("dir", BACKGROUND_CONTEXT))).toMatchObject({
      name: "dir",
      path: join(root, "dir"),
      kind: "directory",
    });
    expect(getOrThrow(await env.fileInfo("dir/file.txt", BACKGROUND_CONTEXT))).toMatchObject({
      name: "file.txt",
      path: join(root, "dir/file.txt"),
      kind: "file",
      size: 5,
    });
    expect(getOrThrow(await env.fileInfo("file-link", BACKGROUND_CONTEXT))).toMatchObject({
      name: "file-link",
      path: join(root, "file-link"),
      kind: "symlink",
    });
    expect(getOrThrow(await env.fileInfo("dir-link", BACKGROUND_CONTEXT))).toMatchObject({
      name: "dir-link",
      path: join(root, "dir-link"),
      kind: "symlink",
    });
    expect(getOrThrow(await env.canonicalPath("file-link", BACKGROUND_CONTEXT))).toBe(
      await realpath(join(root, "dir/file.txt")),
    );
  });

  it("lists symlinks as symlinks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("target.txt", "hello", BACKGROUND_CONTEXT));
    await symlink(join(root, "target.txt"), join(root, "link.txt"));

    const entries = getOrThrow(await env.listDir(".", BACKGROUND_CONTEXT));
    expect(
      entries
        .map((entry) => ({ name: entry.name, kind: entry.kind }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "link.txt", kind: "symlink" },
      { name: "target.txt", kind: "file" },
    ]);
  });

  it("stops reading text lines at the requested limit", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("file.txt", "one\ntwo\nthree", BACKGROUND_CONTEXT));
    expect(
      getOrThrow(await env.readTextLines("file.txt", { maxLines: 1 }, BACKGROUND_CONTEXT)),
    ).toEqual(["one"]);
  });

  it("returns FileError for missing paths and keeps exists false for missing paths", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const info = await env.fileInfo("missing.txt", BACKGROUND_CONTEXT);
    expect(info.ok).toBe(false);
    if (!info.ok) {
      expect(info.error).toBeInstanceOf(FileError);
      expect(info.error).toMatchObject({
        name: "FileError",
        code: "not_found",
        path: join(root, "missing.txt"),
      });
    }
    expect(getOrThrow(await env.exists("missing.txt", BACKGROUND_CONTEXT))).toBe(false);
  });

  it("returns FileError for listing non-directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT));
    const result = await env.listDir("file.txt", BACKGROUND_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(FileError);
      expect(result.error).toMatchObject({ code: "not_directory" });
    }
  });

  it("appends to new files and creates parent directories", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.appendFile("new/nested/file.txt", "a", BACKGROUND_CONTEXT));
    getOrThrow(await env.appendFile("new/nested/file.txt", "b", BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.readTextFile("new/nested/file.txt", BACKGROUND_CONTEXT))).toBe(
      "ab",
    );
  });

  it("atomically renames a file and replaces the destination", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("source.txt", "new", BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("destination.txt", "old", BACKGROUND_CONTEXT));

    getOrThrow(await env.renameFile("source.txt", "destination.txt", BACKGROUND_CONTEXT));

    expect(getOrThrow(await env.exists("source.txt", BACKGROUND_CONTEXT))).toBe(false);
    expect(getOrThrow(await env.readTextFile("destination.txt", BACKGROUND_CONTEXT))).toBe("new");
  });

  it("reports the source path when rename fails because the source is missing", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("destination.txt", "unchanged", BACKGROUND_CONTEXT));

    const result = await env.renameFile(
      "missing-source.txt",
      "destination.txt",
      BACKGROUND_CONTEXT,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "not_found",
        path: join(root, "missing-source.txt"),
      },
    });
    expect(getOrThrow(await env.readTextFile("destination.txt", BACKGROUND_CONTEXT))).toBe(
      "unchanged",
    );
  });

  it("creates temporary directories and files", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const tempDir = getOrThrow(await env.createTempDir("node-env-test-", BACKGROUND_CONTEXT));
    tempDirs.push(tempDir);
    // XEON-PATCH: P4
    // Bun's access() resolves with null where Node resolves with undefined.
    // XEON-PATCH: P15
    expect((await attemptAsync(() => access(tempDir))).ok).toBe(true);
    const tempFile = getOrThrow(
      await env.createTempFile({ prefix: "prefix-", suffix: ".txt" }, BACKGROUND_CONTEXT),
    );
    tempDirs.push(join(tempFile, ".."));
    expect((await attemptAsync(() => access(tempFile))).ok).toBe(true);
    expect(tempFile.endsWith(".txt")).toBe(true);
    expect(getOrThrow(await env.readTextFile(tempFile, BACKGROUND_CONTEXT))).toBe("");
  });

  it("honors createDir recursive false and remove recursive/force options", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const createResult = await env.createDir(
      "missing/child",
      { recursive: false },
      BACKGROUND_CONTEXT,
    );
    expect(createResult.ok).toBe(false);
    if (!createResult.ok) expect(createResult.error).toMatchObject({ code: "not_found" });

    getOrThrow(await env.writeFile("dir/child/file.txt", "hello", BACKGROUND_CONTEXT));
    const removeDirectory = await env.remove("dir", { recursive: false }, BACKGROUND_CONTEXT);
    expect(removeDirectory.ok).toBe(false);
    getOrThrow(await env.remove("dir", { recursive: true }, BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.exists("dir", BACKGROUND_CONTEXT))).toBe(false);

    const removeMissing = await env.remove("missing", { force: false }, BACKGROUND_CONTEXT);
    expect(removeMissing.ok).toBe(false);
    getOrThrow(await env.remove("missing", { force: true }, BACKGROUND_CONTEXT));
  });

  it("returns aborted results without side effects for pre-aborted file operations", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT));
    const context = abortedContext();

    const results = await Promise.all([
      env.readTextFile("file.txt", context),
      env.readTextLines("file.txt", undefined, context),
      env.readBinaryFile("file.txt", context),
      env.openTextLineReader("file.txt", context),
      env.writeFile("other.txt", "hello", context),
      env.appendFile("file.txt", " world", context),
      env.truncateFile("file.txt", 1, context),
      env.flushFile("file.txt", context),
      env.renameFile("file.txt", "renamed.txt", context),
      env.fileInfo("file.txt", context),
      env.listDir(".", context),
      env.canonicalPath("file.txt", context),
      env.exists("file.txt", context),
      env.createDir("dir", undefined, context),
      env.remove("file.txt", undefined, context),
      env.createTempDir(undefined, context),
      env.createTempFile(undefined, context),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
    }
    expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("hello");
    expect(
      getOrThrow(await env.listDir(".", BACKGROUND_CONTEXT)).map((entry) => entry.name),
    ).toEqual(["file.txt"]);
  });

  it("truncates and extends files to exact byte sizes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const bytes = new Uint8Array([0x61, 0xc3, 0xa9, 0x0a, 0x62, 0x0a]);
    getOrThrow(await env.writeFile("file.bin", bytes, BACKGROUND_CONTEXT));

    // Truncation is byte-exact even when the boundary splits a UTF-8 sequence.
    getOrThrow(await env.truncateFile("file.bin", 2, BACKGROUND_CONTEXT));
    expect([...getOrThrow(await env.readBinaryFile("file.bin", BACKGROUND_CONTEXT))]).toEqual([
      0x61, 0xc3,
    ]);

    getOrThrow(await env.truncateFile("file.bin", 4, BACKGROUND_CONTEXT));
    expect([...getOrThrow(await env.readBinaryFile("file.bin", BACKGROUND_CONTEXT))]).toEqual([
      0x61, 0xc3, 0, 0,
    ]);

    getOrThrow(await env.truncateFile("file.bin", 0, BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.fileInfo("file.bin", BACKGROUND_CONTEXT)).size).toBe(0);
  });

  it("rejects invalid truncation sizes and never creates missing files", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("file.txt", "hello", BACKGROUND_CONTEXT));
    const sizes = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
    // XEON-PATCH: P15
    const truncations = await Promise.all(
      sizes.map((size) => env.truncateFile("file.txt", size, BACKGROUND_CONTEXT)),
    );
    for (const truncation of truncations) {
      expect(truncation).toMatchObject({
        ok: false,
        error: { code: "invalid", path: join(root, "file.txt") },
      });
    }
    expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("hello");

    expect(await env.truncateFile("missing.txt", 0, BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "not_found", path: join(root, "missing.txt") },
    });
    expect(getOrThrow(await env.exists("missing.txt", BACKGROUND_CONTEXT))).toBe(false);
  });

  it("flushes existing files without changing content and reports missing paths", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("file.txt", "durable", BACKGROUND_CONTEXT));
    getOrThrow(await env.flushFile("file.txt", BACKGROUND_CONTEXT));
    expect(getOrThrow(await env.readTextFile("file.txt", BACKGROUND_CONTEXT))).toBe("durable");

    expect(await env.flushFile("missing.txt", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "not_found", path: join(root, "missing.txt") },
    });
    expect(getOrThrow(await env.exists("missing.txt", BACKGROUND_CONTEXT))).toBe(false);

    getOrThrow(await env.createDir("dir", undefined, BACKGROUND_CONTEXT));
    expect(await env.flushFile("dir", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "is_directory" },
    });
  });

  it("syncs through an opened handle, returns sync failures, and always closes the handle", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("file.txt", "durable", BACKGROUND_CONTEXT));
    const prototype = await fileHandlePrototype(join(root, "file.txt"));
    // XEON-PATCH: P15
    const originalSync: unknown = Reflect.get(prototype, "sync");
    if (typeof originalSync !== "function") throw new Error("FileHandle prototype has no sync");
    const synced: FileHandle[] = [];
    const sync = spyOn(prototype, "sync").mockImplementation(async function (this: FileHandle) {
      synced.push(this);
      await Reflect.apply(originalSync, this, []);
    });

    getOrThrow(await env.flushFile("file.txt", BACKGROUND_CONTEXT));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(synced[0]?.fd).toBe(-1);

    sync.mockImplementationOnce(function (this: FileHandle) {
      synced.push(this);
      return Promise.reject(Object.assign(new Error("EIO: i/o error, fsync"), { code: "EIO" }));
    });
    expect(await env.flushFile("file.txt", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "unknown", path: join(root, "file.txt"), message: "EIO: i/o error, fsync" },
    });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(synced[1]?.fd).toBe(-1);
  });

  it("cleanup is best-effort", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    expect(await env.cleanup(BACKGROUND_CONTEXT)).toBeUndefined();
  });
});

describe("NodeExecutionEnv text line reader", () => {
  it("reports whether each line was newline-terminated and preserves carriage returns", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "one\r\n\ntwo\npartial", BACKGROUND_CONTEXT));
    const reader = getOrThrow(await env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT));
    try {
      const lines: TextLine[] = [];
      // XEON-PATCH: P15
      await repeatAsync<undefined>(async () => {
        const line = getOrThrow(await reader.readLine(BACKGROUND_CONTEXT));
        if (line === undefined) return { value: undefined };
        lines.push(line);
        return undefined;
      });
      expect(lines).toEqual([
        { text: "one\r", terminated: true },
        { text: "", terminated: true },
        { text: "two", terminated: true },
        { text: "partial", terminated: false },
      ]);
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    } finally {
      await reader.close(BACKGROUND_CONTEXT);
    }
  });

  it("returns no lines for an empty file and one terminated empty line for a lone newline", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("empty.txt", "", BACKGROUND_CONTEXT));
    getOrThrow(await env.writeFile("newline.txt", "\n", BACKGROUND_CONTEXT));

    const empty = getOrThrow(await env.openTextLineReader("empty.txt", BACKGROUND_CONTEXT));
    expect(getOrThrow(await empty.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    await empty.close(BACKGROUND_CONTEXT);

    const newline = getOrThrow(await env.openTextLineReader("newline.txt", BACKGROUND_CONTEXT));
    expect(getOrThrow(await newline.readLine(BACKGROUND_CONTEXT))).toEqual({
      text: "",
      terminated: true,
    });
    expect(getOrThrow(await newline.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    await newline.close(BACKGROUND_CONTEXT);
  });

  it("decodes multi-byte characters split across read chunks and lines longer than one chunk", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    // The reader uses 64 KiB chunks; place a four-byte character across the first boundary.
    const first = `${"a".repeat(64 * 1024 - 2)}😀tail`;
    const second = "é".repeat(100_000);
    getOrThrow(await env.writeFile("large.txt", `${first}\n${second}`, BACKGROUND_CONTEXT));
    const reader = getOrThrow(await env.openTextLineReader("large.txt", BACKGROUND_CONTEXT));
    try {
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
        text: first,
        terminated: true,
      });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
        text: second,
        terminated: false,
      });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
    } finally {
      await reader.close(BACKGROUND_CONTEXT);
    }
  });

  it("rejects a read cancelled while pending without consuming its bytes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "one\ntwo\n", BACKGROUND_CONTEXT));
    const prototype = await fileHandlePrototype(join(root, "lines.txt"));
    // XEON-PATCH: P15
    const read: unknown = Reflect.get(prototype, "read");
    if (typeof read !== "function") throw new Error("FileHandle prototype has no read");
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    // XEON-PATCH: P14
    // spyOn은 FileHandle.read의 오버로드 전체 타입을 요구한다. 첫 호출만 붙잡는 대체 구현을 직접 끼우고 끝나면 되돌린다
    let armed = true;
    Object.defineProperty(prototype, "read", {
      configurable: true,
      writable: true,
      value: async function (this: FileHandle, ...args: unknown[]): Promise<unknown> {
        if (armed) {
          armed = false;
          started.resolve();
          await gate.promise;
        }
        return Reflect.apply(read, this, args);
      },
    });
    try {
      const reader = getOrThrow(await env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT));
      try {
        const controller = new AbortController();
        const pending = reader.readLine({ abortSignal: controller.signal });
        await started.promise;
        controller.abort();
        gate.resolve();
        expect(await pending).toMatchObject({ ok: false, error: { code: "aborted" } });
        expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
          text: "one",
          terminated: true,
        });
        expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({
          text: "two",
          terminated: true,
        });
        expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
      } finally {
        await reader.close(BACKGROUND_CONTEXT);
      }
    } finally {
      Object.defineProperty(prototype, "read", { configurable: true, writable: true, value: read });
    }
  });

  it("rejects reads after close and closes idempotently", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile("lines.txt", "one\n", BACKGROUND_CONTEXT));
    const reader = getOrThrow(await env.openTextLineReader("lines.txt", BACKGROUND_CONTEXT));
    await reader.close(BACKGROUND_CONTEXT);
    expect(await reader.close(BACKGROUND_CONTEXT)).toBeUndefined();
    expect(await reader.readLine(BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "invalid", path: join(root, "lines.txt") },
    });
  });

  it("reports missing files when opening a reader", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    expect(await env.openTextLineReader("missing.txt", BACKGROUND_CONTEXT)).toMatchObject({
      ok: false,
      error: { code: "not_found", path: join(root, "missing.txt") },
    });
  });
});

describe("NodeExecutionEnv shell", () => {
  it("executes commands in cwd with env overrides", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const collected = await collectShellOutput(
      env,
      'printf \'%s\' "$NODE_ENV_TEST" > cwd-marker.txt; printf \'%s:%s\' "$PWD" "$NODE_ENV_TEST"',
      { env: { NODE_ENV_TEST: "ok" } },
      BACKGROUND_CONTEXT,
    );
    const result = getOrThrow(collected.result);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, "cwd-marker.txt"), "utf8")).toBe("ok");
    // Git Bash on Windows reports $PWD as an MSYS path (/tmp/...), not the Windows path.
    if (process.platform !== "win32") expect(collected.output).toBe(`${await realpath(root)}:ok`);
  });

  it.each([
    ["a missing override preserves the base value", undefined, "x:/stale/parent.jsonl"],
    ["an empty override shadows the base value", { PI_SESSION_FILE: "" }, "x:"],
    [
      "a string override replaces the base value",
      { PI_SESSION_FILE: "/sessions/current.jsonl" },
      "x:/sessions/current.jsonl",
    ],
  ] as const)(
    "applies string shell environment overrides when %s",
    async (_description, overrides, expectedSessionFile) => {
      const root = createTempDir();
      const env = new NodeExecutionEnv({
        platform,
        cwd: root,
        shellEnv: {
          PI_SESSION_FILE: "/stale/parent.jsonl",
          PI_CODING_AGENT: "true",
          PI_NODE_ENV_PRESERVED_TEST: "preserved",
        },
      });
      const collected = await collectShellOutput(
        env,
        `printf '%s:%s|%s|%s' "\${PI_SESSION_FILE+x}" "\${PI_SESSION_FILE-}" "$PI_CODING_AGENT" "$PI_NODE_ENV_PRESERVED_TEST"`,
        // XEON-PATCH: P8
        overrides === undefined ? undefined : { env: overrides },
        BACKGROUND_CONTEXT,
      );
      getOrThrow(collected.result);
      expect(collected.output).toBe(`${expectedSessionFile}|true|preserved`);
    },
  );

  it("can replace rather than inherit the default shell environment", async () => {
    const root = createTempDir();
    const inheritedKey = "PI_NODE_ENV_INHERITED_TEST";
    const configuredKey = "PI_NODE_ENV_CONFIGURED_TEST";
    const explicitKey = "PI_NODE_ENV_EXPLICIT_TEST";
    const previousInherited = process.env[inheritedKey];
    process.env[inheritedKey] = "host";
    try {
      const env = new NodeExecutionEnv({
        platform,
        cwd: root,
        shellEnv: { [configuredKey]: "configured" },
      });
      const collected = await collectShellOutput(
        env,
        `printf '%s:%s:%s' "\${${inheritedKey}-}" "\${${configuredKey}-}" "\${${explicitKey}-}"`,
        { inheritEnv: false, env: { [explicitKey]: "explicit" } },
        BACKGROUND_CONTEXT,
      );
      getOrThrow(collected.result);
      expect(collected.output).toBe("::explicit");
    } finally {
      if (previousInherited === undefined) delete process.env[inheritedKey];
      else process.env[inheritedKey] = previousInherited;
    }
  });

  it("uses stdin command transport for legacy WSL bash paths", async () => {
    if (process.platform === "win32") return;
    const root = createTempDir();
    const shellPath = "C:\\Windows\\System32\\bash.exe";
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(
      await env.writeFile(
        shellPath,
        '#!/bin/sh\nprintf \'args:%s\\n\' "$*" >&2\nexec /bin/bash "$@"\n',
        BACKGROUND_CONTEXT,
      ),
    );
    await chmod(join(root, shellPath), 0o755);

    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    try {
      process.chdir(root);
      process.env.PATH = `${root}${delimiter}${originalPath ?? ""}`;

      // XEON-PATCH: P3
      const wslEnv = new NodeExecutionEnv({
        platform: createWin32Provider({ env: process.env }),
        cwd: root,
        shellPath,
      });
      const nameExpansion = "${name}";
      const collected = await collectShellOutput(
        wslEnv,
        `name='World'; echo "Hello, ${nameExpansion}!"`,
        undefined,
        BACKGROUND_CONTEXT,
      );
      const result = getOrThrow(collected.result);
      expect(collected.output).toContain("Hello, World!");
      expect(collected.output).toContain("args:-s");
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
    }
  });

  it.skipIf(process.platform !== "win32")(
    "settles after the shell exits when a detached descendant retains inherited stdio",
    async () => {
      const root = createTempDir();
      const pidFile = join(root, "grandchild.pid");
      const env = new NodeExecutionEnv({ platform, cwd: root });
      const controller = new AbortController();
      try {
        const collected = await withTimeout(
          collectShellOutput(env, createInheritedStdioCommand(pidFile), undefined, {
            abortSignal: controller.signal,
          }),
          3000,
          () => controller.abort(),
        );
        getOrThrow(collected.result);
        expect(collected.output).toContain("child-exiting");
      } finally {
        controller.abort();
        cleanupDetachedChild(pidFile);
      }
    },
  );

  it("cleanup terminates active shell processes", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const execution = env.exec("touch started; sleep 60", undefined, BACKGROUND_CONTEXT);
    try {
      await waitFor(
        async () => getOrThrow(await env.exists("started", BACKGROUND_CONTEXT)),
        10_000,
      );
    } finally {
      await env.cleanup(BACKGROUND_CONTEXT);
    }
    expect(await withTimeout(execution, 3000)).toMatchObject({ ok: true });
  }, 20_000);

  it("streams combined stdout and stderr", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const collected = await collectShellOutput(
      env,
      "printf out; printf err >&2",
      undefined,
      BACKGROUND_CONTEXT,
    );
    expect(getOrThrow(collected.result)).toEqual({ exitCode: 0 });
    expect(collected.output).toContain("out");
    expect(collected.output).toContain("err");
  });

  it("decodes UTF-8 split across raw process chunks", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const script =
      "const b=Buffer.from('😀');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),50)";
    const collected = await collectShellOutput(
      env,
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      undefined,
      BACKGROUND_CONTEXT,
    );
    expect(collected.output).toBe("😀");
  });

  it("reports a missing working directory before spawning", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: join(root, "missing") });
    const result = await env.exec("printf ok", undefined, BACKGROUND_CONTEXT);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "spawn_error",
        message: expect.stringContaining("Working directory does not exist"),
      },
    });
  });

  it("returns non-zero command exit codes as successful execution results", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const result = getOrThrow(await env.exec("exit 7", undefined, BACKGROUND_CONTEXT));
    expect(result).toEqual({ exitCode: 7 });
  });

  // Regression test for https://github.com/earendil-works/pi/issues/8992
  it.skipIf(process.platform === "win32")(
    "maps signal-killed processes to a non-zero exit code",
    async () => {
      const root = createTempDir();
      const env = new NodeExecutionEnv({ platform, cwd: root });
      const result = getOrThrow(await env.exec("kill -9 $$", undefined, BACKGROUND_CONTEXT));
      expect(result.exitCode).toBe(128 + 9);
    },
  );

  it("returns timeout errors for commands exceeding the timeout", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const result = await env.exec("sleep 5", { timeout: 0.01 }, BACKGROUND_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "timeout" });
  });

  it("rejects invalid timeouts before spawning", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const timeouts = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_484];
    // XEON-PATCH: P15
    const results = await Promise.all(
      timeouts.map((timeout) => env.exec("touch spawned", { timeout }, BACKGROUND_CONTEXT)),
    );
    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "timeout", message: expect.stringContaining("Invalid timeout") },
      });
    }
    expect(getOrThrow(await env.exists("spawned", BACKGROUND_CONTEXT))).toBe(false);
  });

  it("returns callback errors from exec stream handlers", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const result = await env.exec(
      "printf out",
      {
        onOutput: () => {
          throw new Error("callback failed");
        },
      },
      BACKGROUND_CONTEXT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatchObject({ code: "callback_error", message: "callback failed" });
  });

  it("returns shell unavailable and spawn errors", async () => {
    const root = createTempDir();
    const missingShellEnv = new NodeExecutionEnv({
      platform,
      cwd: root,
      shellPath: join(root, "missing-shell"),
    });
    const missingShell = await missingShellEnv.exec("printf ok", undefined, BACKGROUND_CONTEXT);
    expect(missingShell.ok).toBe(false);
    if (!missingShell.ok) expect(missingShell.error).toMatchObject({ code: "shell_unavailable" });

    const shellPath = join(root, "not-executable-shell");
    const env = new NodeExecutionEnv({ platform, cwd: root });
    getOrThrow(await env.writeFile(shellPath, "not executable", BACKGROUND_CONTEXT));
    const spawnErrorEnv = new NodeExecutionEnv({ platform, cwd: root, shellPath });
    const spawnError = await spawnErrorEnv.exec("printf ok", undefined, BACKGROUND_CONTEXT);
    expect(spawnError.ok).toBe(false);
    if (!spawnError.ok) expect(spawnError.error).toMatchObject({ code: "spawn_error" });
  });

  it("returns an aborted result for pre-aborted and aborted commands", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    expect(await env.exec("touch spawned", undefined, abortedContext())).toMatchObject({
      ok: false,
      error: { code: "aborted" },
    });
    expect(getOrThrow(await env.exists("spawned", BACKGROUND_CONTEXT))).toBe(false);

    const controller = new AbortController();
    const promise = env.exec("sleep 5", undefined, { abortSignal: controller.signal });
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "aborted" });
  });

  it.skipIf(process.platform === "win32")(
    "ignores asynchronous taskkill spawn errors during abort",
    async () => {
      const root = createTempDir();
      const pidFile = join(root, "shell.pid");
      const controller = new AbortController();
      // XEON-PATCH: P3
      const env = new NodeExecutionEnv({
        platform: createWin32Provider({ env: { SystemRoot: "/definitely/missing/windows" } }),
        cwd: root,
        shellPath: "/bin/bash",
      });

      let pid: number | undefined;
      try {
        const execution = env.exec(
          `echo $$ > ${toBashSingleQuotedArg(pidFile)}; exec sleep 60`,
          undefined,
          { abortSignal: controller.signal },
        );
        let pidChecks = 0;
        // XEON-PATCH: P15
        await repeatAsync<undefined>(async () => {
          if (pidChecks >= 100 || existsSync(pidFile)) return { value: undefined };
          pidChecks += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return undefined;
        });
        expect(existsSync(pidFile)).toBe(true);

        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 0));
        pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
        process.kill(pid, "SIGKILL");

        const result = await execution;
        expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
      } finally {
        if (pid === undefined && existsSync(pidFile)) {
          pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
        }
        if (pid !== undefined && Number.isFinite(pid)) {
          // XEON-PATCH: P14
          const target = pid;
          attempt(() => process.kill(target, "SIGKILL"));
        }
      }
    },
  );

  it("does not create a spill before output crosses its thresholds", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const result = getOrThrow(
      await env.exec(
        "printf short",
        {
          spill: { afterBytes: 100, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    );
    expect(result.spillPath).toBeUndefined();
  });

  it("preserves exact raw bytes in the spill while streaming decoded text", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const expected = [0x66, 0x80, 0x00, 0x6f];
    const result = getOrThrow(
      await env.exec(
        `${JSON.stringify(process.execPath)} -e "process.stdout.write(Buffer.from([${expected.join(",")}]))"`,
        {
          spill: { afterBytes: 1, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    );
    expect(result.spillPath).toBeDefined();
    tempDirs.push(join(result.spillPath!, ".."));
    expect([
      ...getOrThrow(await env.readBinaryFile(result.spillPath!, BACKGROUND_CONTEXT)),
    ]).toEqual(expected);
  });

  it("reports the spill of a command that times out", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const result = await env.exec(
      "printf 12345678901234567890; sleep 5",
      { timeout: 0.3, spill: { afterBytes: 10, afterLines: 10 } },
      BACKGROUND_CONTEXT,
    );
    // XEON-PATCH: P4
    // Bun's toMatchObject replaces a property matched by an asymmetric matcher on the received object, so read the path first.
    // XEON-PATCH: P14
    if (result.ok || result.error.spillPath === undefined)
      throw new Error("expected a timeout with a spill");
    const spillPath = result.error.spillPath;
    expect(result).toMatchObject({
      ok: false,
      error: { code: "timeout", spillPath: expect.any(String) },
    });
    tempDirs.push(join(spillPath, ".."));
    expect(getOrThrow(await env.readTextFile(spillPath, BACKGROUND_CONTEXT))).toBe(
      "12345678901234567890",
    );
  });

  it("fails rather than silently losing a requested spill", async () => {
    const root = createTempDir();
    const env = new FailingSpillExecutionEnv({ platform, cwd: root });
    const result = await env.exec(
      "printf 12345678901234567890",
      {
        spill: { afterBytes: 10, afterLines: 10 },
      },
      BACKGROUND_CONTEXT,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unknown",
        message: expect.stringContaining("Failed to preserve complete shell output"),
      },
    });
  });

  it("preserves complete large output in the spill", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const size = 500_000;
    const result = getOrThrow(
      await env.exec(
        `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(${size}))"`,
        {
          spill: { afterBytes: 10, afterLines: 10 },
        },
        BACKGROUND_CONTEXT,
      ),
    );
    expect(result.spillPath).toBeDefined();
    tempDirs.push(join(result.spillPath!, ".."));
    expect(getOrThrow(await env.readTextFile(result.spillPath!, BACKGROUND_CONTEXT))).toHaveLength(
      size,
    );
  });

  it("streams every line and spills them all once output crosses its line threshold", async () => {
    const root = createTempDir();
    const env = new NodeExecutionEnv({ platform, cwd: root });
    const collected = await collectShellOutput(
      env,
      "i=1; while [ $i -le 15000 ]; do echo line-$i; i=$((i+1)); done",
      { spill: { afterBytes: 1024 * 1024, afterLines: 100 } },
      BACKGROUND_CONTEXT,
    );
    const result = getOrThrow(collected.result);
    expect(collected.output).toBe(
      Array.from({ length: 15000 }, (_, index) => `line-${index + 1}\n`).join(""),
    );
    expect(result.spillPath).toBeDefined();
    tempDirs.push(join(result.spillPath!, ".."));
    const spilled = getOrThrow(
      await env.readTextLines(result.spillPath!, undefined, BACKGROUND_CONTEXT),
    );
    expect(spilled).toHaveLength(15000);
    expect(spilled.at(-1)).toBe("line-15000");
  });
});
