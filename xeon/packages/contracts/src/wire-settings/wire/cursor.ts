import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { ThreadIdSchema } from "../../conversation/index.ts";

// F.wire-settings.spec §3.4.1~§3.4.2. F.records는 seq를 number로 두고 저장소 정체 필드를 두지 않아 wire가 두 스키마를 정한다.

/** 0은 "아직 이벤트 없음" 위치. 내구 이벤트의 seq는 1부터다 */
export const SeqSchema: TInteger = Type.Integer({ minimum: 0 });
export type Seq = Static<typeof SeqSchema>;

/** 저장소 정체성 ID `sto_<ULID>`. DB 파일 하나의 정체이고 백업 복원이나 DB 재생성 때 바뀐다. IdPrefix에는 넣지 않는다 */
export type StoreId = `sto_${string}`;
export const StoreIdSchema: TUnsafe<StoreId> = Type.Unsafe<StoreId>(
  Type.String({ pattern: "^sto_[0-7][0-9A-HJKMNP-TV-Z]{25}$", minLength: 30, maxLength: 30 }),
);

export const StreamPositionSchema: TObject<{
  storeId: typeof StoreIdSchema;
  seq: typeof SeqSchema;
}> = Type.Object({ storeId: StoreIdSchema, seq: SeqSchema }, { additionalProperties: false });
export type StreamPosition = Static<typeof StreamPositionSchema>;

export const SubscribeFromSchema: TUnion<[typeof StreamPositionSchema, TLiteral<"head">]> =
  Type.Union([StreamPositionSchema, Type.Literal("head")]);
export type SubscribeFrom = Static<typeof SubscribeFromSchema>;

export const SubIdSchema: TString = Type.String({
  minLength: 1,
  maxLength: 16,
  pattern: "^[A-Za-z0-9]+$",
});
export type SubId = Static<typeof SubIdSchema>;

const KindPrefixSchema: TString = Type.String({ minLength: 1, maxLength: 96 });

export const EventFilterSchema: TObject<{
  threadIds: TOptional<TArray<typeof ThreadIdSchema>>;
  kindPrefixes: TOptional<TArray<typeof KindPrefixSchema>>;
  excludeKindPrefixes: TOptional<TArray<typeof KindPrefixSchema>>;
}> = Type.Object(
  {
    threadIds: Type.Optional(Type.Array(ThreadIdSchema, { maxItems: 64 })),
    /** 예: "item.", "x.web-exa." */
    kindPrefixes: Type.Optional(Type.Array(KindPrefixSchema, { maxItems: 32 })),
    excludeKindPrefixes: Type.Optional(Type.Array(KindPrefixSchema, { maxItems: 32 })),
  },
  { additionalProperties: false },
);
export type EventFilter = Static<typeof EventFilterSchema>;

export const EventsSubscribeParamsSchema: TObject<{
  from: typeof SubscribeFromSchema;
  filter: TOptional<typeof EventFilterSchema>;
}> = Type.Object(
  { from: SubscribeFromSchema, filter: Type.Optional(EventFilterSchema) },
  { additionalProperties: false },
);
export type EventsSubscribeParams = Static<typeof EventsSubscribeParamsSchema>;

export const EventsSubscribeResultSchema: TObject<{
  sub: typeof SubIdSchema;
  /** from.seq 또는 응답 시점의 headSeq */
  start: typeof SeqSchema;
  headSeq: typeof SeqSchema;
  storeId: typeof StoreIdSchema;
  mode: TUnion<[TLiteral<"replaying">, TLiteral<"live">]>;
}> = Type.Object(
  {
    sub: SubIdSchema,
    start: SeqSchema,
    headSeq: SeqSchema,
    storeId: StoreIdSchema,
    mode: Type.Union([Type.Literal("replaying"), Type.Literal("live")]),
  },
  { additionalProperties: false },
);
export type EventsSubscribeResult = Static<typeof EventsSubscribeResultSchema>;

export const EventsUnsubscribeParamsSchema: TObject<{ sub: typeof SubIdSchema }> = Type.Object(
  { sub: SubIdSchema },
  { additionalProperties: false },
);
export type EventsUnsubscribeParams = Static<typeof EventsUnsubscribeParamsSchema>;

export const ReplayOutOfRangeReasonSchema: TUnion<
  [TLiteral<"storeMismatch">, TLiteral<"aheadOfHead">, TLiteral<"beforeOldest">, TLiteral<"tooFar">]
> = Type.Union([
  Type.Literal("storeMismatch"),
  Type.Literal("aheadOfHead"),
  Type.Literal("beforeOldest"),
  Type.Literal("tooFar"),
]);
export type ReplayOutOfRangeReason = Static<typeof ReplayOutOfRangeReasonSchema>;
