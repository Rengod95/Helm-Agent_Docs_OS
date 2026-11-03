import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  FileError,
  type FileErrorCode,
  type FileInfo,
  type FileKind,
} from "@fresnel/contracts/services";
import type { CommandFiles } from "../../src/ports/command-files.ts";

// 실제 파일 시스템 위의 명령 파일 원천. 심볼릭 링크와 실제 크기를 그대로 보여 준다.
// 임시 폴더 시험에만 쓴다(platform-exec를 이 패키지가 가져오지 않는다. 층 규칙).

interface NodeError {
  readonly code: string;
}

function isNodeError(error: unknown): error is NodeError {
  return typeof error === "object" && error !== null && "code" in error;
}

function toFileError(error: unknown, path: string): FileError {
  const code = isNodeError(error) ? error.code : "";
  const mapped: Record<string, FileErrorCode> = {
    ENOENT: "not_found",
    ENOTDIR: "not_directory",
    EISDIR: "is_directory",
    EACCES: "permission_denied",
    EPERM: "permission_denied",
  };
  const kind: FileErrorCode = mapped[code] ?? "unknown";
  return new FileError(kind, `${code} ${path}`, path);
}

function kindOf(stats: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FileKind | undefined {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  return undefined;
}

/** 실제 파일 시스템을 읽는 명령 파일 원천. `lstat`이라 링크는 `symlink`로 보인다 */
export function realCommandFiles(): CommandFiles {
  return {
    async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
      try {
        const names = await readdir(path);
        const infos = await Promise.all(
          names.map(async (name): Promise<FileInfo | undefined> => {
            const entryPath = join(path, name);
            const stats = await lstat(entryPath);
            const kind = kindOf(stats);
            if (kind === undefined) return undefined;
            return { name, path: entryPath, kind, size: stats.size, mtimeMs: stats.mtimeMs };
          }),
        );
        return ok(infos.filter((info) => info !== undefined));
      } catch (error) {
        return err(toFileError(error, path));
      }
    },
    async readTextFile(path: string): Promise<Result<string, FileError>> {
      try {
        return ok(await readFile(path, "utf8"));
      } catch (error) {
        return err(toFileError(error, path));
      }
    },
    async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
      try {
        const stats = await lstat(path);
        const kind = kindOf(stats);
        if (kind === undefined) return err(new FileError("invalid", "unsupported file", path));
        const name = path.slice(path.lastIndexOf("/") + 1);
        return ok({ name, path, kind, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch (error) {
        return err(toFileError(error, path));
      }
    },
    async canonicalPath(path: string): Promise<Result<string, FileError>> {
      try {
        return ok(await realpath(path));
      } catch (error) {
        return err(toFileError(error, path));
      }
    },
  };
}
