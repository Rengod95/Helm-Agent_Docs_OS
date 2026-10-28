import type { TurnOrigin, TurnId } from "@xeon/contracts/conversation";
import { reviewRequestId, type ReviewRequestId } from "./review/fork.ts";
import type { ReviewReason } from "./review/reason.ts";
import type { LearningState } from "./state.ts";

// L3.learning.spec §3.3, §4.2 학습 트리거. 임계 판정은 순수 함수다: 시계, 난수, I/O를 쓰지 않는다.

export interface TriggerSettings {
  /** l3.learning.trigger.userTurns. 0은 그 사유를 끈다 */
  readonly userTurns: number;
  /** l3.learning.trigger.toolIterations. 0은 그 사유를 끈다 */
  readonly toolIterations: number;
}

type TriggerReason = Exclude<ReviewReason, "manual">;

/** turn 하나 동안 핸들러가 모은 값. boundary.settle.after에서 한 번 반영한다 */
export interface TurnTally {
  readonly turnId: TurnId;
  /** boundary.settle.after 페이로드의 값(REQ-LN-01). 필드가 없는 동안은 "user"로 본다 */
  readonly origin: TurnOrigin;
  readonly status: "completed" | "aborted" | "error";
  readonly hasFinalAnswer: boolean;
  /** boundary.step.after에서 센 값. 도구 결과가 하나 이상인 step 수 */
  readonly toolIterations: number;
  readonly skillWritten: boolean;
}

type TriggerSkipWhy = "excluded" | "below_threshold" | "disabled" | "in_flight";

export type TriggerDecision =
  | { readonly kind: "skip"; readonly next: LearningState; readonly why: TriggerSkipWhy }
  | {
      readonly kind: "review";
      readonly next: LearningState;
      readonly requestId: ReviewRequestId;
      readonly reasons: readonly TriggerReason[];
    };

/** 사용자 turn으로 세는가. 중단, 오류, 최종 답 없음, 사용자가 아닌 출처는 세지 않는다(§4.2 규칙 2) */
export function countsAsUserTurn(tally: TurnTally): boolean {
  return tally.origin === "user" && tally.status === "completed" && tally.hasFinalAnswer;
}

/** 카운터만 올린 상태(규칙 3). 도구 반복 수는 제외된 turn에서도 올린다. 스킬 쓰기가 있으면 도구 반복 수가 0이다 */
export function advanceCounters(state: LearningState, tally: TurnTally): LearningState {
  return {
    ...state,
    lastTurnId: tally.turnId,
    userTurnsSinceReview: state.userTurnsSinceReview + (countsAsUserTurn(tally) ? 1 : 0),
    toolIterationsSinceSkillWrite: tally.skillWritten
      ? 0
      : state.toolIterationsSinceSkillWrite + tally.toolIterations,
  };
}

/** 순수 함수. 규칙은 spec §4.2 `applyTurn` 0~5와 같다 */
export function applyTurn(
  state: LearningState,
  tally: TurnTally,
  settings: TriggerSettings,
  enabled: boolean,
): TriggerDecision {
  // 1. 꺼져 있으면 상태를 바꾸지 않는다
  if (!enabled) return { kind: "skip", next: state, why: "disabled" };
  const advanced = advanceCounters(state, tally);
  // 2. 제외: 사용자 turn 수를 올리지 않고 검토도 시작하지 않는다
  if (tally.origin !== "user" || tally.status !== "completed" || !tally.hasFinalAnswer) {
    return { kind: "skip", next: advanced, why: "excluded" };
  }
  // 0. 진행 중 검토: 카운터만 갱신한다
  if (state.inFlightReviewId !== null) return { kind: "skip", next: advanced, why: "in_flight" };
  // 4. 판정
  const reasons: TriggerReason[] = [];
  if (settings.userTurns > 0 && advanced.userTurnsSinceReview >= settings.userTurns) {
    reasons.push("user_turns");
  }
  if (
    settings.toolIterations > 0 &&
    advanced.toolIterationsSinceSkillWrite >= settings.toolIterations
  ) {
    reasons.push("tool_iterations");
  }
  if (reasons.length === 0) return { kind: "skip", next: advanced, why: "below_threshold" };
  // 5. 검토: 사유와 무관하게 두 카운터를 함께 0으로 둔다 [제안]
  const epoch = state.epoch + 1;
  const requestId = reviewRequestId(epoch);
  return {
    kind: "review",
    requestId,
    reasons,
    next: {
      ...advanced,
      userTurnsSinceReview: 0,
      toolIterationsSinceSkillWrite: 0,
      lastReviewId: requestId,
      inFlightReviewId: requestId,
      delegateFailures: 0,
      epoch,
    },
  };
}

/** 위임을 만들지 못한 판정의 다음 상태(§4.3 3, §5 사례 7). 에폭과 진행 중 검토는 그대로, 카운터는 갱신한 값을 유지한다 */
const MAX_DELEGATE_FAILURES = 3;

export function afterDelegateFailure(
  before: LearningState,
  advanced: LearningState,
): LearningState {
  const failures = before.delegateFailures + 1;
  if (failures >= MAX_DELEGATE_FAILURES) {
    // 세 번째 실패: 이 판정에서 검토를 포기하고 카운터와 실패 수를 0으로 둔다
    return {
      ...advanced,
      epoch: before.epoch,
      inFlightReviewId: before.inFlightReviewId,
      lastReviewId: before.lastReviewId,
      userTurnsSinceReview: 0,
      toolIterationsSinceSkillWrite: 0,
      delegateFailures: 0,
    };
  }
  return {
    ...advanced,
    epoch: before.epoch,
    inFlightReviewId: before.inFlightReviewId,
    lastReviewId: before.lastReviewId,
    delegateFailures: failures,
  };
}
