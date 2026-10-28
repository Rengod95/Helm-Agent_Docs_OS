import { lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { attempt, err, ok, type Result } from "@xeon/contracts";
import { resolveOsDirs } from "@xeon/platform-os";
import { hostResourceDir } from "../state-paths.ts";

// L4.host-service.spec §3.5, SV-05. 서비스 파일의 위치: `<runtimeDir>/service.json`, `<runtimeDir>/xeon.sock`.
// runtimeDir의 경로 값과 길이 폴백은 L0.os가 정한다(`resolveOsDirs`). 이 모듈은 디렉터리를 만들고(0700) 소유자와 권한을 확인한다.
// 다른 사용자가 만들었거나 그룹·기타에 열린 디렉터리는 쓰지 않는다. 권한을 대신 좁히지 않는다.

export interface ServicePaths {
  readonly runtimeDir: string;
  readonly registrationPath: string;
  readonly socketPath: string;
  /** 낡은 소켓 파일을 지우고 다시 바인드하는 동안 쥐는 잠금 파일(L0.process.spec §4.4.3) */
  readonly activationLockPath: string;
}

export type ServicePathError =
  | { readonly kind: "dirs_unavailable"; readonly reason: string }
  | { readonly kind: "runtime_dir_unsafe"; readonly path: string; readonly reason: string };

function servicePathsIn(runtimeDir: string): ServicePaths {
  return {
    runtimeDir,
    registrationPath: join(runtimeDir, "service.json"),
    socketPath: join(runtimeDir, "xeon.sock"),
    activationLockPath: join(runtimeDir, "service.activation"),
  };
}

function checkRuntimeDir(dir: string): Result<void, ServicePathError> {
  const made = attempt(() => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  });
  if (!made.ok) return err({ kind: "runtime_dir_unsafe", path: dir, reason: "cannot_create" });
  const stat = attempt(() => lstatSync(dir));
  if (!stat.ok) return err({ kind: "runtime_dir_unsafe", path: dir, reason: "cannot_stat" });
  if (!stat.value.isDirectory()) {
    return err({ kind: "runtime_dir_unsafe", path: dir, reason: "not_a_directory" });
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.value.uid !== uid) {
    return err({ kind: "runtime_dir_unsafe", path: dir, reason: "not_owned" });
  }
  if ((stat.value.mode & 0o077) !== 0) {
    return err({ kind: "runtime_dir_unsafe", path: dir, reason: "permission_too_open" });
  }
  return ok(undefined);
}

/** 서비스 파일 위치를 정하고 runtimeDir을 준비한다. `runtimeDir`을 넘기면(시험) 그 디렉터리를 쓴다 */
export function resolveServicePaths(
  options: { readonly runtimeDir?: string } = {},
): Result<ServicePaths, ServicePathError> {
  let runtimeDir = options.runtimeDir;
  if (runtimeDir === undefined) {
    const dirs = resolveOsDirs({ resourceDir: hostResourceDir() });
    if (!dirs.ok) return err({ kind: "dirs_unavailable", reason: dirs.error.kind });
    runtimeDir = dirs.value.runtime;
  }
  const checked = checkRuntimeDir(runtimeDir);
  if (!checked.ok) return checked;
  return ok(servicePathsIn(runtimeDir));
}
