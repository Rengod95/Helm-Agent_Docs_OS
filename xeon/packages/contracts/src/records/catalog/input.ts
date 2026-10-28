import {
  Type,
  type Static,
  type TAddOptional,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import {
  EventIdSchema,
  ImageContentSchema,
  ItemIdSchema,
  JsonValueSchema,
  TextContentSchema,
  ThreadIdSchema,
  TurnOriginSchema,
  type EventId,
  type ImageContent,
  type ItemId,
  type JsonValue,
  type TextContent,
  type ThreadId,
} from "../../conversation/index.ts";

const Content: TUnion<[TString, TArray<TUnion<[TUnsafe<TextContent>, TUnsafe<ImageContent>]>>]> =
  Type.Union([
    Type.String(),
    Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 1024 }),
  ]);

const UserInput: TObject<{ kind: TLiteral<"user">; content: typeof Content }> = Type.Object(
  { kind: Type.Literal("user"), content: Content },
  { additionalProperties: false },
);
const ContextInput: TObject<{
  kind: TLiteral<"context">;
  customType: TString;
  content: typeof Content;
  display: TBoolean;
  details: TUnsafe<JsonValue>;
}> = Type.Object(
  {
    kind: Type.Literal("context"),
    customType: Type.String({ minLength: 1, maxLength: 160 }),
    content: Content,
    display: Type.Boolean(),
    details: JsonValueSchema,
  },
  { additionalProperties: false },
);

const UserSource: TObject<{
  type: TLiteral<"user">;
  via: TUnion<[TLiteral<"interactive">, TLiteral<"rpc">]>;
}> = Type.Object(
  {
    type: Type.Literal("user"),
    via: Type.Union([Type.Literal("interactive"), Type.Literal("rpc")]),
  },
  { additionalProperties: false },
);
const ExtensionSource: TObject<{ type: TLiteral<"extension">; scopeId: TString }> = Type.Object(
  { type: Type.Literal("extension"), scopeId: Type.String({ minLength: 1, maxLength: 96 }) },
  { additionalProperties: false },
);
const DelegationSource: TObject<{
  type: TLiteral<"delegation">;
  childThreadId: TUnsafe<ThreadId>;
}> = Type.Object(
  { type: Type.Literal("delegation"), childThreadId: ThreadIdSchema },
  { additionalProperties: false },
);
const ScheduleSource: TObject<{ type: TLiteral<"schedule">; timerId: TString }> = Type.Object(
  { type: Type.Literal("schedule"), timerId: Type.String({ minLength: 1, maxLength: 64 }) },
  { additionalProperties: false },
);

/** 모든 입력(사용자, 위임 완료, 예약, 확장 post)의 큐 항목 사실. 입력 id = 이 이벤트 id (L1.tasks.spec §3.8) */
export const InputQueuedPayloadSchema: TObject<{
  mode: TUnion<[TLiteral<"steer">, TLiteral<"followUp">, TLiteral<"next">, TLiteral<"aside">]>;
  item: TUnion<[typeof UserInput, typeof ContextInput]>;
  requestId: TString;
  source: TUnion<
    [typeof UserSource, typeof ExtensionSource, typeof DelegationSource, typeof ScheduleSource]
  >;
  origin: TAddOptional<typeof TurnOriginSchema>;
}> = Type.Object(
  {
    /** "aside"는 F.extensions.spec PostWhen 결정(§10 미결)에 따른다 */
    mode: Type.Union([
      Type.Literal("steer"),
      Type.Literal("followUp"),
      Type.Literal("next"),
      Type.Literal("aside"),
    ]),
    item: Type.Union([UserInput, ContextInput]),
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    source: Type.Union([UserSource, ExtensionSource, DelegationSource, ScheduleSource]),
    /**
     * 이 입력이 시작하는 turn의 출처. 입력을 넣은 쪽이 밝힌다. 선택이라 `version`을 올리지 않는다.
     * 없으면 `source`에서 정한다: user → user, delegation → delegation, schedule → scheduled, extension → other [제안: M3-REQ-06]
     */
    origin: Type.Optional(TurnOriginSchema),
  },
  { additionalProperties: false },
);
export type InputQueuedPayload = Static<typeof InputQueuedPayloadSchema>;

/** inputId = input.queued 이벤트 id */
export const InputPlacedPayloadSchema: TObject<{
  inputId: TUnsafe<EventId>;
  itemId: TUnsafe<ItemId>;
}> = Type.Object({ inputId: EventIdSchema, itemId: ItemIdSchema }, { additionalProperties: false });
export type InputPlacedPayload = Static<typeof InputPlacedPayloadSchema>;

export const InputWithdrawnPayloadSchema: TObject<{
  inputId: TUnsafe<EventId>;
  reason: TUnion<[TLiteral<"user">, TLiteral<"aborted">, TLiteral<"superseded">]>;
}> = Type.Object(
  {
    inputId: EventIdSchema,
    reason: Type.Union([Type.Literal("user"), Type.Literal("aborted"), Type.Literal("superseded")]),
  },
  { additionalProperties: false },
);
export type InputWithdrawnPayload = Static<typeof InputWithdrawnPayloadSchema>;
