import type { Result } from "../base/index.ts";
import type { RegistrationId } from "./registration-id.ts";

// 플러그인이 자기 패키지 폴더의 스크립트를 실행하는 계약(설계 B, F.extensions.spec §3.1.4). 이름 `scripts`, `runScript`,
// `script_*`는 [제안]이다. 선언은 매니페스트 `scripts`(manifest.ts)가 하고, 실행은 엔진이 `PluginScriptPort`로 한다.
// 스크립트는 코드(`entry`)가 `g.runScript(name)`으로 부를 때만 돈다. 부를 코드가 없으면 실행되지 않는다.

/** 스크립트 실행의 상한과 기본값 [제안]. 바이트는 UTF-8 바이트다 */
export const SCRIPT_LIMITS: {
  /** 표준 입력 상한(256 KiB). 넘으면 호출을 거절한다 */
  readonly stdinBytes: number;
  /** 표준 출력과 표준 오류 각각의 상한(64 KiB). 넘는 부분은 버리고 `stdoutTruncated`·`stderrTruncated`를 참으로 한다 */
  readonly outputBytes: number;
  /** 매니페스트 `timeoutMs`를 생략했을 때의 한도(10초) */
  readonly timeoutDefaultMs: number;
  /** 매니페스트 `timeoutMs`의 상한(60초) */
  readonly timeoutMaxMs: number;
} = {
  stdinBytes: 256 * 1024,
  outputBytes: 64 * 1024,
  timeoutDefaultMs: 10_000,
  timeoutMaxMs: 60_000,
};

/** `g.runScript(name, {stdin})`가 엔진에 넘기는 요청. 호출자 신원(플러그인)은 엔진이 연결에서 붙인다 */
export interface ScriptRunRequest {
  /** 부른 플러그인의 Registration id. 엔진이 호출자 신원 `plugin:<이름>`에서 정한다 */
  readonly registration: RegistrationId;
  /** 매니페스트 `scripts`의 이름. 선언에 없으면 `script_not_declared`다 */
  readonly name: string;
  /** 표준 입력. 생략된 입력은 빈 문자열로 온다. 상한 `SCRIPT_LIMITS.stdinBytes` */
  readonly stdin: string;
  /** 돌려 보기 요청이면 참. 스크립트를 띄우지 않고 `replay_mode_denied`로 거절한다 */
  readonly replay: boolean;
}

/** 실행이 끝난 결과. 종료 코드가 없고 신호로 끝났거나 기한으로 멈춰졌으면 `exitCode`는 null이다 */
export interface ScriptRunResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stdoutTruncated: boolean;
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  /** 기한(`timeoutMs`)이 지나 프로세스 트리를 멈췄는가 */
  readonly timedOut: boolean;
}

/**
 * 스크립트를 실행하지 못한 이유(예상 가능한 실패, TY-11). 앞의 다섯은 띄우기 전에 엔진이 정하는 거절이다.
 * `spawn_failed`와 `sandbox_unavailable`은 `IsolationSpawnError`와 같은 뜻이다
 */
export type ScriptRunFailure =
  /** 매니페스트 `scripts`에 없는 이름 */
  | { readonly kind: "script_not_declared" }
  /** `file`이 플러그인 폴더 밖을 가리킨다(렉시컬 `..`, 절대 경로, 또는 실제 위치가 심볼릭 링크로 밖) */
  | { readonly kind: "script_outside_tree" }
  /** 파일이 없거나 일반 파일이 아니다 */
  | { readonly kind: "script_missing" }
  /** 승인되지 않은 버전(초안)이다. 일반 대화에서는 실행하지 않는다 */
  | { readonly kind: "script_not_approved" }
  /** 돌려 보기 요청에서 부른 것이다 */
  | { readonly kind: "replay_mode_denied" }
  | { readonly kind: "spawn_failed"; readonly code: string; readonly message: string }
  /** 샌드박스에 넣어야 하는데 이 기기에서 격리할 수 없다. 격리 없이 띄우지 않는다(닫힌 실패) */
  | { readonly kind: "sandbox_unavailable"; readonly reason: string };

/**
 * 스크립트 실행 포트. 엔진(X)이 구현한다. 구현은 선언, 위치, 승인, 돌려 보기 플래그를 이 순서로 검사하고, 통과하면
 * `IsolationProcessPort.spawn`으로 읽기 허용 목록과 no-write 프로필 안에서 띄운다(프로필을 넓히지 않는다, drive-isolation §3.4)
 */
export interface PluginScriptPort {
  run(request: ScriptRunRequest): Promise<Result<ScriptRunResult, ScriptRunFailure>>;
}
