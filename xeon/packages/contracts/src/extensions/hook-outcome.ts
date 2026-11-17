import { assertNever } from "../base/index.ts";

// 훅 결과의 표시값(M5e 스펙 §4.5). 저장 열이 아니라 기록된 값(result, reason, decision)에서 파생한다.
// 기록 스펙이 저장하고, 이 변환을 다시 정의하지 않는다. 화면의 돌려 보기와 턴 기록이 같은 함수를 쓴다.

/** 표시값 여섯 */
export type HookOutcome = "pass" | "modified" | "asked" | "blocked" | "error" | "timeout";
/** 건너뜀은 여섯 값에 없어서 화면이 일곱째로 따로 보인다 */
export type HookOutcomeOrSkipped = HookOutcome | "skipped";

/** 기록된 결과값(기록 스펙 m5d §3.2). 저장 문자열 그대로다 */
export type HookRunResult = "passed" | "modified" | "blocked" | "failed" | "skipped";
/** 기록된 이유. `failed`일 때만 있다 */
export type HookRunReason =
  | "threw"
  | "timeout"
  | "result_invalid"
  | "merge_rejected"
  | "process_exit"
  | "process_killed";
/** 기록된 결정. 값이 없으면 `none`이다 */
export type HookRunDecision = "none" | "block" | "ask" | "replace" | "cancel" | "answer";

/** 한 핸들러 실행의 기록된 값 */
export interface HookRunRecord {
  readonly result: HookRunResult;
  readonly reason?: HookRunReason;
  readonly decision?: HookRunDecision;
}

/**
 * 기록된 값을 표시값으로 바꾼다(§4.5 변환표). 순수 함수.
 * 표에 없는 조합은 결과 열을 따른다: `passed`에 `block`이 붙으면 막음으로 본다(막음은 `blocked`로 기록되는 것이 정상이다).
 */
export function hookOutcomeOf(run: HookRunRecord): HookOutcomeOrSkipped {
  switch (run.result) {
    case "skipped":
      return "skipped";
    case "failed":
      // 시간 초과만 `timeout`이다. 막음과 달리 값을 내지 못한 실패라서 표시도 다르다
      return run.reason === "timeout" ? "timeout" : "error";
    case "blocked":
      return "blocked";
    case "modified":
      return "modified";
    case "passed":
      return passedOutcome(run.decision ?? "none");
    default:
      return assertNever(run.result, "HookRunResult");
  }
}

/** `passed`(값을 냈지만 결과를 막거나 고치지 않은 실행)의 결정별 표시값 */
function passedOutcome(decision: HookRunDecision): HookOutcome {
  switch (decision) {
    case "none":
      return "pass";
    case "replace":
    case "answer":
      return "modified";
    case "ask":
      return "asked";
    case "cancel":
    case "block":
      return "blocked";
    default:
      return assertNever(decision, "HookRunDecision");
  }
}
