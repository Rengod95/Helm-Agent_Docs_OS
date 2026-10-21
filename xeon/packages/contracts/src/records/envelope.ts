import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TArray,
  type TString,
  type TUnion,
  type TUnknown,
  type TUnsafe,
} from "typebox";
import { Nullable, err, ok, type Result } from "../base/index.ts";
import {
  EventIdSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  type EventId,
  type StepId,
  type ThreadId,
  type TurnId,
} from "../conversation/index.ts";
import { DetachedFieldSchema } from "./blob.ts";
import { EventKindSchema, type EventKind } from "./kinds.ts";

/** 내구 envelope 직렬화 크기 상한: 256 KiB */
export const ENVELOPE_MAX_BYTES: number = 262_144;

const idField = (): TUnsafe<EventId> => EventIdSchema;

/**
 * 내구 이벤트. 이벤트 테이블에 저장되고 seq를 받는다. 재생 원본이다.
 * additionalProperties: false라 durable:true인데 n이 있으면 검증에서 거부된다.
 */
export const DurableEventEnvelopeSchema: TObject<{
  id: TUnsafe<EventId>;
  kind: TUnsafe<EventKind>;
  version: TInteger;
  threadId: TUnsafe<ThreadId>;
  turnId: TUnion<[TUnsafe<TurnId>, TNull]>;
  stepId: TUnion<[TUnsafe<StepId>, TNull]>;
  recordedAt: TInteger;
  causationId: TUnion<[TUnsafe<EventId>, TNull]>;
  correlationId: TUnion<[TString, TNull]>;
  payload: TUnknown;
  durable: TLiteral<true>;
  seq: TInteger;
  parentId: TUnion<[TUnsafe<EventId>, TNull]>;
  detached: TOptional<TArray<typeof DetachedFieldSchema>>;
}> = Type.Object(
  {
    /** evt_<ULID> */
    id: idField(),
    /** "<영역>.<이름>", 확장은 "x.<extId>." 또는 "grp.<groupId>." 접두 */
    kind: EventKindSchema,
    /** kind별 payload 버전, 정수 ≥ 1 */
    version: Type.Integer({ minimum: 1 }),
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    /** ms 정수. 저장소(내구)·발신자(휘발)가 채운다 */
    recordedAt: Type.Integer({ minimum: 0 }),
    /** 이 이벤트를 직접 일으킨 이벤트 */
    causationId: Nullable(EventIdSchema),
    /** 묶음 키(예: turnId, effectId) */
    correlationId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    /** kind·version별 스키마로 검증(catalog) */
    payload: Type.Unknown(),
    durable: Type.Literal(true),
    /** 전역 단조, 무간격, 정수 ≥ 1. 저장소가 채운다 */
    seq: Type.Integer({ minimum: 1 }),
    /** 분기 트리 부모. thread 첫 이벤트만 null */
    parentId: Nullable(EventIdSchema),
    /** blob으로 옮긴 문자열 필드 목록 */
    detached: Type.Optional(Type.Array(DetachedFieldSchema, { maxItems: 256 })),
  },
  { additionalProperties: false },
);
export type DurableEventEnvelope = Static<typeof DurableEventEnvelopeSchema>;

/**
 * 휘발 이벤트. 저장하지 않고 실행 중에만 흐른다. seq 없이 조각 번호 n을 받는다.
 * parentId, detached가 없다(분기 트리에 들어가지 않는다).
 */
export const VolatileEventEnvelopeSchema: TObject<{
  id: TUnsafe<EventId>;
  kind: TUnsafe<EventKind>;
  version: TInteger;
  threadId: TUnsafe<ThreadId>;
  turnId: TUnion<[TUnsafe<TurnId>, TNull]>;
  stepId: TUnion<[TUnsafe<StepId>, TNull]>;
  recordedAt: TInteger;
  causationId: TUnion<[TUnsafe<EventId>, TNull]>;
  correlationId: TUnion<[TString, TNull]>;
  payload: TUnknown;
  durable: TLiteral<false>;
  n: TInteger;
  afterSeq: TInteger;
}> = Type.Object(
  {
    id: idField(),
    kind: EventKindSchema,
    version: Type.Integer({ minimum: 1 }),
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    recordedAt: Type.Integer({ minimum: 0 }),
    causationId: Nullable(EventIdSchema),
    correlationId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
    payload: Type.Unknown(),
    durable: Type.Literal(false),
    /** (threadId, turnId) 안 조각 번호, 0부터 1씩 */
    n: Type.Integer({ minimum: 0 }),
    /** 발신 시점의 마지막 내구 seq, 정수 ≥ 0 */
    afterSeq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type VolatileEventEnvelope = Static<typeof VolatileEventEnvelopeSchema>;

/** durable을 판별자로 하는 유니온 */
export const EventEnvelopeSchema: TUnion<
  [typeof DurableEventEnvelopeSchema, typeof VolatileEventEnvelopeSchema]
> = Type.Union([DurableEventEnvelopeSchema, VolatileEventEnvelopeSchema]);
export type EventEnvelope = DurableEventEnvelope | VolatileEventEnvelope;

/**
 * 저장소에 넘기는 초안. seq, recordedAt, parentId는 저장소가 채운다. id는 호출자가 IdFactory로 미리 발급한다.
 * parentId를 지정하면 분기 생성(§4.6), 생략하면 현재 leaf에 붙는다.
 */
export type DurableEventDraft = Omit<DurableEventEnvelope, "seq" | "recordedAt" | "parentId"> & {
  parentId?: EventId | null;
};

export type EnvelopeSizeError = { kind: "event_too_large"; bytes: number; limit: number };

/** UTF-8 기준 JSON.stringify(envelope) 길이를 잰다. 순수 함수. 성공 값은 바이트 수. */
export function checkEnvelopeSize(envelope: EventEnvelope): Result<number, EnvelopeSizeError> {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
  if (bytes > ENVELOPE_MAX_BYTES) {
    return err({ kind: "event_too_large", bytes, limit: ENVELOPE_MAX_BYTES });
  }
  return ok(bytes);
}
