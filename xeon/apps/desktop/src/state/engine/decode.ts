// src/state/engine/decode.ts (발췌. 나머지 kind도 같은 모양이다)
import { parse } from "@xeon/contracts";
import {
  ItemStartedPayloadSchema,
  ItemUpdatedPayloadSchema,
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
  TurnCompletedPayloadSchema,
} from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  ItemRecordedPayloadSchema,
} from "@xeon/contracts/records";
import type { EventWire, VolatileEventWire } from "@xeon/contracts/wire";
import type { DurableFact, VolatileFact } from "./input.ts";

type DurableBase = Omit<Extract<DurableFact, { type: "other" }>, "type">;
type VolatileBase = Omit<Extract<VolatileFact, { type: "other" }>, "type">;

/** 거울이 읽는 내구 kind와 payload 검증. 표에 없는 kind는 other로 위치만 넘긴다 */
const DURABLE: Readonly<Record<string, (base: DurableBase, payload: unknown) => DurableFact>> = {
  "item.recorded": (base, payload) => {
    const p = parse(ItemRecordedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "item.recorded", item: p.value.item }
      : { ...base, type: "unreadable" };
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
  "approval.requested": (base, payload) => {
    const p = parse(ApprovalRequestedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "approval.requested", request: p.value }
      : { ...base, type: "unreadable" };
  },
  "approval.resolved": (base, payload) => {
    const p = parse(ApprovalResolvedPayloadSchema, payload);
    return p.ok
      ? { ...base, type: "approval.resolved", approvalId: p.value.approvalId }
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
  return decode === undefined ? { ...base, type: "other" } : decode(base, event.payload);
}

export function decodeVolatile(event: VolatileEventWire): VolatileFact {
  const base: VolatileBase = { n: event.n, threadId: event.threadId, turnId: event.turnId };
  const decode = VOLATILE[event.kind];
  return decode === undefined ? { ...base, type: "other" } : decode(base, event.payload);
}
