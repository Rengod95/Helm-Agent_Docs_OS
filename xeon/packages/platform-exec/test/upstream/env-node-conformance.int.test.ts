import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// XEON-PATCH: P4
import { afterEach, describe, expect, it } from "bun:test";
// XEON-PATCH: P15
import { repeatAsync } from "@xeon/contracts";
// XEON-PATCH: P5
import type { CancelScope } from "@xeon/contracts/services";
import { registerExecConformance } from "../../src/testing/conformance.ts";
import { getOrThrow, type WatchChange } from "../../src/upstream/env/index.ts";
import { NodeExecutionEnv } from "../../src/upstream/env/node.ts";
import { errnoCodeOf } from "../support/errno.ts";
import { hostPlatform } from "../support/platform.ts";

const windows = process.platform === "win32";
const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
// XEON-PATCH: P5
const context: CancelScope = { abortSignal: undefined };
// XEON-PATCH: P3
const platform = hostPlatform();

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

registerExecConformance(
  "NodeExecutionEnv conformance",
  async (use) => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-conformance-"));
    try {
      await use(new NodeExecutionEnv({ platform, cwd }));
    } finally {
      await removeTempDir(cwd);
    }
  },
  // Git Bash's `ln -s` copies instead of linking unless native symlinks are enabled.
  windows ? { shell: [gitBash, "-c"], symlinks: false } : {},
);

registerExecConformance(
  "NodeExecutionEnv conformance with polling watches",
  async (use) => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-conformance-"));
    try {
      await use(
        new NodeExecutionEnv({ platform, cwd, watch: { mode: "polling", pollIntervalMs: 100 } }),
      );
    } finally {
      await removeTempDir(cwd);
    }
  },
  windows ? { shell: [gitBash, "-c"], symlinks: false } : {},
);

describe("NodeExecutionEnv watch limits", () => {
  it("refuses a tree over the directory budget and stops with an error when one grows past it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-watch-"));
    try {
      const env = new NodeExecutionEnv({ platform, cwd, watch: { maxDirectories: 3 } });
      getOrThrow(await env.createDir("tree/a/b", undefined, context));
      getOrThrow(await env.createDir("tree/c", undefined, context));
      expect(await env.watch([{ path: "tree", recursive: true }], () => {}, context)).toMatchObject(
        {
          ok: false,
          error: { code: "invalid" },
        },
      );

      getOrThrow(await env.remove("tree/c", { recursive: true }, context));
      const changes: WatchChange[] = [];
      const watcher = getOrThrow(
        await env.watch(
          [{ path: "tree", recursive: true }],
          (change) => changes.push(change),
          context,
        ),
      );
      getOrThrow(await env.createDir("tree/d", undefined, context));
      const deadline = Date.now() + 3000;
      // XEON-PATCH: P15
      await repeatAsync<undefined>(async () => {
        if (changes.some((change) => "error" in change) || Date.now() >= deadline) {
          return { value: undefined };
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        return undefined;
      });
      expect(changes.at(-1)).toMatchObject({ error: { code: "invalid" } });
      await watcher.close(context);
    } finally {
      await removeTempDir(cwd);
    }
  });
});

describe("NodeExecutionEnv readers", () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "pi-durable-env-readers-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(async () => {
    // XEON-PATCH: P15
    await Promise.all(dirs.splice(0).map((dir) => removeTempDir(dir)));
  }, 15_000);

  it("reads ranges spanning several internal chunks exactly", async () => {
    const cwd = tempDir();
    const bytes = new Uint8Array(2.5 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31) % 251;
    writeFileSync(join(cwd, "big.bin"), bytes);
    const reader = getOrThrow(
      await new NodeExecutionEnv({ platform, cwd }).openBinaryReader("big.bin", undefined, context),
    );
    try {
      const all = getOrThrow(await reader.read(0, bytes.length + 10, context));
      expect(all.length).toBe(bytes.length);
      expect(Buffer.from(all).equals(Buffer.from(bytes))).toBe(true);
      const middle = getOrThrow(await reader.read(1024 * 1024 - 3, 7, context));
      expect([...middle]).toEqual([...bytes.subarray(1024 * 1024 - 3, 1024 * 1024 + 4)]);
    } finally {
      await reader.close(context);
    }
  });

  it.skipIf(windows)("refuses a FIFO without waiting for a writer", async () => {
    const cwd = tempDir();
    execFileSync("mkfifo", [join(cwd, "pipe")]);
    const result = await new NodeExecutionEnv({ platform, cwd }).openBinaryReader(
      "pipe",
      undefined,
      context,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
  });
});
