import {
  Type,
  type Static,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import {
  CheckpointIdSchema,
  EventIdSchema,
  JsonValueSchema,
  TurnIdSchema,
  UsageSchema,
  type CheckpointId,
  type EventId,
  type JsonValue,
  type TurnId,
  type Usage,
} from "../../conversation/index.ts";

export const LeafMovedPayloadSchema: TObject<{
  leafEventId: TUnsafe<EventId>;
  reason: TUnion<[TLiteral<"branch">, TLiteral<"rewind">, TLiteral<"restore">]>;
}> = Type.Object(
  {
    leafEventId: EventIdSchema,
    reason: Type.Union([Type.Literal("branch"), Type.Literal("rewind"), Type.Literal("restore")]),
  },
  { additionalProperties: false },
);
export type LeafMovedPayload = Static<typeof LeafMovedPayloadSchema>;

export const CompactedPayloadSchema: TObject<{
  summary: TString;
  firstKeptEventId: TUnsafe<EventId>;
  tokensBefore: TInteger;
  details: TUnsafe<JsonValue>;
  usage: TUnion<[TUnsafe<Usage>, TNull]>;
  fromExtension: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    /** 비파괴 컴팩션 요약(F.records.spec §4.6). 모델 컨텍스트 조립 때 firstKeptEventId 앞 내용을 대체한다 */
    summary: Type.String({ maxLength: 65_536 }),
    /** 이 이벤트부터 원문을 모델 컨텍스트에 남긴다 */
    firstKeptEventId: EventIdSchema,
    tokensBefore: Type.Integer({ minimum: 0 }),
    /** 확장 전용 데이터, 모델에 보내지 않는다. 없으면 null */
    details: JsonValueSchema,
    /** 요약 생성 모델 호출 사용량 */
    usage: Nullable(UsageSchema),
    /** 확장이 만든 요약이면 확장 id */
    fromExtension: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);
export type CompactedPayload = Static<typeof CompactedPayloadSchema>;

export const BranchSummarizedPayloadSchema: TObject<{
  fromEventId: TUnsafe<EventId>;
  summary: TString;
  details: TUnsafe<JsonValue>;
  usage: TUnion<[TUnsafe<Usage>, TNull]>;
}> = Type.Object(
  {
    fromEventId: EventIdSchema,
    summary: Type.String({ maxLength: 65_536 }),
    details: JsonValueSchema,
    usage: Nullable(UsageSchema),
  },
  { additionalProperties: false },
);
export type BranchSummarizedPayload = Static<typeof BranchSummarizedPayloadSchema>;

/** 이어서 실행 시도. 복구 표식 resume_attempts의 원천이다(L1.persistence.spec §3.9). */
export const ThreadResumedPayloadSchema: TObject<{
  turnId: TUnsafe<TurnId>;
  attempt: TInteger;
  mode: TUnion<[TLiteral<"manual">, TLiteral<"auto">]>;
  fromCheckpointId: TUnion<[TUnsafe<CheckpointId>, TNull]>;
}> = Type.Object(
  {
    turnId: TurnIdSchema,
    /** 1부터. 같은 turn의 thread.resumed 수 */
    attempt: Type.Integer({ minimum: 1 }),
    mode: Type.Union([Type.Literal("manual"), Type.Literal("auto")]),
    fromCheckpointId: Nullable(CheckpointIdSchema),
  },
  { additionalProperties: false },
);
export type ThreadResumedPayload = Static<typeof ThreadResumedPayloadSchema>;
