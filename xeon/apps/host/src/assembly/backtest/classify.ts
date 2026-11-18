import { assertNever } from "@fresnel/contracts";
import { decisionKindOf, type DecisionKind } from "@fresnel/contracts/extensions";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { BacktestClass, BacktestItem, Verdict } from "@fresnel/contracts/wire";
import type { CandidateOutcome, ReplayPoint } from "@fresnel/ext-host";

// 지난 턴에 돌려 보기의 분류(turn-record-metrics.md §4.8 규칙 49). 후보의 결과와 실제 판정의 짝으로 정한다.
// 이 파일은 순수하다. 후보 결과는 실행기의 `CandidateOutcome`을 `CandidateVerdict`로 옮긴 뒤 본다.

/** 후보가 낸 결정. `modify`는 `tool.result`가 값을 바꾼 것이다 */
type CandidateDecision = "none" | "block" | "ask" | "replace" | "modify";

/** 후보 한 번의 결과. 고장(`fault`)은 막음이 아니다 */
export type CandidateVerdict =
  | {
      readonly kind: "decided";
      readonly decision: CandidateDecision;
      readonly reason: string | null;
      readonly ms: number;
    }
  | {
      readonly kind: "fault";
      readonly fault: "threw" | "timeout" | "replay_denied" | "process_failed";
      readonly message: string;
      readonly ms: number;
    };

/** 반환 문자열의 상한(`BacktestItem.candidate.reason`, 512자) */
const REASON_MAX = 512;

function reasonOf(value: JsonValue): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("reason" in value)) return null;
  const reason: unknown = value.reason;
  return typeof reason === "string" ? reason.slice(0, REASON_MAX) : null;
}

/**
 * 실행기의 결과를 후보 결과로 옮긴다. `returned`의 값이 결정 모양이 아니면 후보의 실패(`threw`)다.
 * 실행기는 결정 모양을 스키마로 이미 검사하므로 이 경우는 드물다.
 */
export function verdictOfOutcome(point: ReplayPoint, outcome: CandidateOutcome): CandidateVerdict {
  switch (outcome.kind) {
    case "returned": {
      if (outcome.value === null)
        return { kind: "decided", decision: "none", reason: null, ms: outcome.ms };
      if (point === "tool.result") {
        return { kind: "decided", decision: "modify", reason: null, ms: outcome.ms };
      }
      const kind: DecisionKind | null = decisionKindOf(outcome.value);
      if (kind === null) {
        return {
          kind: "fault",
          fault: "threw",
          message: "the decision has no known shape",
          ms: outcome.ms,
        };
      }
      return { kind: "decided", decision: kind, reason: reasonOf(outcome.value), ms: outcome.ms };
    }
    case "threw":
      return { kind: "fault", fault: "threw", message: outcome.message, ms: outcome.ms };
    case "timeout":
      return {
        kind: "fault",
        fault: "timeout",
        message: "the candidate hook timed out",
        ms: outcome.ms,
      };
    case "replay_denied":
      return {
        kind: "fault",
        fault: "replay_denied",
        message: "a call the replay denies was made",
        ms: outcome.ms,
      };
    case "process_failed":
      return { kind: "fault", fault: "process_failed", message: outcome.message, ms: outcome.ms };
    default:
      return assertNever(outcome, "CandidateOutcome");
  }
}

/** 항목의 `candidate.result` 값 여덟 가운데 실행이 낸 일곱 값. 건너뜀은 서비스가 정한다 */
export function candidateResultOf(verdict: CandidateVerdict): {
  readonly result: "pass" | "block" | "modify" | "ask" | "replace" | "failed" | "timeout";
  readonly reason: string | null;
  readonly ms: number;
} {
  if (verdict.kind === "fault") {
    const result = verdict.fault === "timeout" ? "timeout" : "failed";
    return { result, reason: verdict.message.slice(0, REASON_MAX), ms: verdict.ms };
  }
  switch (verdict.decision) {
    case "none":
      return { result: "pass", reason: null, ms: verdict.ms };
    case "modify":
      return { result: "modify", reason: null, ms: verdict.ms };
    case "block":
      return { result: "block", reason: verdict.reason, ms: verdict.ms };
    case "ask":
      return { result: "ask", reason: verdict.reason, ms: verdict.ms };
    case "replace":
      return { result: "replace", reason: verdict.reason, ms: verdict.ms };
    default:
      return assertNever(verdict.decision, "CandidateDecision");
  }
}

/** 실제 판정이 멈춘 곳. `hook`은 다른 훅이 막았다, `policy`는 정책이나 사람이나 그 밖의 이유로 막았다 */
type LiveStop = "none" | "hook" | "policy";

/** 실제 판정 값을 멈춘 곳으로 나눈다. 훅이 막은 값(`blocked_hook`·`replaced_hook`·가드)과 정책·사람·그 밖의 값을 가른다 */
function liveStopOf(verdict: Verdict): LiveStop {
  switch (verdict) {
    case "allowed":
      return "none";
    case "blocked_hook":
    case "blocked_hook_fault":
    case "blocked_guard":
    case "blocked_guard_fault":
    case "replaced_hook":
      return "hook";
    case "denied_policy":
    case "denied_human":
    case "denied_noninteractive":
    case "cancelled_ask":
    case "blocked_spawn":
    case "aborted":
    case "invalid_args":
    case "unavailable":
      return "policy";
    default:
      return assertNever(verdict, "Verdict");
  }
}

/** 가드 지점에 닿았나. 가드가 도는 판정은 허용과 가드가 낸 막힘뿐이다(정책과 `tool.call.before`가 먼저다, §4.8 규칙 49) */
function guardReachedBy(verdict: Verdict): boolean {
  return verdict === "allowed" || verdict === "blocked_guard" || verdict === "blocked_guard_fault";
}

/** 분류 입력. 기록된 값과 후보의 결과다 */
export interface ClassifyInput {
  readonly point: ReplayPoint;
  readonly verdict: Verdict;
  /** 실제 막은 훅의 이름(`blockedBy.hook`)과 막은 플러그인 */
  readonly blockedHook: string | null;
  /** 승인 결정(`approval.decision`). 승인이 없으면 null */
  readonly approval: "allow" | "deny" | "answer" | null;
  readonly candidate: CandidateVerdict;
}

/** 분류 결과. `skippedBy`는 `already_stopped`이고 앞 훅이 멈춘 경우에만 있다 */
export interface Classified {
  readonly class: BacktestClass;
  readonly skippedBy: string | null;
}

function stopsCall(decision: CandidateDecision): boolean {
  return decision === "block" || decision === "ask" || decision === "replace";
}

/**
 * 규칙 49의 순서대로 분류한다. 먼저 후보가 그 호출에 닿았는지 본다(가드는 앞 훅이 멈추면 닿지 못한다).
 * 닿지 못했으면 `already_stopped`이고, 멈춘 것이 훅이면 그 훅 이름이 `skippedBy`다. 그다음 고장, 막음, 통과 순이다.
 */
export function classifyCall(input: ClassifyInput): Classified {
  const stop = liveStopOf(input.verdict);
  if (input.point === "guard.tool.before" && !guardReachedBy(input.verdict)) {
    return {
      class: "already_stopped",
      skippedBy: stop === "hook" ? input.blockedHook : null,
    };
  }
  if (input.candidate.kind === "fault") return { class: "candidate_fault", skippedBy: null };
  if (!stopsCall(input.candidate.decision)) return { class: "passes_same", skippedBy: null };
  if (stop === "none") {
    // 사람이 허용했던 호출을 후보가 막았거나 물었다면 과한 차단일 수 있어 따로 센다
    return {
      class: input.approval === "allow" ? "would_block_allowed_by_human" : "newly_caught",
      skippedBy: null,
    };
  }
  if (stop === "hook") return { class: "agrees_block", skippedBy: null };
  return { class: "already_stopped", skippedBy: null };
}

/** `unreplayable`인 항목의 후보 결과 자리. 실행하지 않았다는 뜻의 `skipped`다 */
export const SKIPPED_CANDIDATE: BacktestItem["candidate"] = {
  result: "skipped",
  reason: null,
  ms: 0,
};
