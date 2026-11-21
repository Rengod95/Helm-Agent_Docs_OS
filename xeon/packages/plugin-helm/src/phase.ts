import type { SpawnOutcome, TurnOutcome } from "@fresnel/contracts/extensions";
import { assertNever, type Result } from "@fresnel/contracts";
import { dedupeFindings, parseExplorerAnswer } from "./findings.ts";
import type { HelmFailure } from "./failures.ts";
import type { InquiryFinishedPayload, InquiryOutcome } from "./records.ts";
import {
  INITIAL_HELM_STATE,
  type HelmFinding,
  type HelmLens,
  type HelmPending,
  type HelmPhase,
  type HelmSource,
  type HelmState,
} from "./state.ts";

export type HelmEvent =
  | { readonly type: "requested"; readonly pending: HelmPending }
  | { readonly type: "leaseGranted"; readonly lenses: readonly HelmLens[] }
  /** 발산이나 적용 턴을 냈다. 결과를 받기 전에 커밋한다(`awaitingTurn`을 켠다) */
  | { readonly type: "turnIssued" }
  | { readonly type: "diverged"; readonly outcome: TurnOutcome }
  | { readonly type: "lensesStarted" }
  /** 렌즈 하나의 spawn이 끝났다. 완료된 답은 발견이 되고, 그 밖의 결과는 이 렌즈의 실패다. 단계는 바뀌지 않는다 */
  | {
      readonly type: "lensFinished";
      readonly lensId: string;
      readonly outcome: Result<SpawnOutcome, HelmFailure>;
    }
  /** 렌즈 실행을 마친다. 아직 끝나지 않은 렌즈는 건너뛴다 */
  | { readonly type: "explored" }
  | {
      readonly type: "converged";
      readonly findings: readonly HelmFinding[];
      readonly context: readonly HelmSource[];
    }
  | { readonly type: "applied"; readonly outcome: TurnOutcome }
  | { readonly type: "stopRequested" }
  | { readonly type: "limitReached"; readonly limit: "turns" | "spawns" | "tokens" }
  | { readonly type: "failed"; readonly failure: HelmFailure };

export interface TransitionResult {
  readonly state: HelmState;
  /** 이 전이로 탐구가 끝났으면 종료 정보. inquiry.finished로 기록한다 */
  readonly finished?: InquiryFinishedPayload;
}

/** 표 검사용. L3.helm.spec §4.2 전이표와 같은 데이터. 결과에 따라 갈리는 전이는 정상 결과의 다음 단계를 싣는다 */
export const TRANSITIONS: readonly {
  readonly from: HelmPhase;
  readonly on: HelmEvent["type"];
  readonly to: HelmPhase;
}[] = [
  { from: "idle", on: "requested", to: "idle" },
  { from: "idle", on: "leaseGranted", to: "diverge" },
  { from: "idle", on: "stopRequested", to: "idle" },
  { from: "diverge", on: "turnIssued", to: "diverge" },
  { from: "diverge", on: "diverged", to: "explore" },
  { from: "diverge", on: "stopRequested", to: "idle" },
  { from: "diverge", on: "limitReached", to: "idle" },
  { from: "diverge", on: "failed", to: "idle" },
  { from: "explore", on: "lensesStarted", to: "explore" },
  { from: "explore", on: "lensFinished", to: "explore" },
  { from: "explore", on: "explored", to: "converge" },
  { from: "explore", on: "stopRequested", to: "idle" },
  { from: "explore", on: "limitReached", to: "idle" },
  { from: "explore", on: "failed", to: "idle" },
  { from: "converge", on: "converged", to: "apply" },
  { from: "converge", on: "stopRequested", to: "idle" },
  { from: "converge", on: "limitReached", to: "idle" },
  { from: "converge", on: "failed", to: "idle" },
  { from: "apply", on: "turnIssued", to: "apply" },
  { from: "apply", on: "applied", to: "idle" },
  { from: "apply", on: "stopRequested", to: "idle" },
  { from: "apply", on: "limitReached", to: "idle" },
  { from: "apply", on: "failed", to: "idle" },
];

function finishedOf(
  state: HelmState,
  outcome: InquiryOutcome,
  extra: {
    readonly limit?: "turns" | "spawns" | "tokens";
    readonly reason?: string;
    readonly appliedTurnId?: string | null;
  } = {},
): InquiryFinishedPayload {
  return {
    inquiryId: state.inquiryId ?? "h".padEnd(14, "a"),
    outcome,
    topic: state.topic ?? "",
    rounds: state.round,
    lensCount: state.lenses.length,
    failedLenses: state.lenses.filter((lens) => lens.status === "failed").length,
    skippedLenses: state.lenses.filter((lens) => lens.status === "skipped").length,
    findingCount: state.findings.length,
    appliedTurnId: extra.appliedTurnId ?? state.appliedTurnId,
    ...(extra.limit === undefined ? {} : { limit: extra.limit }),
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
  };
}

/** idle로 돌아간다. 탐구 필드를 초기값으로 되돌리고 appliedTurnId는 남긴다 */
function toIdle(state: HelmState, finished: InquiryFinishedPayload): TransitionResult {
  const appliedTurnId = finished.appliedTurnId ?? state.appliedTurnId;
  return {
    state: { ...INITIAL_HELM_STATE, watch: state.watch, pending: state.pending, appliedTurnId },
    finished,
  };
}

function reasonOf(failure: HelmFailure): string {
  switch (failure.kind) {
    case "state_too_large":
      return "state too large";
    case "state_inconsistent":
      return `state inconsistent: ${failure.detail}`.slice(0, 500);
    case "turn":
      return `${failure.phase} turn ${failure.status}`;
    case "refused":
      return `refused ${failure.code}`.slice(0, 500);
    case "lease_lost":
    case "budget":
    case "state_conflict":
    case "storage":
    case "disabled":
    case "capability":
    case "spawn":
      return failure.kind;
    default:
      return assertNever(failure, "reasonOf");
  }
}

/** 렌즈 실행을 마친다. 아직 끝나지 않은 렌즈는 건너뛰고, 하나도 끝나지 않았으면 탐구가 실패로 끝난다 */
function explored(state: HelmState): TransitionResult {
  const lenses = state.lenses.map((lens): HelmLens => {
    if (lens.status === "pending" || lens.status === "running")
      return { ...lens, status: "skipped" };
    return lens;
  });
  const next: HelmState = { ...state, lenses };
  if (lenses.every((lens) => lens.status !== "done")) {
    return toIdle(next, finishedOf(next, "failed", { reason: "all lenses failed" }));
  }
  return { state: { ...next, phase: "converge" } };
}

/**
 * 렌즈 하나의 결과를 반영한다. 완료된 답은 `parseExplorerAnswer`로 발견이 되고 발견 목록은 `dedupeFindings`로 합친다.
 * 실행 중이던 렌즈가 아니면 그대로 둔다
 */
function lensFinished(
  state: HelmState,
  lensId: string,
  outcome: Result<SpawnOutcome, HelmFailure>,
): TransitionResult {
  const found: HelmFinding[] = [];
  const lenses = state.lenses.map((lens): HelmLens => {
    if (lens.id !== lensId || lens.status !== "running") return lens;
    if (!outcome.ok || outcome.value.status !== "completed") return { ...lens, status: "failed" };
    const answer = outcome.value.answer;
    if (answer === undefined || answer.trim() === "") return { ...lens, status: "failed" };
    found.push(...parseExplorerAnswer(lens.id, answer));
    return { ...lens, status: "done" };
  });
  const findings = [...dedupeFindings([...state.findings, ...found])];
  return { state: { ...state, lenses, findings } };
}

/**
 * 순수 함수. 시각, 난수, I/O를 쓰지 않는다. 표(TRANSITIONS)에 없는 (phase, event) 쌍은 상태를 그대로 돌려준다
 * (L3.helm.spec §4.2)
 */
export function transition(state: Readonly<HelmState>, event: HelmEvent): TransitionResult {
  if (state.phase === "idle") return fromIdle(state, event);
  if (event.type === "stopRequested") return toIdle(state, finishedOf(state, "stopped"));
  if (event.type === "limitReached") {
    return toIdle(state, finishedOf(state, "limit", { limit: event.limit }));
  }
  if (event.type === "failed") {
    return toIdle(state, finishedOf(state, "failed", { reason: reasonOf(event.failure) }));
  }
  return fromInquiry(state, state.phase, event);
}

function fromIdle(state: HelmState, event: HelmEvent): TransitionResult {
  if (event.type === "requested") {
    return state.pending === null ? { state: { ...state, pending: event.pending } } : { state };
  }
  if (event.type === "stopRequested") {
    return { state: { ...state, pending: null, stopRequested: false } };
  }
  const pending = state.pending;
  if (event.type !== "leaseGranted" || pending === null) return { state };
  return {
    state: {
      ...state,
      phase: "diverge",
      inquiryId: pending.inquiryId,
      topic: pending.topic,
      lenses: [...event.lenses],
      findings: [],
      context: [],
      round: 1,
      appliedTurnId: null,
      pending: null,
      stopRequested: false,
      awaitingTurn: false,
    },
  };
}

function fromInquiry(
  state: HelmState,
  phase: Exclude<HelmPhase, "idle">,
  event: HelmEvent,
): TransitionResult {
  if (event.type === "turnIssued") {
    return phase === "diverge" || phase === "apply"
      ? { state: { ...state, awaitingTurn: true } }
      : { state };
  }
  if (phase === "diverge" && event.type === "diverged") {
    if (event.outcome.status === "completed") {
      return { state: { ...state, phase: "explore", awaitingTurn: false } };
    }
    return event.outcome.status === "aborted"
      ? toIdle(state, finishedOf(state, "stopped"))
      : toIdle(state, finishedOf(state, "failed", { reason: "diverge turn error" }));
  }
  if (phase === "explore" && event.type === "lensesStarted") {
    return {
      state: {
        ...state,
        lenses: state.lenses.map((lens) =>
          lens.status === "pending" ? { ...lens, status: "running" } : lens,
        ),
      },
    };
  }
  if (phase === "explore" && event.type === "lensFinished") {
    return lensFinished(state, event.lensId, event.outcome);
  }
  if (phase === "explore" && event.type === "explored") return explored(state);
  if (phase === "converge" && event.type === "converged") {
    if (event.findings.length === 0) {
      return toIdle(
        { ...state, context: [...event.context] },
        finishedOf(state, "empty", { reason: "no findings" }),
      );
    }
    return {
      state: {
        ...state,
        phase: "apply",
        findings: [...event.findings],
        context: [...event.context],
      },
    };
  }
  if (phase === "apply" && event.type === "applied") {
    if (event.outcome.status === "completed") {
      return toIdle(state, finishedOf(state, "applied", { appliedTurnId: event.outcome.turnId }));
    }
    return event.outcome.status === "aborted"
      ? toIdle(state, finishedOf(state, "stopped"))
      : toIdle(state, finishedOf(state, "failed", { reason: "apply turn error" }));
  }
  return { state };
}
