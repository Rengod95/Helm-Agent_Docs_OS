import { parse } from "@xeon/contracts";
import {
  ApprovalResolvedPayloadSchema,
  ReviewAnswerSchema,
  type DurableEventEnvelope,
  type EventKind,
  type ReviewAnswerJson,
} from "@xeon/contracts/records";
import { toJsonValue, type JsonValue, type ThreadId } from "@xeon/contracts/conversation";
import type { ApprovalService } from "@xeon/contracts/services";
import { commitKey } from "./kernel.ts";
import type { ReviewsRuntime } from "./service.ts";
import { roundForNewInput, type ReviewState } from "./state.ts";

// L2.artifacts.spec §4.2.4. 검토 승인(kind review)의 해결을 리뷰에 반영한다. 사용자 답(ReviewAnswer)은 결정과 코멘트를 이벤트로 남기고,
// submit이 참이면 제출까지 한다.
//
// [결정: 오케스트레이터 기본값] 의미 규칙
// - `submit: false`: 결정과 코멘트만 남기고 리뷰는 열린 채로 둔다. 승인 요청은 이미 해결됐으므로 같은 라운드에 대해 새 승인 요청을 낸다
//   (사용자가 이어서 결정하거나 제출하게 한다). 되돌림과 전달은 일어나지 않는다.
// - 리뷰 단위 코멘트(`target.type: "review"`): 어느 hunk에도 붙지 않는 코멘트다. 제출 때 "리뷰 전체" 줄로 에이전트에 전달된다. 결정에 영향이 없다.
// - `submit: true`인데 pending hunk가 남고 `approveRemaining`이 거짓이면 제출하지 않고(decisions_pending) 새 승인 요청을 낸다.
// - 거부(deny): 사용자가 변경을 받아들이지 않는다는 뜻으로 보고, 되돌릴 수 있는 모든 hunk를 거절하고 제출한다. 거부 사유(`feedback`)는 리뷰 단위 코멘트가 된다.
// - 사람이 아닌 해결(`noninteractive`, `cancelled`, `superseded`, `expired`)은 리뷰를 건드리지 않는다. 열린 채로 남는다.

export interface AnswerHandler {
  onApprovalResolved(event: DurableEventEnvelope): Promise<void>;
}

function toJson(value: unknown): JsonValue {
  return toJsonValue(value) ?? null;
}

function feedbackOf(value: JsonValue): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries: readonly (readonly [string, JsonValue])[] = Object.entries(value);
  const found = entries.find(([key]) => key === "feedback");
  return found !== undefined && typeof found[1] === "string" ? found[1] : undefined;
}

export function createAnswerHandler(
  runtime: ReviewsRuntime,
  approvals: Pick<ApprovalService, "get"> | undefined,
): AnswerHandler {
  const { kernel } = runtime;
  const { deps } = kernel;

  function targetOf(approvalId: string): { threadId: ThreadId; reviewId: string } | undefined {
    const known = kernel.approvalTargets.get(approvalId);
    if (known !== undefined) return known;
    const opened = approvals?.get(approvalId);
    if (opened === undefined || opened.request.body.kind !== "review") return undefined;
    return {
      threadId: opened.request.origin.threadId,
      reviewId: opened.request.body.review.reviewId,
    };
  }

  function recordAnswer(
    threadId: ThreadId,
    state: ReviewState,
    approvalId: string,
    answer: ReviewAnswerJson,
  ): boolean {
    const known = new Set(state.files.flatMap((file) => file.hunks.map((hunk) => hunk.hunkId)));
    const reverted = new Set(
      state.files.flatMap((file) =>
        file.hunks.filter((hunk) => hunk.applied === "reverted").map((hunk) => hunk.hunkId),
      ),
    );
    const decisions = answer.decisions.filter(
      (decision) =>
        known.has(decision.hunkId) &&
        !(reverted.has(decision.hunkId) && decision.decision !== "rejected"),
    );
    const comments = answer.comments.filter(
      (comment) => comment.target.type !== "hunk" || known.has(comment.target.hunkId),
    );
    if (decisions.length < answer.decisions.length || comments.length < answer.comments.length) {
      deps.logger.warn("artifacts.review_answer_dropped", {
        reviewId: state.reviewId,
        decisions: answer.decisions.length - decisions.length,
        comments: answer.comments.length - comments.length,
      });
    }
    const round = roundForNewInput(state);
    const events: { kind: EventKind; payload: JsonValue }[] = [];
    if (decisions.length > 0) {
      events.push({
        kind: "artifact.review_decided",
        payload: toJson({ reviewId: state.reviewId, round, decisions, by: "user" }),
      });
    }
    for (const comment of comments) {
      events.push({
        kind: "artifact.review_commented",
        payload: toJson({
          reviewId: state.reviewId,
          round,
          commentId: deps.localIds.next("cmt"),
          target: comment.target,
          body: comment.body,
          by: "user",
        }),
      });
    }
    if (events.length === 0) return true;
    const committed = kernel.commit({
      threadId,
      turnId: null,
      key: commitKey("answer", state.reviewId, approvalId),
      fingerprint: toJson({ decisions, comments }),
      events,
    });
    if (!committed.ok) {
      deps.logger.error("artifacts.review_answer_commit_failed", { reviewId: state.reviewId });
      return false;
    }
    return true;
  }

  /** 같은 라운드에 대해 새 승인 요청을 낸다. 키는 해결된 승인 id에서 만들어 재시도가 같은 요청을 얻게 한다 */
  async function askAgain(threadId: ThreadId, reviewId: string, approvalId: string): Promise<void> {
    const loaded = kernel.load(threadId, reviewId);
    if (!loaded.ok || loaded.value === undefined || loaded.value.status === "closed") return;
    await kernel.requestApproval(loaded.value, threadId, `review:${reviewId}:next:${approvalId}`);
  }

  async function handle(
    threadId: ThreadId,
    reviewId: string,
    approvalId: string,
    decision: "allow" | "deny" | "answer",
    answerValue: JsonValue,
  ): Promise<void> {
    const loaded = kernel.load(threadId, reviewId);
    if (!loaded.ok || loaded.value === undefined || loaded.value.status === "closed") return;
    const state = loaded.value;
    if (decision === "deny") {
      const feedback = feedbackOf(answerValue);
      const rejectable = state.files.flatMap((file) =>
        file.hunks.filter((hunk) => hunk.applied !== "reverted").map((hunk) => hunk.hunkId),
      );
      const recorded = recordAnswer(threadId, state, approvalId, {
        decisions: rejectable.map((hunkId) => ({ hunkId, decision: "rejected" })),
        comments:
          feedback === undefined || feedback === ""
            ? []
            : [{ target: { type: "review" }, body: feedback }],
        submit: true,
      });
      if (!recorded) return;
      const submitted = await runtime.submitUnlocked(threadId, reviewId, {
        approveRemaining: false,
        by: "user",
        turnId: null,
        signal: undefined,
      });
      if (!submitted.ok) {
        deps.logger.warn("artifacts.review_submit_failed", {
          reviewId,
          reason: submitted.error.kind,
        });
      }
      return;
    }
    if (decision !== "answer") return;
    const answer = parse(ReviewAnswerSchema, answerValue);
    if (!answer.ok) {
      deps.logger.warn("artifacts.review_answer_invalid", { reviewId });
      return;
    }
    const recorded = recordAnswer(threadId, state, approvalId, answer.value);
    if (!recorded) return;
    if (!answer.value.submit) {
      await askAgain(threadId, reviewId, approvalId);
      return;
    }
    const submitted = await runtime.submitUnlocked(threadId, reviewId, {
      approveRemaining: answer.value.approveRemaining === true,
      by: "user",
      turnId: null,
      signal: undefined,
    });
    if (!submitted.ok) {
      deps.logger.warn("artifacts.review_submit_failed", {
        reviewId,
        reason: submitted.error.kind,
      });
      if (submitted.error.kind === "decisions_pending")
        await askAgain(threadId, reviewId, approvalId);
    }
  }

  return {
    async onApprovalResolved(event) {
      const payload = parse(ApprovalResolvedPayloadSchema, event.payload);
      if (!payload.ok || payload.value.resolvedBy !== "user") return;
      const target = targetOf(payload.value.approvalId);
      if (target === undefined) return;
      await kernel.withLock(target.reviewId, () =>
        handle(
          target.threadId,
          target.reviewId,
          payload.value.approvalId,
          payload.value.decision,
          payload.value.answer,
        ),
      );
    },
  };
}
