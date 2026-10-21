import { chmodSync, mkdirSync, statSync } from "node:fs";
import { err, ok, type Result } from "@xeon/contracts";
import type { StoreOpenError, StoreWarning } from "./types.ts";

function fsCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

interface PrivateTarget {
  readonly path: string;
  /** 디렉터리 0700, 파일 0600 */
  readonly mode: number;
  /** 0600/0700과 소유자 검사가 의미 있는 플랫폼 */
  readonly posix: boolean;
}

function enforce(target: PrivateTarget, warnings: StoreWarning[]): Result<void, StoreOpenError> {
  if (!target.posix) return ok(undefined);
  try {
    const stat = statSync(target.path);
    const uid = process.getuid?.();
    const current = stat.mode & 0o777;
    if (uid !== undefined && stat.uid !== uid) {
      return err({ kind: "permission", path: target.path, mode: current });
    }
    if ((current & 0o077) !== 0) {
      chmodSync(target.path, target.mode);
      warnings.push({
        kind: "permission_fixed",
        path: target.path,
        from: current,
        to: target.mode,
      });
    }
    return ok(undefined);
  } catch (caught) {
    return err({ kind: "io", code: fsCode(caught) });
  }
}

/** 디렉터리를 0700으로 만들거나 확인한다. 남의 디렉터리면 permission, 열린 권한 비트는 고치고 경고한다 */
export function ensurePrivateDir(
  path: string,
  posix: boolean,
  warnings: StoreWarning[],
): Result<void, StoreOpenError> {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  } catch (caught) {
    return err({ kind: "io", code: fsCode(caught) });
  }
  return enforce({ path, mode: 0o700, posix }, warnings);
}

/** 이미 있는 파일의 소유자와 모드(0600)를 확인한다 */
export function ensurePrivateFile(
  path: string,
  posix: boolean,
  warnings: StoreWarning[],
): Result<void, StoreOpenError> {
  return enforce({ path, mode: 0o600, posix }, warnings);
}
