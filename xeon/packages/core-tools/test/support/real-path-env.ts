import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { err, ok } from "@fresnel/contracts";
import { FileError, type FileErrorCode, type FileInfo } from "@fresnel/contracts/services";
import type { InheritPathEnv } from "../../src/inherit-target.ts";

// 승인 상속의 경로 풀이 시험용 env. 실제 파일 시스템(realpath, lstat)으로 푼다. 시험은 임시 폴더를 `cwd`로 넘긴다.

function fileErrorOf(error: unknown, path: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  const raw = error instanceof Error && "code" in error ? error.code : undefined;
  const code: FileErrorCode =
    raw === "ENOENT"
      ? "not_found"
      : raw === "ENOTDIR"
        ? "not_directory"
        : raw === "EACCES" || raw === "EPERM"
          ? "permission_denied"
          : "unknown";
  return new FileError(code, message, path);
}

function infoOf(path: string, stats: Stats): FileInfo {
  const kind = stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "directory" : "file";
  return { name: basename(path), path, kind, size: stats.size, mtimeMs: stats.mtimeMs };
}

/** `cwd`를 작업 폴더로 한 실제 파일 시스템의 경로 env. `fileInfo`는 링크를 따르지 않는다(lstat) */
export function realPathEnv(cwd: string): InheritPathEnv {
  return {
    cwd,
    absolutePath: (path) => Promise.resolve(ok(resolve(cwd, path))),
    canonicalPath: (path) =>
      realpath(path).then(
        (real) => ok(real),
        (error: unknown) => err(fileErrorOf(error, path)),
      ),
    fileInfo: (path) =>
      lstat(path).then(
        (stats) => ok(infoOf(path, stats)),
        (error: unknown) => err(fileErrorOf(error, path)),
      ),
  };
}
