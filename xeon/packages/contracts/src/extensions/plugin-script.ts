import type { Result } from "../base/index.ts";
import type { ThreadId } from "../conversation/index.ts";
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
  /**
   * 부른 훅이나 주도가 돌던 대화. 엔진이 호출을 낳은 요청의 문맥에서 붙인다. 문맥이 없으면 없다.
   * 초안(검토 전 버전)의 스크립트는 이 대화가 테스트 런일 때만 승인 카드를 거쳐 돈다(`ScriptDraftGate`) [제안, AGE-58]
   */
  readonly threadId?: ThreadId;
}

/**
 * 승인 카드에 싣는 실행 내용(설계 B, AGE-58 [제안]). 카드는 이것으로 "무엇이 돌게 되는지"를 보여 준다.
 * `command`는 실행기의 절대 경로, `args`는 스크립트 파일(절대 경로)과 선언된 인자다. `envNames`는 스크립트가 선언한 환경 변수 가운데 자식에게 넘기는 이름이고 값은 싣지 않는다.
 * 열린 정책은 사용자 환경 전부(`FRESNEL_` 이름 제외)를 더 넘기며, 그것은 `uses`의 `user_environment`가 알린다.
 * `stdinPreview`는 표준 입력의 앞부분(가림 규칙을 지난 값)이다
 */
export interface ScriptCard {
  readonly command: string;
  readonly args: readonly string[];
  readonly envNames: readonly string[];
  readonly stdinBytes: number;
  readonly stdinPreview: string;
  /**
   * 승인하면 이 스크립트가 쓸 수 있는 것(AGE-58 [제안]). 열린 정책의 스크립트는 `sandbox_full_access`(읽기·쓰기·시스템 도구, 막는 것은 보호 셋뿐),
   * `user_environment`(자식 env는 사용자 환경에서 `FRESNEL_` 이름만 뺀 것), `network`(차단 목록 밖 전체)를 싣는다. 승인 전 드래프트의 좁은 길은 `SCRIPT_NARROW_USES`다
   */
  readonly uses: readonly ScriptUse[];
}

/** 스크립트 카드가 알리는 권한 */
export type ScriptUse =
  /**
   * 열린 정책(승인된 플러그인의 스크립트의 기본) [결정: 2026-11-21, 사용자, AGE-63]: 샌드박스 안에서 셸 도구와 같이 읽고 쓰고 시스템 도구를 쓴다.
   * 막는 것은 사용자가 막은 경로, Fresnel 자신의 비밀·데이터·설정, 차단 도메인뿐이다
   */
  | "sandbox_full_access"
  /** 좁은 길(승인 전 드래프트, 설정 `narrowDrafts`): `/bin`, `/usr/bin`의 도구(`grep`, `sed`, `git` 등)를 읽고 실행하는 것. 쓰기와 폴더 밖 읽기는 막힌다 */
  | "system_tools"
  | "network"
  /** 사용자의 PATH와 환경 변수로 돈다. Fresnel 자신의 내부 값(`FRESNEL_*`)만 뺀다. 환경 모드와 열린 정책이 같다 [결정: 2026-11-20, 사용자, AGE-58; 2026-11-21, AGE-63] */
  | "user_environment"
  /** 환경 모드(기본): 사용자 권한 그대로 돈다. Fresnel이 읽기·쓰기·도구를 막지 않는다(샌드박스 없음) [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해"] */
  | "user_full_access"
  /** 환경 모드, 설정 `l0.sandbox.sandboxImportedHooks`를 켠 때: 보호 경로(시크릿 폴더)를 뺀 모든 파일을 읽는다 */
  | "read_wide"
  /** 환경 모드, 같은 설정을 켠 때: 프로젝트 폴더와 훅 전용 임시 폴더에 쓴다. 홈과 그 밖은 쓰지 못한다 */
  | "write_project";

/**
 * 열린 정책의 스크립트가 쓸 수 있는 것 전부 [결정: 2026-11-21, 사용자, AGE-63]. 셸 도구와 같이 읽고 쓰고 시스템 도구를 쓴다. 막는 것은 사용자가 막은 경로,
 * Fresnel 자신의 비밀·데이터·설정, 차단 도메인뿐이다. 자식 env는 사용자 환경 전부에서 `FRESNEL_` 이름만 뺀 값이다.
 * 승인 카드(초안 호출)와 검토 카드(`CardScript.uses`)가 같은 값을 싣는다. 승인된 플러그인의 스크립트와, 좁은 길을 끈 승인 전 드래프트의 스크립트가 이 값이다
 */
export const SCRIPT_USES: readonly ScriptUse[] = [
  "sandbox_full_access",
  "user_environment",
  "network",
];

/**
 * 승인 전 드래프트의 스크립트가 좁은 길(설정 `l0.sandbox.narrowDrafts`를 켰을 때)에서 쓸 수 있는 것 [결정: 2026-11-21, 사용자, AGE-63].
 * 자기 폴더를 읽고 시스템 도구를 쓰지만 쓰지 못하고 폴더 밖을 읽지 못한다. 자식 env는 허용 목록뿐이다. 네트워크는 차단 목록 밖 전체다
 */
export const SCRIPT_NARROW_USES: readonly ScriptUse[] = ["system_tools", "network"];

/**
 * 환경 모드 스크립트(가져온 훅)가 기본으로 쓸 수 있는 것 [결정: 2026-11-20, 사용자, AGE-58]. 다른 하네스(Claude Code, Codex CLI, Cursor, Gemini CLI)처럼 사용자 권한 그대로 돈다:
 * 샌드박스 없음, 사용자 환경 변수(Fresnel 내부 값 제외), 네트워크 전체. 이 앞 결정 "전체 가"의 시크릿 읽기 거부와 프로젝트 쓰기만을 이 값이 대신한다
 */
export const SCRIPT_ENV_USES: readonly ScriptUse[] = [
  "user_full_access",
  "user_environment",
  "network",
];

/**
 * 환경 모드 스크립트를 샌드박스 안에서 돌리는 설정(`l0.sandbox.sandboxImportedHooks`, 기본 끔)을 켰을 때의 권한. 보호 경로 읽기 거부, 프로젝트와 훅 임시 폴더에만 쓰기, 도구와 Mach 서비스 막기
 */
export const SCRIPT_ENV_SANDBOXED_USES: readonly ScriptUse[] = [
  "user_environment",
  "read_wide",
  "write_project",
  "network",
];

/**
 * 환경 모드 선언을 받아들여도 되는가의 근거(AGE-58 [제안], 가장 중요한 안전 조건). 매니페스트의 `env` 선언은 권한이 아니다.
 * 호스트가 검토본의 기록(승인한 검토 항목의 출처가 마이그레이션)에서만 `granted: true`를 만든다. 초안, 사용자 폴더, 빌더, 손으로 만든 플러그인은 `granted: false`다.
 * `projectDir`은 작업 폴더와 쓰기 루트가 되는 프로젝트 폴더(절대 경로)이고, 없으면 환경 모드는 돌지 못한다
 */
export interface ScriptEnvGrant {
  readonly granted: boolean;
  readonly projectDir: string | null;
  /** 프로젝트가 싣고 온 훅인가(카드의 "프로젝트에서 온 코드" 표시) */
  readonly fromProject: boolean;
}

/** 표준 입력 미리보기의 글자 수 상한 [제안]. 넘는 부분은 잘린다 */
export const SCRIPT_CARD_PREVIEW_CHARS = 200;

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
  /**
   * 승인 카드(또는 정책, 훅)가 이 호출을 거절했거나 카드가 끝나지 않았다. 스크립트는 돌지 않았다.
   * `cause`는 도구 호출 실패 종류(`ToolErrorKind`)와 같은 문자열이고 `resolvedBy`는 누가 거절했는지다(없으면 거절한 쪽이 없다)
   */
  | {
      readonly kind: "script_denied";
      readonly cause: string;
      readonly resolvedBy?: "policy" | "human" | "noninteractive";
    }
  | { readonly kind: "spawn_failed"; readonly code: string; readonly message: string }
  /** 샌드박스에 넣어야 하는데 이 기기에서 격리할 수 없다. 격리 없이 띄우지 않는다(닫힌 실패) */
  | { readonly kind: "sandbox_unavailable"; readonly reason: string }
  /** 환경 모드 선언인데 이 플러그인은 받을 자격이 없다(마이그레이션 출처로 승인된 검토본이 아님, 초안, 프로젝트 폴더 없음). 돌지 않았다 [제안, AGE-58] */
  | { readonly kind: "script_env_not_granted" }
  /** 참조한 파일이 가져올 때와 다르거나 없다. 돌지 않았다. 다시 가져오기(검토)가 필요하다 [제안, AGE-58] */
  | {
      readonly kind: "script_ref_changed";
      readonly path: string;
      readonly reason: "changed" | "missing" | "unreadable";
    };

/** 초안 스크립트 호출 하나. 승인 문(`ScriptDraftGate`)이 카드로 열고, 승인되면 `run`을 부른다 */
export interface ScriptDraftCall {
  /** 확장 이름(초안의 내부 이름) */
  readonly extension: string;
  /** 부른 플러그인의 Registration id */
  readonly registration: RegistrationId;
  readonly threadId: ThreadId;
  /** 매니페스트 `scripts`의 이름 */
  readonly name: string;
  readonly card: ScriptCard;
  /** 승인된 뒤에만 부른다. 샌드박스 안에서 스크립트를 띄우고 끝나길 기다린다 */
  readonly run: (signal: AbortSignal) => Promise<Result<ScriptRunResult, ScriptRunFailure>>;
}

/**
 * 초안 스크립트의 승인 문. 엔진 조립 루트가 준다(없으면 초안 스크립트는 `script_not_approved`다).
 * 구현은 이 대화가 테스트 런이고 확장이 그 대화에 묶인 초안인지를 보고, 맞으면 호출마다 승인 카드를 열고, 승인한 호출만 `run`을 부른다.
 * 일반 대화이거나 묶이지 않은 초안이면 `script_not_approved`다. 승인은 상속하지 않는다. 드래프트 승인 `auto`인 테스트 런에는 카드가 없고, 그 밖에는 스크립트마다 처음 한 번만 묻는다: 승인하면 이 테스트 런 동안 같은 초안 내용의 같은 스크립트는 다시 묻지 않는다(`PluginCallTarget`의 `memoryKey`, 기억 범위 `thread`) [결정: 2026-11-19, 사용자, AGE-58]
 */
export type ScriptDraftGate = (
  call: ScriptDraftCall,
) => Promise<Result<ScriptRunResult, ScriptRunFailure>>;

/**
 * 스크립트 실행 포트. 엔진(X)이 구현한다. 구현은 선언, 위치, 승인, 돌려 보기 플래그를 이 순서로 검사하고, 통과하면
 * `IsolationProcessPort.spawn`으로 읽기 허용 목록과 no-write 프로필 안에서 띄운다(프로필을 넓히지 않는다, drive-isolation §3.4)
 */
export interface PluginScriptPort {
  run(request: ScriptRunRequest): Promise<Result<ScriptRunResult, ScriptRunFailure>>;
}
