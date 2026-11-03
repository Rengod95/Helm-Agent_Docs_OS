// src/state/engine/decode.ts (발췌. 나머지 kind도 같은 모양이다)
import { parse } from "@fresnel/contracts";
import {
  ItemStartedPayloadSchema,
  ItemUpdatedPayloadSchema,
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
  TurnCompletedPayloadSchema,
  maskItemRecord,
  type ApprovalMaskEntry,
  type LeafMask,
} from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  ItemRecordedPayloadSchema,
  ReviewAppliedPayloadSchema,
  ReviewSubmittedPayloadSchema,
  ScopeHandlerFailedPayloadSchema,
  maskApprovalRequest,
} from "@fresnel/contracts/records";

import type {
  EventWire,
  PendingApproval as WirePendingApproval,
  VolatileEventWire,
} from "@fresnel/contracts/wire";
import type { DurableFact, VolatileFact } from "./input.ts";

type DurableBase = Omit<Extract<DurableFact, { type: "other" }>, "type">;
type VolatileBase = Omit<Extract<VolatileFact, { type: "other" }>, "type">;

/**
 * 거울이 읽는 내구 kind와 payload 검증. 표에 없는 kind는 other로 위치만 넘긴다.
 * `mask`는 호스트가 준 화면 가림 표식이다(item.recorded에만 있다). 확정 item은 표식을 적용한 복사본으로 거울에 들어간다.
 */
const DURABLE: Readonly<
  Record<
    string,
    (base: DurableBase, payload: unknown, mask: readonly LeafMask[] | undefined) => DurableFact
  >
> = {
  "item.recorded": (base, payload, mask) => {
    const p = parse(ItemRecordedPayloadSchema, payload);
    if (!p.ok) return { ...base, type: "unreadable" };
    // 표식을 적용하지 못하면(모양이 맞지 않으면) 읽을 수 없는 사실로 둔다. 원문은 거울에 들어가지 않는다
    const item = maskItemRecord(p.value.item, mask);
    return item === null
      ? { ...base, type: "unreadable" }
      : { ...base, type: "item.recorded", item };
  },
  "turn.started": (base) => ({ ...base, type: "turn.started" }),
  "thread.started": (base, payload) => {
    const p = parse(ThreadStartedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "thread.started", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "thread.updated": (base, payload) => {
    const p = parse(ThreadUpdatedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "thread.updated", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "thread.closed": (base) => ({ ...base, type: "thread.closed" }),
  "turn.completed": (base, payload) => {
    const p = parse(TurnCompletedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "turn.completed", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "approval.requested": (base, payload, mask) => {
    const p = parse(ApprovalRequestedPayloadSchema, payload);
    if (!p.ok) return { ...base, type: "unreadable" };
    // 승인 카드의 제목과 도구 인자에 호스트의 표식을 적용한다. 적용하지 못하면 읽을 수 없는 사실이다
    const request = maskApprovalRequest(p.value, mask);
    return request === null
      ? { ...base, type: "unreadable" }
      : { ...base, type: "approval.requested", request };
  },
  "approval.resolved": (base, payload) => {
    const p = parse(ApprovalResolvedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "approval.resolved", approvalId: p.value.approvalId }
      : { ...base, type: "unreadable" };
  },
  // 변경 검토 결과(P-04 제출 결과 표). 리뷰 id와 라운드, 되돌림 결과, 전달을 싣는다
  "artifact.review_applied": (base, payload) => {
    const p = parse(ReviewAppliedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "review.applied", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "artifact.review_submitted": (base, payload) => {
    const p = parse(ReviewSubmittedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "review.submitted", payload: p.value }
      : { ...base, type: "unreadable" };
  },
};

const VOLATILE: Readonly<Record<string, (base: VolatileBase, payload: unknown) => VolatileFact>> = {
  "item.updated": (base, payload) => {
    const p = parse(ItemUpdatedPayloadSchema, payload);
    return p.ok ? { ...base, type: "item.updated", payload: p.value } : { ...base, type: "other" };
  },
  "item.started": (base, payload) => {
    const p = parse(ItemStartedPayloadSchema, payload);
    return p.ok ? { ...base, type: "item.started", payload: p.value } : { ...base, type: "other" };
  },
};

/** 경계 함수(TY-10). 검증 실패는 unreadable 사실이고 위치는 넘긴다 */
export function decodeDurable(event: EventWire): DurableFact {
  const base: DurableBase = {
    seq: event.seq,
    eventId: event.id,
    threadId: event.threadId,
    turnId: event.turnId,
    at: event.recordedAt,
  };
  const decode = DURABLE[event.kind];
  return decode === undefined
    ? { ...base, type: "other" }
    : decode(base, event.payload, event.mask);
}

/**
 * approval.list 결과의 대기 승인에 화면 가림 표식을 적용한다. 적용하지 못한 승인은 목록에 넣지 않는다
 * (decodeDurable의 unreadable과 같다). 승인 카드는 제목과 도구 인자만 가리는 표식을 받는다.
 */
export function decodePendingApprovals(result: {
  readonly approvals: readonly WirePendingApproval[];
  readonly masks?: readonly ApprovalMaskEntry[];
}): readonly WirePendingApproval[] {
  return result.approvals.flatMap((approval) => {
    const leaves = result.masks?.find((entry) => entry.approvalId === approval.approvalId)?.leaves;
    const request = maskApprovalRequest(approval.request, leaves);
    return request === null ? [] : [{ ...approval, request }];
  });
}

/** 휘발 `scope.handler_failed`: 검증을 통과하면 실패 기록이고 `afterSeq`를 같이 싣는다. 모양이 맞지 않으면 other다 */
function decodeHandlerFailed(base: VolatileBase, event: VolatileEventWire): VolatileFact {
  const p = parse(ScopeHandlerFailedPayloadSchema, event.payload);
  return p.ok
    ? { ...base, type: "scope.handler_failed", payload: p.value, afterSeq: event.afterSeq }
    : { ...base, type: "other" };
}

export function decodeVolatile(event: VolatileEventWire): VolatileFact {
  const base: VolatileBase = { n: event.n, threadId: event.threadId, turnId: event.turnId };
  if (event.kind === "scope.handler_failed") return decodeHandlerFailed(base, event);
  const decode = VOLATILE[event.kind];
  return decode === undefined ? { ...base, type: "other" } : decode(base, event.payload);
}
