import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  ReviewAppliedPayloadSchema,
  ReviewSubmittedPayloadSchema,
  type DurableEventEnvelope,
} from "@fresnel/contracts/records";

// L2.artifacts.spec §4.2.8. 강제 종료로 끊긴 검토 답의 처리를 다음 시작 때 이어서 하려고 대상을 찾는다.
// 사람이 답한 검토 승인(`approval.resolved`, resolvedBy user) 가운데 그 리뷰의 마지막 적용·제출 기록(`artifact.review_applied`,
// `artifact.review_submitted`)보다 뒤에 있고, 그 뒤에 같은 리뷰의 새 승인 요청(`approval.requested`)도 없는 것이 끊긴 답이다.
// 리뷰마다 가장 나중 답 하나만 본다. 이미 끝난 답은 다시 처리해도 커밋 키와 되돌림 요청 id가 같아 아무 일도 하지 않는다.

export interface InterruptedAnswer {
  readonly threadId: ThreadId;
  readonly reviewId: string;
  readonly approvalId: string;
  readonly resolved: DurableEventEnvelope;
}

interface Requested {
  readonly threadId: ThreadId;
  readonly reviewId: string;
  readonly seq: number;
}

/** `events`는 커밋 순서로 읽은 `approval.requested`, `approval.resolved`, `artifact.review_*`다 */
export function interruptedAnswers(
  events: readonly DurableEventEnvelope[],
): readonly InterruptedAnswer[] {
  const requests = new Map<string, Requested>();
  const lastRequestSeq = new Map<string, number>();
  const lastDoneSeq = new Map<string, number>();
  const latest = new Map<string, InterruptedAnswer & { readonly seq: number }>();
  for (const event of events) {
    if (event.kind === "approval.requested") {
      const payload = parse(ApprovalRequestedPayloadSchema, event.payload);
      if (!payload.ok || payload.value.body.kind !== "review") continue;
      const reviewId = payload.value.body.review.reviewId;
      requests.set(event.id, { threadId: payload.value.origin.threadId, reviewId, seq: event.seq });
      lastRequestSeq.set(reviewId, event.seq);
      continue;
    }
    if (event.kind === "artifact.review_applied" || event.kind === "artifact.review_submitted") {
      const payload =
        event.kind === "artifact.review_applied"
          ? parse(ReviewAppliedPayloadSchema, event.payload)
          : parse(ReviewSubmittedPayloadSchema, event.payload);
      if (payload.ok) lastDoneSeq.set(payload.value.reviewId, event.seq);
      continue;
    }
    if (event.kind !== "approval.resolved") continue;
    const payload = parse(ApprovalResolvedPayloadSchema, event.payload);
    if (!payload.ok || payload.value.resolvedBy !== "user") continue;
    const request = requests.get(payload.value.approvalId);
    if (request === undefined) continue;
    latest.set(request.reviewId, {
      threadId: request.threadId,
      reviewId: request.reviewId,
      approvalId: payload.value.approvalId,
      resolved: event,
      seq: event.seq,
    });
  }
  const found: InterruptedAnswer[] = [];
  for (const [reviewId, answer] of latest) {
    if (answer.seq < (lastDoneSeq.get(reviewId) ?? 0)) continue;
    if (answer.seq < (lastRequestSeq.get(reviewId) ?? 0)) continue;
    found.push(answer);
  }
  return found;
}
