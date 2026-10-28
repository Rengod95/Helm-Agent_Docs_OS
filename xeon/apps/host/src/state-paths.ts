import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import { resolveOsDirs } from "@xeon/platform-os";

// L4.host-service.spec §3.3.6 상태 디렉터리 API (review.decisions-2 B-07). CLI는 경로를 계산하지 않는다(DR-13).
// 위치 규칙은 L0.os의 OsDirs.state와 같은 함수(resolveOsDirs)가 정한다. 서비스를 띄우지 않고 위치만 묻는다.

export interface HostStatePaths {
  /** OsDirs.state. 로그, 복구 표식처럼 기기에 남는 상태 */
  readonly stateDir: string;
  /** `<stateDir>/cli/state.json`. L4.cli.spec §3.7 CliStateSchema 파일 */
  readonly cliStateFile: string;
}

export type HostStatePathError =
  /** OsDirs를 정할 수 없음(홈 없음, 지원하지 않는 플랫폼 등). reason은 DirsError의 kind */
  | { readonly kind: "dirs_unavailable"; readonly message: string; readonly reason: string }
  /** 디렉터리를 만들거나 쓸 수 없음 */
  | { readonly kind: "permission"; readonly path: string; readonly cause: unknown };

export interface ResolveHostStatePathsOptions {
  /** 테스트 격리용 덮어쓰기. 값이 있으면 cliStateFile로 그대로 쓴다. 운영 경로는 이 값을 넘기지 않는다 */
  readonly cliStateFileOverride?: string;
}

/** 앱과 함께 배포된 읽기 전용 자원 디렉터리: 실행 파일 옆. 릴리즈 배치가 정해지면 바뀐다 [미결] */
export function hostResourceDir(): string {
  return dirname(process.execPath);
}

/** 릴리즈에 든 기본 플러그인 번들의 뿌리: 자원 디렉터리 아래 `default-plugins/`. 릴리즈 배치가 정해지면 바뀐다 [미결] */
export function defaultPluginsDir(): string {
  return join(hostResourceDir(), "default-plugins");
}

/** 디렉터리를 만들고(0700) 경로를 돌려준다. 예상 가능한 실패는 Result로 돌려준다 */
export async function resolveHostStatePaths(
  options: ResolveHostStatePathsOptions = {},
): Promise<Result<HostStatePaths, HostStatePathError>> {
  const dirs = resolveOsDirs({ resourceDir: hostResourceDir() });
  if (!dirs.ok) {
    return err({
      kind: "dirs_unavailable",
      message: `cannot decide the state directory: ${dirs.error.kind}`,
      reason: dirs.error.kind,
    });
  }
  const stateDir = dirs.value.state;
  const cliStateFile = options.cliStateFileOverride ?? join(stateDir, "cli", "state.json");
  const cliDir = dirname(cliStateFile);
  try {
    await mkdir(cliDir, { recursive: true, mode: 0o700 });
  } catch (cause) {
    return err({ kind: "permission", path: cliDir, cause });
  }
  return ok({ stateDir, cliStateFile });
}
