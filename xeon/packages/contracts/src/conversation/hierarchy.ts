import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TNull,
  type TNumber,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../base/index.ts";
import {
  EffectIdSchema,
  ItemIdSchema,
  PartIdSchema,
  type EffectId,
  type ItemId,
  type PartId,
} from "./ids.ts";
import {
  AssistantMessageSchema,
  ImageContentSchema,
  JsonValueSchema,
  SystemMessageSchema,
  TextContentSchema,
  ToolResultMessageSchema,
  UserMessageSchema,
} from "./message-schema.ts";
import type {
  AssistantMessage,
  ImageContent,
  JsonValue,
  SystemMessage,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "./pi.ts";

// ── 상태 enum ───────────────────────────────────────────────────────────
export const ThreadStatusSchema: TUnion<
  [TLiteral<"idle">, TLiteral<"running">, TLiteral<"closed">]
> = Type.Union([Type.Literal("idle"), Type.Literal("running"), Type.Literal("closed")]);
export type ThreadStatus = Static<typeof ThreadStatusSchema>;

export const TurnStatusSchema: TUnion<
  [
    TLiteral<"running">,
    TLiteral<"waiting">,
    TLiteral<"completed">,
    TLiteral<"interrupted">,
    TLiteral<"failed">,
  ]
> = Type.Union([
  Type.Literal("running"),
  Type.Literal("waiting"),
  Type.Literal("completed"),
  Type.Literal("interrupted"),
  Type.Literal("failed"),
]);
export type TurnStatus = Static<typeof TurnStatusSchema>;

export const StepStatusSchema: TUnion<
  [
    TLiteral<"requesting">,
    TLiteral<"tools">,
    TLiteral<"completed">,
    TLiteral<"interrupted">,
    TLiteral<"failed">,
  ]
> = Type.Union([
  Type.Literal("requesting"),
  Type.Literal("tools"),
  Type.Literal("completed"),
  Type.Literal("interrupted"),
  Type.Literal("failed"),
]);
export type StepStatus = Static<typeof StepStatusSchema>;

export const ItemStatusSchema: TUnion<
  [TLiteral<"in_progress">, TLiteral<"completed">, TLiteral<"failed">, TLiteral<"interrupted">]
> = Type.Union([
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
]);
export type ItemStatus = Static<typeof ItemStatusSchema>;

export const ItemKindSchema: TUnion<
  [
    TLiteral<"user">,
    TLiteral<"assistant">,
    TLiteral<"system">,
    TLiteral<"toolCall">,
    TLiteral<"toolResult">,
    TLiteral<"custom">,
  ]
> = Type.Union([
  Type.Literal("user"),
  Type.Literal("assistant"),
  Type.Literal("system"),
  Type.Literal("toolCall"),
  Type.Literal("toolResult"),
  Type.Literal("custom"),
]);
export type ItemKind = Static<typeof ItemKindSchema>;

/** 유효 전이표. 키 상태에서 갈 수 있는 상태 목록. 종결 상태는 빈 배열. */
export const THREAD_TRANSITIONS: Readonly<Record<ThreadStatus, readonly ThreadStatus[]>> = {
  idle: ["running", "closed"],
  running: ["idle"],
  closed: [],
};
export const TURN_TRANSITIONS: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  running: ["waiting", "completed", "interrupted", "failed"],
  waiting: ["running", "completed", "interrupted", "failed"],
  completed: [],
  interrupted: [],
  failed: [],
};
export const STEP_TRANSITIONS: Readonly<Record<StepStatus, readonly StepStatus[]>> = {
  requesting: ["tools", "completed", "interrupted", "failed"],
  tools: ["completed", "interrupted", "failed"],
  completed: [],
  interrupted: [],
  failed: [],
};
export const ITEM_TRANSITIONS: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = {
  in_progress: ["completed", "failed", "interrupted"],
  completed: [],
  failed: [],
  interrupted: [],
};

export function canTransition<S extends string>(
  table: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  return table[from].includes(to);
}

// ── 확장 커스텀 메시지 ───────────────────────────────────────────────────
/**
 * customType은 "x.<extId>.<영역>.<이름>" 또는 "grp.<groupId>.<영역>.<이름>"이다.
 * conversation은 records를 import하지 않으므로 형식 검사는 하지 않고 문자열로 둔다(F.conversation.spec §3.5.2).
 */
export const XeonCustomMessageSchema: TObject<{
  role: TLiteral<"custom">;
  customType: TString;
  content: TUnion<[TString, TArray<TUnion<[TUnsafe<TextContent>, TUnsafe<ImageContent>]>>]>;
  display: TBoolean;
  details: TUnsafe<JsonValue>;
  timestamp: TNumber;
}> = Type.Object(
  {
    role: Type.Literal("custom"),
    customType: Type.String({ minLength: 1, maxLength: 160 }),
    content: Type.Union([
      Type.String(),
      Type.Array(Type.Union([TextContentSchema, ImageContentSchema])),
    ]),
    display: Type.Boolean(),
    /** 모델에 보내지 않는다. 값이 없으면 null */
    details: JsonValueSchema,
    timestamp: Type.Number(),
  },
  { additionalProperties: false },
);
export type XeonCustomMessage = Static<typeof XeonCustomMessageSchema>;

// 확장은 CustomAgentMessages 병합으로 늘리지 않고 customType으로 구분한다. 선언 병합은 F에 이 한 번뿐이다.
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    "xeon.custom": XeonCustomMessage;
  }
}

// ── item 레코드 ─────────────────────────────────────────────────────────
const requestIdSchema = Nullable(Type.String({ minLength: 1, maxLength: 64 }));

export const UserItemRecordSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  status: typeof ItemStatusSchema;
  kind: TLiteral<"user">;
  message: TUnsafe<UserMessage>;
  requestId: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    status: ItemStatusSchema,
    kind: Type.Literal("user"),
    message: UserMessageSchema,
    requestId: requestIdSchema,
  },
  { additionalProperties: false },
);

export const AssistantItemRecordSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  status: typeof ItemStatusSchema;
  kind: TLiteral<"assistant">;
  message: TUnsafe<AssistantMessage>;
  partIds: TArray<TUnsafe<PartId>>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    status: ItemStatusSchema,
    kind: Type.Literal("assistant"),
    message: AssistantMessageSchema,
    /** partIds[i] ↔ message.content[i] */
    partIds: Type.Array(PartIdSchema, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);

export const SystemItemRecordSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  status: typeof ItemStatusSchema;
  kind: TLiteral<"system">;
  message: TUnsafe<SystemMessage>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    status: ItemStatusSchema,
    kind: Type.Literal("system"),
    message: SystemMessageSchema,
  },
  { additionalProperties: false },
);

export const ToolResultItemRecordSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  status: typeof ItemStatusSchema;
  kind: TLiteral<"toolResult">;
  message: TUnsafe<ToolResultMessage>;
  effectId: TUnion<[TUnsafe<EffectId>, TNull]>;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    status: ItemStatusSchema,
    kind: Type.Literal("toolResult"),
    message: ToolResultMessageSchema,
    effectId: Nullable(EffectIdSchema),
  },
  { additionalProperties: false },
);

export const CustomItemRecordSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  status: typeof ItemStatusSchema;
  kind: TLiteral<"custom">;
  message: typeof XeonCustomMessageSchema;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    status: ItemStatusSchema,
    kind: Type.Literal("custom"),
    message: XeonCustomMessageSchema,
  },
  { additionalProperties: false },
);

export const ItemRecordSchema: TUnion<
  [
    typeof UserItemRecordSchema,
    typeof AssistantItemRecordSchema,
    typeof SystemItemRecordSchema,
    typeof ToolResultItemRecordSchema,
    typeof CustomItemRecordSchema,
  ]
> = Type.Union([
  UserItemRecordSchema,
  AssistantItemRecordSchema,
  SystemItemRecordSchema,
  ToolResultItemRecordSchema,
  CustomItemRecordSchema,
]);
export type ItemRecord = Static<typeof ItemRecordSchema>;

/** 도구 호출 item은 내구 레코드가 따로 없다. 기록은 효과 이벤트(effect.intent/exec/result)가 맡는다. */
export const ToolCallItemSchema: TObject<{
  itemId: TUnsafe<ItemId>;
  kind: TLiteral<"toolCall">;
  toolCallId: TString;
  toolName: TString;
  effectId: TUnion<[TUnsafe<EffectId>, TNull]>;
  status: typeof ItemStatusSchema;
}> = Type.Object(
  {
    itemId: ItemIdSchema,
    kind: Type.Literal("toolCall"),
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: Type.String({ minLength: 1, maxLength: 128 }),
    effectId: Nullable(EffectIdSchema),
    status: ItemStatusSchema,
  },
  { additionalProperties: false },
);
export type ToolCallItem = Static<typeof ToolCallItemSchema>;
