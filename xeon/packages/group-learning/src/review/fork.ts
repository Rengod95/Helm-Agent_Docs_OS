import type { ItemId, ThreadId } from "@xeon/contracts/conversation";
import type { AgentSettledEventPayload } from "@xeon/contracts/records";
import type { DelegateError, DelegateResult, DelegateSpec } from "@xeon/group-kit";
import type { LearningSettings } from "../settings.ts";
import type { LearningState } from "../state.ts";
import type { ReviewOutcome } from "../proposals/reader.ts";
import { reviewTask } from "./prompts.ts";
import type { ReviewReason } from "./reason.ts";
import { reviewToolPolicy } from "./policy.ts";

// L3.learning.spec §3.4, §4.3. 검토 포크 호출과 완료 통지. 이 파일의 함수는 순수 함수다.

/** 검토 포크 서브에이전트 정의 이름. 정의 파일은 그룹 패키지 agents/learning-review.md(매니페스트 components.agents) */
const REVIEW_AGENT = "learning-review";
/** 자동 검토의 requestId 접두. 구독 핸들러가 이 접두로 자기 검토를 알아본다 */
const REVIEW_ID_PREFIX = "learning:review:";

export type ReviewRequestId = `learning:review:${number}`;

/** "learning:review:<epoch>" 형식. 1~48자. group-kit이 ":report"를 붙여 보고 키(64자 한도)로 쓰기 때문이다(L3.group-kit.spec §3.4) */
export function reviewRequestId(epoch: number): ReviewRequestId {
  return `${REVIEW_ID_PREFIX}${epoch}`;
}

/** 수동 검토 "learning:review:manual:<n>" */
export function manualReviewId(n: number): string {
  return `${REVIEW_ID_PREFIX}manual:${n}`;
}

/** 컨텍스트 창이 모를 때의 입력 토큰 예산 */
const UNKNOWN_WINDOW_BUDGET = 120_000;
const BUDGET_CAP = 600_000;

/** `w`가 null이면 120,000, 아니면 `min(floor(w * 0.75), 600_000)`. `override`가 있으면 그 값이다 */
export function reviewTokenBudget(contextWindow: number | null, override: number | null): number {
  if (override !== null) return override;
  if (contextWindow === null) return UNKNOWN_WINDOW_BUDGET;
  return Math.min(Math.floor(contextWindow * 0.75), BUDGET_CAP);
}

export interface BuildReviewInput {
  /** upToItemId: 이번 turn의 마지막 내구 item. boundary.settle.after 페이로드의 lastItemId */
  readonly parent: { readonly threadId: ThreadId; readonly upToItemId: ItemId };
  /** reviewRequestId(epoch) 또는 수동 검토 id. 1~48자 */
  readonly requestId: string;
  readonly reasons: readonly ReviewReason[];
  readonly settings: LearningSettings;
  readonly contextWindow: number | null;
}

/** DelegateSpec을 만든다. `report`는 넣지 않는다 [결정: review.m3-design-inputs D-M3-03] */
export function buildReviewSpec(input: BuildReviewInput): DelegateSpec {
  const { settings } = input;
  return {
    agent: REVIEW_AGENT,
    task: reviewTask(input.reasons),
    requestId: input.requestId,
    toolPolicy: reviewToolPolicy(),
    limits: {
      maxSteps: settings.maxIterations,
      maxInputTokens: reviewTokenBudget(input.contextWindow, settings.tokenBudget),
    },
    ...(settings.model === null ? {} : { model: settings.model }),
    fork: { at: "item", itemId: input.parent.upToItemId },
  };
}

export type ReviewStart =
  | { readonly kind: "started"; readonly childThreadId: ThreadId }
  | { readonly kind: "already"; readonly childThreadId: ThreadId }
  | { readonly kind: "retryLater"; readonly error: DelegateError };

/** DelegateResult를 학습 그룹의 다음 동작으로 바꾼다. 순수 함수 */
export function reviewStartOutcome(result: DelegateResult): ReviewStart {
  if (!result.ok) return { kind: "retryLater", error: result.error };
  return result.receipt.status === "accepted"
    ? { kind: "started", childThreadId: result.receipt.childThreadId }
    : { kind: "already", childThreadId: result.receipt.childThreadId };
}

/** 코어 이벤트 agent.settled에서 학습 그룹이 읽는 필드(L1.agents.spec §3.5). 구독 핸들러 입력 */
export type ReviewSettled = Pick<
  AgentSettledEventPayload,
  "requestId" | "childThreadId" | "status" | "usage"
> & { readonly limitHit?: AgentSettledEventPayload["limitHit"] };

export type ReviewFinish =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "finished";
      readonly next: LearningState;
      readonly outcome: ReviewOutcome;
    };

/** 순수 함수. agent.settled를 검토 종료 결과로 바꾼다. 학습 그룹 검토가 아니면 ignore(§4.3 완료 통지) */
export function reviewFinishOutcome(state: LearningState, settled: ReviewSettled): ReviewFinish {
  if (!settled.requestId.startsWith(REVIEW_ID_PREFIX)) return { kind: "ignore" };
  const outcome: ReviewOutcome =
    settled.limitHit !== undefined && settled.limitHit !== null ? "budget" : settled.status;
  return {
    kind: "finished",
    outcome,
    next: {
      ...state,
      settledReviewId: settled.requestId,
      inFlightReviewId:
        state.inFlightReviewId === settled.requestId ? null : state.inFlightReviewId,
    },
  };
}
