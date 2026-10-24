import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type Result, attemptAsync } from "@xeon/contracts";
import { compareBytes } from "../hash.ts";
import type { FsEntry, FsEntryKind, FsError, FsErrorKind, FsStat, KnowledgeFs } from "./port.ts";
import { createKeyedMutex } from "./mutex.ts";

// L2.knowledge.plan §2 fs/node-fs.ts. node:fs/promises 위의 운영 구현이다.

function codeOf(cause: unknown): string {
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return "";
}

const KIND_BY_CODE: ReadonlyMap<string, FsErrorKind> = new Map([
  ["ENOENT", "not_found"],
  ["ENOTDIR", "not_directory"],
  ["EISDIR", "is_directory"],
  ["EEXIST", "exists"],
  ["ENOTEMPTY", "exists"],
  ["EACCES", "permission_denied"],
  ["EPERM", "permission_denied"],
  ["EROFS", "permission_denied"],
  ["ENOSPC", "disk_full"],
  ["EDQUOT", "disk_full"],
]);

function kindOfCode(code: string): FsErrorKind {
  return KIND_BY_CODE.get(code) ?? "io";
}

function fsError(path: string, cause: unknown): FsError {
  const code = codeOf(cause);
  return { kind: kindOfCode(code), path, code, cause };
}

async function guard<T>(path: string, run: () => Promise<T>): Promise<Result<T, FsError>> {
  const result = await attemptAsync(run);
  return result.ok ? ok(result.value) : err(fsError(path, result.error.cause));
}

function entryKind(entry: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FsEntryKind {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

let tempCounter = 0;

async function writeAndSync(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  await handle.writeFile(bytes);
  await handle.sync();
}

export function createNodeFs(): KnowledgeFs {
  const withLock = createKeyedMutex();
  return {
    readFile: (path) => guard(path, () => readFile(path)),
    stat: (path) =>
      guard(path, async (): Promise<FsStat> => {
        const info = await stat(path);
        const kind = info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
        return { kind, size: info.size, mtimeMs: info.mtimeMs };
      }),
    list: (path) =>
      guard(path, async (): Promise<readonly FsEntry[]> => {
        const entries = await readdir(path, { withFileTypes: true });
        return entries
          .map((entry): FsEntry => ({ name: entry.name, kind: entryKind(entry) }))
          .toSorted((a, b) => compareBytes(a.name, b.name));
      }),
    realpath: (path) => guard(path, () => realpath(path)),
    mkdirp: (path) =>
      guard(path, async () => {
        await mkdir(path, { recursive: true });
      }),
    writeAtomic: async (path, bytes) => {
      tempCounter += 1;
      const temp = `${dirname(path)}/.${process.pid}-${tempCounter}.tmp`;
      const opened = await guard(temp, () => open(temp, "wx", 0o600));
      if (!opened.ok) return err({ ...opened.error, path });
      const handle = opened.value;
      const wrote = await guard(temp, () => writeAndSync(handle, bytes));
      const closed = await guard(temp, () => handle.close());
      const renamed =
        wrote.ok && closed.ok ? await guard(path, () => rename(temp, path)) : undefined;
      if (renamed?.ok === true) return ok(undefined);
      // 임시 파일 정리가 실패해도 점 파일이 남을 뿐이다(트리 해시와 캡처가 점 파일을 보지 않는다). 원래 오류를 돌려준다
      await attemptAsync(() => rm(temp, { force: true }));
      if (!wrote.ok) return err({ ...wrote.error, path });
      if (!closed.ok) return err({ ...closed.error, path });
      return renamed ?? ok(undefined);
    },
    rename: async (from, to) => {
      // rename(2)는 대상을 덮어쓴다. 보관함 이동은 덮어쓰지 않는다
      const existing = await attemptAsync(() => stat(to));
      if (existing.ok) return err({ kind: "exists", path: to, code: "EEXIST" });
      return guard(to, () => rename(from, to));
    },
    remove: (path, options) =>
      guard(path, async () => {
        await rm(path, { recursive: options.recursive, force: false });
      }),
    withLock,
  };
}
