import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TNever,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import {
  EventIdSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
} from "../../conversation/index.ts";
import {
  DetachedFieldSchema,
  EventKindSchema,
  type DurableEventEnvelope,
  type VolatileEventEnvelope,
} from "../../records/index.ts";
import { RpcIdSchema } from "./jsonrpc.ts";
import { SeqSchema, SubIdSchema } from "./cursor.ts";

/** ISO 8601 UTC 문자열. 예: "2026-10-21T12:00:00.000Z" */
export const IsoTimeSchema: TString = Type.String({ format: "date-time", maxLength: 32 });
export type IsoTime = Static<typeof IsoTimeSchema>;

const CorrelationSchema: TUnion<[TString, TNull]> = Nullable(
  Type.String({ minLength: 1, maxLength: 64 }),
);

/** 내구 이벤트 하나. DurableEventEnvelope의 필드를 그대로 옮기고 recordedAt만 IsoTime으로 바꾸고 redactions를 더한다 */
export const EventWireSchema: TObject<{
  id: typeof EventIdSchema;
  kind: typeof EventKindSchema;
  version: TInteger;
  durable: TLiteral<true>;
  seq: TInteger;
  parentId: TUnion<[typeof EventIdSchema, TNull]>;
  threadId: typeof ThreadIdSchema;
  turnId: TUnion<[typeof TurnIdSchema, TNull]>;
  stepId: TUnion<[typeof StepIdSchema, TNull]>;
  recordedAt: typeof IsoTimeSchema;
  causationId: TUnion<[typeof EventIdSchema, TNull]>;
  correlationId: typeof CorrelationSchema;
  payload: TUnknown;
  detached: TOptional<TArray<typeof DetachedFieldSchema>>;
  redactions: TArray<TString>;
}> = Type.Object(
  {
    id: EventIdSchema,
    kind: EventKindSchema,
    version: Type.Integer({ minimum: 1 }),
    durable: Type.Literal(true),
    seq: Type.Integer({ minimum: 1 }),
    parentId: Nullable(EventIdSchema),
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    recordedAt: IsoTimeSchema,
    causationId: Nullable(EventIdSchema),
    correlationId: CorrelationSchema,
    payload: Type.Unknown(),
    detached: Type.Optional(Type.Array(DetachedFieldSchema, { maxItems: 256 })),
    /** RFC 6901 포인터, payload 기준. 2차 방어로 가린 필드 */
    redactions: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type EventWire = Static<typeof EventWireSchema>;

/** 휘발 이벤트 하나. VolatileEventEnvelope에서 recordedAt만 IsoTime으로 바꾼 모양이다 */
export const VolatileEventWireSchema: TObject<{
  id: typeof EventIdSchema;
  kind: typeof EventKindSchema;
  version: TInteger;
  durable: TLiteral<false>;
  threadId: typeof ThreadIdSchema;
  turnId: TUnion<[typeof TurnIdSchema, TNull]>;
  stepId: TUnion<[typeof StepIdSchema, TNull]>;
  recordedAt: typeof IsoTimeSchema;
  causationId: TUnion<[typeof EventIdSchema, TNull]>;
  correlationId: typeof CorrelationSchema;
  /** (threadId, turnId) 안 조각 번호, 0부터 */
  n: TInteger;
  /** 발신 시점의 마지막 내구 seq */
  afterSeq: typeof SeqSchema;
  payload: TUnknown;
}> = Type.Object(
  {
    id: EventIdSchema,
    kind: EventKindSchema,
    version: Type.Integer({ minimum: 1 }),
    durable: Type.Literal(false),
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    recordedAt: IsoTimeSchema,
    causationId: Nullable(EventIdSchema),
    correlationId: CorrelationSchema,
    n: Type.Integer({ minimum: 0 }),
    afterSeq: SeqSchema,
    payload: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type VolatileEventWire = Static<typeof VolatileEventWireSchema>;

// ── 알림 params ──────────────────────────────────────────────────────────

export const EventsBatchParamsSchema: TObject<{
  sub: typeof SubIdSchema;
  /** 직전 알림의 to. 첫 알림이면 start */
  from: typeof SeqSchema;
  /** 이 알림이 책임지는 구간 (from, to]의 끝 */
  to: typeof SeqSchema;
  /** 그 구간에서 필터에 맞는 내구 이벤트 전부, seq 오름차순 */
  events: TArray<typeof EventWireSchema>;
  caughtUp: TBoolean;
}> = Type.Object(
  {
    sub: SubIdSchema,
    from: SeqSchema,
    to: SeqSchema,
    events: Type.Array(EventWireSchema, { maxItems: 10_000 }),
    caughtUp: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type EventsBatchParams = Static<typeof EventsBatchParamsSchema>;

/** 휘발 조각은 seq가 없고 재전송하지 않는다 */
export const StreamChunkParamsSchema: TObject<{ event: typeof VolatileEventWireSchema }> =
  Type.Object({ event: VolatileEventWireSchema }, { additionalProperties: false });
export type StreamChunkParams = Static<typeof StreamChunkParamsSchema>;

export const CancelRequestParamsSchema: TObject<{ id: typeof RpcIdSchema }> = Type.Object(
  { id: RpcIdSchema },
  { additionalProperties: false },
);
export type CancelRequestParams = Static<typeof CancelRequestParamsSchema>;

/** params가 비어 있는 메서드·알림. 키가 하나도 없는 객체만 통과한다 */
export const EmptyParamsSchema: TRecord<"^.*$", TNever> = Type.Record(Type.String(), Type.Never());
export type EmptyParams = Static<typeof EmptyParamsSchema>;

// ── 저장 이벤트 → 전송 표현 ──────────────────────────────────────────────

type Erased = { readonly node: unknown } | undefined;

function unescapePointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** payload 안에서 포인터가 가리키는 값을 지운 사본을 돌려준다. 가리키는 곳이 없으면 undefined */
function eraseAt(node: unknown, tokens: readonly string[]): Erased {
  const [head, ...rest] = tokens;
  if (head === undefined) return { node: null };
  if (Array.isArray(node)) {
    const index = /^(0|[1-9]\d*)$/.test(head) ? Number(head) : -1;
    if (index < 0 || index >= node.length) return undefined;
    const child: unknown = node[index];
    const replaced = rest.length === 0 ? { node: null } : eraseAt(child, rest);
    if (replaced === undefined) return undefined;
    return { node: node.map((element: unknown, i) => (i === index ? replaced.node : element)) };
  }
  if (typeof node === "object" && node !== null && Object.hasOwn(node, head)) {
    if (rest.length === 0) {
      return { node: Object.fromEntries(Object.entries(node).filter(([key]) => key !== head)) };
    }
    const replaced = eraseAt(Reflect.get(node, head), rest);
    if (replaced === undefined) return undefined;
    return { node: { ...node, [head]: replaced.node } };
  }
  return undefined;
}

/** 포인터 목록을 payload에서 지운다. 실제로 지운 포인터만 돌려준다(중복 제거, 입력 순서 유지) */
function redactPayload(
  payload: unknown,
  pointers: readonly string[],
): { readonly payload: unknown; readonly redactions: readonly string[] } {
  let current = payload;
  const done: string[] = [];
  for (const pointer of new Set(pointers)) {
    if (pointer !== "" && !pointer.startsWith("/")) continue;
    const tokens = pointer === "" ? [] : pointer.slice(1).split("/").map(unescapePointerToken);
    const erased = eraseAt(current, tokens);
    if (erased === undefined) continue;
    current = erased.node;
    done.push(pointer);
  }
  return { payload: current, redactions: done };
}

/**
 * 순수 함수. 저장 이벤트를 전송 표현으로 바꾼다. redactions는 2차 방어다: redact가 돌려준 RFC 6901 포인터가
 * 가리키는 값을 payload에서 지우고(배열 원소는 null로 바꿔 자리를 지킨다) 지운 포인터를 redactions에 적는다.
 * 입력은 바꾸지 않는다.
 */
export function toEventWire(
  event: DurableEventEnvelope,
  redact?: (event: DurableEventEnvelope) => readonly string[],
): EventWire {
  const pointers = redact === undefined ? [] : redact(event);
  const redacted = pointers.length === 0 ? undefined : redactPayload(event.payload, pointers);
  return {
    id: event.id,
    kind: event.kind,
    version: event.version,
    durable: true,
    seq: event.seq,
    parentId: event.parentId,
    threadId: event.threadId,
    turnId: event.turnId,
    stepId: event.stepId,
    recordedAt: new Date(event.recordedAt).toISOString(),
    causationId: event.causationId,
    correlationId: event.correlationId,
    payload: redacted === undefined ? event.payload : redacted.payload,
    ...(event.detached !== undefined ? { detached: event.detached } : {}),
    redactions: redacted === undefined ? [] : [...redacted.redactions],
  };
}

/** 순수 함수. n과 afterSeq를 보존하고 seq는 없다 */
export function toVolatileEventWire(event: VolatileEventEnvelope): VolatileEventWire {
  return {
    id: event.id,
    kind: event.kind,
    version: event.version,
    durable: false,
    threadId: event.threadId,
    turnId: event.turnId,
    stepId: event.stepId,
    recordedAt: new Date(event.recordedAt).toISOString(),
    causationId: event.causationId,
    correlationId: event.correlationId,
    n: event.n,
    afterSeq: event.afterSeq,
    payload: event.payload,
  };
}

// ── 구독 계약 검사 도우미 (F.wire-settings.spec §3.4.2 규칙 1·2) ─────────────

export type BatchContinuityIssue =
  | {
      readonly kind: "gap";
      readonly index: number;
      readonly expectedFrom: number;
      readonly from: number;
    }
  | {
      readonly kind: "backwards";
      readonly index: number;
      readonly from: number;
      readonly to: number;
    }
  | { readonly kind: "outOfInterval"; readonly index: number; readonly seq: number }
  | { readonly kind: "unordered"; readonly index: number };

/**
 * 순수 함수. 한 구독의 events.batch 열이 구간 (start, ...]을 구멍과 겹침 없이 잇는지, 각 알림의 이벤트가
 * 자기 구간 (from, to]에 있고 seq 오름차순인지 검사한다. 문제가 없으면 undefined.
 */
export function findBatchIssue(
  start: number,
  batches: readonly Pick<EventsBatchParams, "from" | "to" | "events">[],
): BatchContinuityIssue | undefined {
  let expectedFrom = start;
  for (const [index, batch] of batches.entries()) {
    if (batch.from !== expectedFrom) {
      return { kind: "gap", index, expectedFrom, from: batch.from };
    }
    if (batch.to < batch.from) {
      return { kind: "backwards", index, from: batch.from, to: batch.to };
    }
    let previous = batch.from;
    for (const event of batch.events) {
      if (event.seq <= batch.from || event.seq > batch.to) {
        return { kind: "outOfInterval", index, seq: event.seq };
      }
      if (event.seq <= previous) return { kind: "unordered", index };
      previous = event.seq;
    }
    expectedFrom = batch.to;
  }
  return undefined;
}
