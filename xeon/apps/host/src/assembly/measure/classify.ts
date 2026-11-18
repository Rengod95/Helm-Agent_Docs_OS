import { assertNever } from "@fresnel/contracts";
import { TRACE_HANDLER_RESULTS } from "@fresnel/contracts/extensions";

// 턴 기록의 순수 분류(문서 `review/m5/turn-record-metrics.md` §5.1-②, `hooks-core-boundary.md` §4.5). 저장과 읽기가 같은 함수를 쓴다.
// 접기(`turn-fold.ts`)와 원본 계산(`metrics.ts`)이 같은 값을 내야 `tr_daily`로 접힌 창과 원본 창이 같다.

/** 훅 표시값의 일곱 갈래. 여섯 값(`HookOutcome`)에 건너뜀(`skipped`)을 더한다 */
export const HOOK_OUTCOME_CLASSES = [
  "pass",
  "modified",
  "asked",
  "blocked",
  "error",
  "timeout",
  "skipped",
] as const;
export type HookOutcomeClass = (typeof HOOK_OUTCOME_CLASSES)[number];

/** 훅 한 줄의 기록된 값. `hookOutcomeOf`가 읽는 세 칸이다 */
export interface HookRecordedValues {
  readonly result: string;
  readonly reason: string | null;
  readonly decision: string;
}

/**
 * 기록된 `result`·`reason`·`decision`을 표시값 일곱 갈래로 바꾼다(hooks-core-boundary §4.5 변환표).
 * `skipped`는 여섯 값에 없어 일곱째로 둔다. 시간 초과는 `failed`이면서 `reason = timeout`인 경우다.
 */
export function hookOutcomeOf(run: HookRecordedValues): HookOutcomeClass {
  const result = TRACE_HANDLER_RESULTS.find((value) => value === run.result);
  // 목록에 없는 값은 저장 데이터가 깨진 것이다. 표시값을 만들 수 없으니 오류로 센다
  if (result === undefined) return "error";
  switch (result) {
    case "skipped":
      return "skipped";
    case "failed":
      return run.reason === "timeout" ? "timeout" : "error";
    case "blocked":
      return "blocked";
    case "modified":
      return "modified";
    case "passed":
      if (run.decision === "ask") return "asked";
      if (run.decision === "block" || run.decision === "cancel") return "blocked";
      if (run.decision === "replace" || run.decision === "answer") return "modified";
      return "pass";
    default:
      return assertNever(result, "hookOutcomeOf");
  }
}

/** F의 블록 id(`BlockId`, hooks-core-boundary §4.1). 지표와 발견의 `block` 대상이 이 값을 쓴다 */
export const BLOCK_REFS = ["context", "model", "tools", "ask", "agents", "record"] as const;
export type BlockRef = (typeof BLOCK_REFS)[number];

/**
 * 캐시 깨짐 원인 종류 → 블록. 구조 원인은 바뀐 쪽의 블록이고, 공급자 쪽 원인(TTL, 모델 전환, 알 수 없음)은 모델 호출 블록이다.
 * 목록에 없는 종류는 모델 호출 블록으로 센다(저장 값은 그대로 두고 분류만 보수적으로 한다)
 */
const CAUSE_BLOCK: Readonly<Record<string, BlockRef>> = {
  prefix_reset: "context",
  section: "context",
  compaction: "context",
  toolset: "tools",
  overlay_tools: "tools",
  model_switch: "model",
  ttl: "model",
  unknown: "model",
};

export function blockOfCause(kind: string): BlockRef {
  return CAUSE_BLOCK[kind] ?? "model";
}

/** 막음 판정 세 가지. 고장(`*_fault`)과 나머지는 막은 호출이 아니다(§5.1-②) */
const BLOCKING_VERDICTS: ReadonlySet<string> = new Set([
  "blocked_hook",
  "blocked_guard",
  "denied_human",
]);

export function isBlockingVerdict(verdict: string): boolean {
  return BLOCKING_VERDICTS.has(verdict);
}

/** 막힌 뒤 모델의 다음 행동 분류 여섯(§5.1-②). `stopped`는 앞으로 보는 단계에 도구 호출이 없는 경우다 */
const POST_BLOCK_CLASSES = [
  "stopped",
  "repeat",
  "rewrite",
  "rewrite_text",
  "other_tool_same_target",
  "different_path",
] as const;
export type PostBlockClass = (typeof POST_BLOCK_CLASSES)[number];

/** 앞으로 보는 단계 수(§7 미결 3의 제안 기본값) */
const POST_BLOCK_LOOKAHEAD_STEPS = 2;
/** 문자열 인자 토큰 겹침 임계(§7 미결 3의 제안 기본값). 겹침은 Jaccard 비율이다 [제안] */
const REWRITE_TEXT_OVERLAP = 0.8;

/** 분류에 필요한 도구 호출 한 줄 */
export interface PostBlockCall {
  readonly toolCallId: string;
  readonly stepIndex: number;
  readonly tool: string;
  readonly callKey: string;
  readonly targetKey: string | null;
  /** 문자열 인자의 토큰을 설치별 소금으로 가린 목록(`meta_json.argTokens`). 없으면 빈 목록 */
  readonly argTokens: readonly string[];
}

/** 토큰 두 목록의 Jaccard 겹침. 둘 다 비었으면 0이다 */
function tokenOverlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let both = 0;
  for (const token of left) if (right.has(token)) both += 1;
  const union = left.size + right.size - both;
  return union === 0 ? 0 : both / union;
}

/**
 * 막은 호출 하나의 다음 행동 분류. `turnCalls`는 같은 턴의 모든 호출이다(순서 무관).
 * 앞으로 보는 단계(`stepIndex + 1` ~ `+ LOOKAHEAD`)의 호출만 본다. 여러 해당이면 강한 것을 쓴다:
 * repeat > rewrite > other_tool_same_target > rewrite_text > different_path.
 */
export function postBlockClassOf(
  blocked: PostBlockCall,
  turnCalls: readonly PostBlockCall[],
): PostBlockClass {
  const after = turnCalls.filter(
    (call) =>
      call.stepIndex > blocked.stepIndex &&
      call.stepIndex <= blocked.stepIndex + POST_BLOCK_LOOKAHEAD_STEPS,
  );
  if (after.length === 0) return "stopped";
  if (after.some((c) => c.tool === blocked.tool && c.callKey === blocked.callKey)) {
    return "repeat";
  }
  if (
    blocked.targetKey !== null &&
    after.some(
      (c) =>
        c.tool === blocked.tool &&
        c.targetKey === blocked.targetKey &&
        c.callKey !== blocked.callKey,
    )
  ) {
    return "rewrite";
  }
  if (
    blocked.targetKey !== null &&
    after.some((c) => c.tool !== blocked.tool && c.targetKey === blocked.targetKey)
  ) {
    return "other_tool_same_target";
  }
  if (
    blocked.targetKey === null &&
    after.some(
      (c) =>
        c.tool === blocked.tool &&
        c.callKey !== blocked.callKey &&
        tokenOverlap(blocked.argTokens, c.argTokens) >= REWRITE_TEXT_OVERLAP,
    )
  ) {
    return "rewrite_text";
  }
  return "different_path";
}
