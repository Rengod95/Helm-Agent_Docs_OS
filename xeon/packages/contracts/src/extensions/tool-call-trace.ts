// 도구 호출 추적의 읽기 전용 싱크(정본 docs/xeon/review/m5/turn-record-metrics.md §3.2, §4.1 규칙 2·7, §4.3).
// core-tools가 도구 호출 하나를 닫을 때 `record`로 한 줄을 넘긴다. 한 방향 호출이고 반환값은 호출 경로로 돌아가지 않는다.
// 결과 본문과 인자 값은 싣지 않는다. 인자는 정규화 JSON의 SHA-256 hex만 싣는다. 문자열 인자의 토큰 목록(`argTokens`)만 원본이 이 줄에 실리는데,
// 프로세스 안에서만 쓰이고 호스트가 설치 소금으로 HMAC해 저장한다(원본 토큰은 저장하지 않는다).
// 판정 목록은 턴 기록 와이어(`wire/turn-record.ts`의 `VERDICTS`)가 이 목록을 가져다 쓴다(F 디렉터리 순서상 extensions가 앞이다).

/**
 * 도구 호출의 판정 열네 가지. 막음(intent)과 고장(fault)은 다른 값이다.
 * 저장 문자열의 정본이고 순서도 정본 순서다
 */
export const TOOL_CALL_VERDICTS = [
  "allowed", // 실행됨
  "blocked_hook", // tool.call.before 핸들러가 막는 결정을 냄(뜻을 가진 거부)
  "blocked_hook_fault", // tool.call.before 핸들러의 실패·시간 초과·검사 실패가 거부로 대체됨
  "blocked_guard", // guard.tool.before 핸들러가 막는 결정을 냄
  "blocked_guard_fault", // guard.tool.before 핸들러 실패가 거부로 대체됨
  "denied_policy", // 정책 규칙이 거부
  "denied_human", // 사람이 물음(정책 ask 또는 훅의 ask)에 거부로 답함
  "denied_noninteractive", // 사람이 없는 실행이라 묻지 않고 거부(approval.resolvedBy: "noninteractive"). 훅 묻기가 무인 정책으로 거부된 경우 포함
  "replaced_hook", // tool.call.before의 replace가 실행 없이 결과를 대신 줌(effectId null)
  "blocked_spawn", // agent.spawn.before가 서브에이전트 생성을 막음(spawn의 판정)
  "cancelled_ask", // ask.human.before가 카드를 취소함
  "aborted", // 턴 중단
  "invalid_args", // 스키마 검증 실패
  "unavailable", // 도구 이름을 못 찾음
] as const;
export type ToolCallVerdict = (typeof TOOL_CALL_VERDICTS)[number];

/**
 * 도구 호출 한 건이 닫힐 때의 사실. 저장 모양(`CallRecord`)의 원천이고, 호스트가 턴 단위로 모은다.
 * 값은 모두 평평한 데이터다. 인자 값, 결과 본문, 시크릿은 없다
 */
export interface ToolCallTraceEvent {
  readonly threadId: string;
  /** 호출이 속한 턴. 턴에 속하지 않는 호출(턴 밖 플러그인 호출)은 null */
  readonly turnId: string | null;
  /** 호출이 속한 단계. 턴이 없으면 null */
  readonly stepId: string | null;
  readonly toolCallId: string;
  /** 플러그인 도구 안에서 부른 호출이면 바깥 도구 호출 id */
  readonly parentToolCallId: string | null;
  readonly tool: string;
  /** 도구의 소유자. 기능 도구는 기능 id, 확장 도구는 확장 이름이다. 등록되지 않은 도구는 null */
  readonly plugin: string | null;
  readonly caller: "main" | "subagent" | "plugin";
  /** caller가 plugin이면 플러그인 이름 */
  readonly callerPlugin: string | null;
  /** 호출이 들어온 길(`PluginCallRequest.via`). 모델이 부른 호출이면 null */
  readonly via: "hook" | "tool" | "command" | "method" | "drive" | "effect" | null;
  /** 위험 등급. 등록되지 않은 도구는 null */
  readonly risk: "read" | "write" | "exec" | null;
  readonly capability: { readonly id: string; readonly method: string } | null;
  /** 인자 정규화 JSON의 SHA-256 hex(파이프라인의 argsHash와 같다). 원본 인자는 싣지 않는다 */
  readonly argsHash: string;
  /** 인자 정규화 JSON 글자 수의 4분의 1 올림(어림 토큰 수) */
  readonly argTokenCount: number;
  /**
   * 최상위 문자열 인자의 토큰 목록(원본, 최대 64개, 토큰당 64글자). 프로세스 안에서만 쓰인다. 호스트가 설치 소금으로 HMAC해 저장한다
   * (§5.1-②). 문자열 인자가 없으면 빈 목록이다
   */
  readonly argTokens: readonly string[];
  /** 도구가 선언한 대상 경로 집합을 정렬해 정규화 JSON으로 적은 값의 SHA-256 hex. 선언이 없으면 null */
  readonly targetHash: string | null;
  /** 이 호출이 시작될 때 같은 턴이 웹·MCP 결과를 이미 읽었나 */
  readonly afterUntrusted: boolean;
  readonly verdict: ToolCallVerdict;
  /** 막음·대체를 낸 핸들러. 정책과 승인이 막은 호출이면 null */
  readonly blockedBy: {
    readonly plugin: string | null;
    readonly hook: string | null;
    readonly registrationId: string | null;
  } | null;
  readonly policy: {
    readonly effect: "allow" | "ask" | "deny";
    readonly tier: string | null;
  } | null;
  readonly approval: {
    readonly approvalId: string;
    readonly decision: "allow" | "deny" | "answer";
    readonly resolvedBy: string;
    /** 승인 요청부터 해결까지의 시간(ms) */
    readonly waitMs: number;
    /** 바깥 플러그인 호출의 승인을 물려받아 카드를 건너뛴 경우 그 바깥 approvalId(U-11) */
    readonly inheritedFrom: string | null;
  } | null;
  /** 실행을 시작한 호출만 있다. `startedAt`은 Clock의 epoch ms다 */
  readonly exec: {
    readonly startedAt: number;
    readonly durationMs: number | null;
    readonly status: "ok" | "error" | "interrupted" | "abandoned";
    readonly effectId: string | null;
  } | null;
  readonly result: {
    /** 결과 본문 글자 수의 4분의 1 올림 */
    readonly tokens: number;
    /** 결과 본문 텍스트의 UTF-8 바이트 수 */
    readonly bytes: number;
    readonly truncated: boolean;
    readonly isError: boolean;
    readonly itemId: string | null;
  } | null;
  /** 호출이 닫힌 시각(Clock, epoch ms) */
  readonly closedAt: number;
}

/**
 * 도구 호출 추적을 받는 싱크. 읽기 전용이다. 구현은 호출 경로의 값을 바꾸지 않아야 하고, 실패는 호출자가 경고로 흡수한다.
 * 싱크가 없으면 파이프라인은 기록 값을 만들지도 않는다
 */
export interface ToolCallTraceSink {
  record(event: ToolCallTraceEvent): void;
}
