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
  LeaseAcquiredPayloadSchema,
  LeaseRejectedPayloadSchema,
  LeaseReleasedPayloadSchema,
  ScopeChangedPayloadSchema,
  ReviewAppliedPayloadSchema,
  ReviewSubmittedPayloadSchema,
  DialogStatusDataSchema,
  ScopeHandlerFailedPayloadSchema,
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  InputWithdrawnPayloadSchema,
  WorkPlanSubmittedSchema,
  WorkPlanWithdrawnSchema,
  maskApprovalRequest,
  maskQueuedInput,
  type InputQueuedPayload,
} from "@fresnel/contracts/records";

import type {
  EventWire,
  PendingApproval as WirePendingApproval,
  VolatileEventWire,
} from "@fresnel/contracts/wire";
import type { DurableFact, QueuedPreview, VolatileFact } from "./input.ts";

type DurableBase = Omit<Extract<DurableFact, { type: "other" }>, "type">;
type VolatileBase = Omit<Extract<VolatileFact, { type: "other" }>, "type">;

/** 대기 입력 미리보기의 글자 수 상한(코드 점 기준). 넘는 글은 "…"을 붙여 자른다 */
const PREVIEW_CHARS = 120;

/** 글을 앞뒤 공백 없이 다듬고 `PREVIEW_CHARS`자까지만 남긴다. 긴 글은 끝에 "…"을 붙인다 */
function previewText(text: string): string {
  const trimmed = text.trim();
  let end = 0;
  let count = 0;
  for (const ch of trimmed) {
    if (count === PREVIEW_CHARS) return `${trimmed.slice(0, end)}…`;
    end += ch.length;
    count += 1;
  }
  return trimmed;
}

/**
 * 큐 항목의 미리보기. 맥락 항목은 이름표만 준다. 사용자 항목은 글이 있으면 글을, 글이 없으면 이미지가 있는지에 따라 이름표를 준다.
 * 확장의 맥락 항목과 이미지 항목은 본문을 싣지 않는다.
 */
function queuedPreviewOf(item: InputQueuedPayload["item"]): QueuedPreview {
  if (item.kind === "context") {
    const labelKey = item.customType.startsWith("grp.helm.") ? "helm" : "context";
    return !item.display
      ? { kind: "label", labelKey, internal: true }
      : { kind: "label", labelKey };
  }
  const { content } = item;
  const raw =
    typeof content === "string"
      ? content
      : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  const text = previewText(raw);
  if (text !== "") return { kind: "text", text };
  const hasImage = typeof content !== "string" && content.some((part) => part.type === "image");
  return { kind: "label", labelKey: hasImage ? "image" : "empty" };
}

/**
 * 거울이 읽는 내구 kind와 payload 검증. 표에 없는 kind는 other로 위치만 넘긴다.
 * `mask`는 호스트가 준 화면 가림 표식이다(item.recorded, approval.requested, input.queued에 있다). 확정 item과 대기 입력은 표식을 적용한 복사본으로 거울에 들어간다.
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
  // 전환 기록(§4.9.8): 단계 경계의 drive 락 교대와 켜기·끄기 적용
  "lease.acquired": (base, payload) => {
    const p = parse(LeaseAcquiredPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "lease.acquired", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "lease.released": (base, payload) => {
    const p = parse(LeaseReleasedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "lease.released", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "lease.rejected": (base, payload) => {
    const p = parse(LeaseRejectedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "lease.rejected", payload: p.value }
      : { ...base, type: "unreadable" };
  },
  "scope.changed": (base, payload) => {
    const p = parse(ScopeChangedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "scope.changed", payload: p.value }
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
  // 계획 사건(P-14 계획 카드): 계획 id, 판 번호, 제목과 상태만 싣는다. 본문과 산출물은 거울에 들어가지 않는다
  "work.plan_submitted": (base, payload) => {
    const p = parse(WorkPlanSubmittedSchema, payload);
    return p.ok
      ? {
          ...base,
          type: "plan.event",
          plan: {
            planId: p.value.planId,
            version: p.value.version,
            title: p.value.title,
            status: "submitted",
          },
        }
      : { ...base, type: "unreadable" };
  },
  "work.plan_withdrawn": (base, payload) => {
    const p = parse(WorkPlanWithdrawnSchema, payload);
    return p.ok
      ? {
          ...base,
          type: "plan.event",
          plan: {
            planId: p.value.planId,
            version: p.value.version,
            title: null,
            status: "withdrawn",
          },
        }
      : { ...base, type: "unreadable" };
  },
  // 대기 입력(내구): 큐에 든 입력은 칩으로, 배치·철회는 칩을 지운다. 입력 id는 `input.queued`의 이벤트 id다
  "input.queued": (base, payload, mask) => {
    const p = parse(InputQueuedPayloadSchema, payload);
    if (!p.ok) return { ...base, type: "unreadable" };
    // 칩의 글은 호스트가 준 표식을 적용한 복사본에서 만든다. 적용하지 못하면 읽을 수 없는 사실로 둔다(원문은 거울에 들어가지 않는다)
    const masked = maskQueuedInput(p.value, mask);
    if (masked === null) return { ...base, type: "unreadable" };
    return {
      ...base,
      type: "input.queued",
      input: {
        mode: masked.mode,
        requestId: masked.requestId,
        sourceType: masked.source.type,
        preview: queuedPreviewOf(masked.item),
      },
    };
  },
  "input.placed": (base, payload) => {
    const p = parse(InputPlacedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "input.placed", inputId: p.value.inputId }
      : { ...base, type: "unreadable" };
  },
  "input.withdrawn": (base, payload) => {
    const p = parse(InputWithdrawnPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "input.withdrawn", inputId: p.value.inputId }
      : { ...base, type: "unreadable" };
  },
};

const VOLATILE: Readonly<Record<string, (base: VolatileBase, payload: unknown) => VolatileFact>> = {
  "item.updated": (base, payload) => {
    const p = parse(ItemUpdatedPayloadSchema, payload);
    return p.ok ? { ...base, type: "item.updated", payload: p.value } : { ...base, type: "other" };
  },
  "dialog.status": (base, payload) => {
    const p = parse(DialogStatusDataSchema, payload);
    return p.ok ? { ...base, type: "dialog.status", payload: p.value } : { ...base, type: "other" };
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

/**
 * 휘발 `scope.handler_failed`: 검증을 통과하면 실패 기록이고 `afterSeq`와 기록 시각 `at`을 같이 싣는다. 모양이 맞지 않으면 other다.
 */
function decodeHandlerFailed(base: VolatileBase, event: VolatileEventWire): VolatileFact {
  const p = parse(ScopeHandlerFailedPayloadSchema, event.payload);
  return p.ok
    ? {
        ...base,
        type: "scope.handler_failed",
        payload: p.value,
        afterSeq: event.afterSeq,
        at: event.recordedAt,
      }
    : { ...base, type: "other" };
}

export function decodeVolatile(event: VolatileEventWire): VolatileFact {
  const base: VolatileBase = { n: event.n, threadId: event.threadId, turnId: event.turnId };
  if (event.kind === "scope.handler_failed") return decodeHandlerFailed(base, event);
  const decode = VOLATILE[event.kind];
  return decode === undefined ? { ...base, type: "other" } : decode(base, event.payload);
}
