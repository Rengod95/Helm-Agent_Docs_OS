import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TNumber,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { CapabilityIdTypedSchema, ToolNameSchema } from "../../capabilities/index.ts";
import {
  ImageContentSchema,
  JsonValueSchema,
  TextContentSchema,
  UsageSchema,
} from "../../conversation/index.ts";

/** 능力 도구 호출이 대응하는 능력과 메서드(F.capabilities.spec §7) */
export const CapabilityRefSchema: TObject<{
  id: typeof CapabilityIdTypedSchema;
  method: TString;
}> = Type.Object(
  { id: CapabilityIdTypedSchema, method: Type.String({ minLength: 1, maxLength: 48 }) },
  { additionalProperties: false },
);
export type CapabilityRef = Static<typeof CapabilityRefSchema>;

const ToolInputSchema: TRecord<"^.*$", typeof JsonValueSchema> = Type.Record(
  Type.String(),
  JsonValueSchema,
);

const ContentSchema: TArray<TUnion<[typeof TextContentSchema, typeof ImageContentSchema]>> =
  Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 256 });

// ── #13 tool_call (first) ────────────────────────────────────────────────

export const ToolCallPayloadSchema: TObject<{
  toolCallId: TString;
  parentToolCallId: TOptional<TString>;
  toolName: typeof ToolNameSchema;
  input: typeof ToolInputSchema;
  capability: TOptional<typeof CapabilityRefSchema>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    /** 다른 도구가 낸 호출이면 부모 호출 id */
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    toolName: ToolNameSchema,
    /** 읽기 전용. 인자 변경은 지원하지 않는다(review.decisions-2 U-06) */
    input: ToolInputSchema,
    /** 능력 도구면 대응 능력과 메서드 */
    capability: Type.Optional(CapabilityRefSchema),
  },
  { additionalProperties: false },
);
export type ToolCallPayload = Static<typeof ToolCallPayloadSchema>;

export const ToolCallDecisionSchema: TObject<{
  block: TLiteral<true>;
  reason: TString;
  terminate: TOptional<TBoolean>;
}> = Type.Object(
  {
    block: Type.Literal(true),
    reason: Type.String({ maxLength: 500 }),
    /** 이 배치의 모든 결과가 terminate면 배치 뒤 멈춘다(agent-core 의미) */
    terminate: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ToolCallDecision = Static<typeof ToolCallDecisionSchema>;

// ── #14 tool_result (chain) ──────────────────────────────────────────────

/** 호출 정보. 결과 본문은 payload가 아니라 current(ToolResultValue)로 받는다 */
export const ToolResultPayloadSchema: TObject<{
  toolCallId: TString;
  parentToolCallId: TOptional<TString>;
  toolName: typeof ToolNameSchema;
  input: typeof ToolInputSchema;
  capability: TOptional<typeof CapabilityRefSchema>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    toolName: ToolNameSchema,
    input: ToolInputSchema,
    capability: Type.Optional(CapabilityRefSchema),
  },
  { additionalProperties: false },
);
export type ToolResultPayload = Static<typeof ToolResultPayloadSchema>;

export const ToolResultValueSchema: TObject<{
  content: typeof ContentSchema;
  details: TOptional<typeof JsonValueSchema>;
  structuredContent: TOptional<typeof JsonValueSchema>;
  isError: TBoolean;
  usage: TOptional<typeof UsageSchema>;
}> = Type.Object(
  {
    content: ContentSchema,
    details: Type.Optional(JsonValueSchema),
    structuredContent: Type.Optional(JsonValueSchema),
    isError: Type.Boolean(),
    usage: Type.Optional(UsageSchema),
  },
  { additionalProperties: false },
);
export type ToolResultValue = Static<typeof ToolResultValueSchema>;

export const ToolResultPatchSchema: TObject<{
  content: TOptional<typeof ContentSchema>;
  details: TOptional<typeof JsonValueSchema>;
  structuredContent: TOptional<typeof JsonValueSchema>;
  isError: TOptional<TBoolean>;
  usage: TOptional<typeof UsageSchema>;
}> = Type.Object(
  {
    content: Type.Optional(ContentSchema),
    details: Type.Optional(JsonValueSchema),
    structuredContent: Type.Optional(JsonValueSchema),
    isError: Type.Optional(Type.Boolean()),
    usage: Type.Optional(UsageSchema),
  },
  { additionalProperties: false },
);
export type ToolResultPatch = Static<typeof ToolResultPatchSchema>;

// ── #15~#17 tool_execution_* (tap) ───────────────────────────────────────

export const ToolExecutionStartPayloadSchema: TObject<{
  toolCallId: TString;
  toolName: typeof ToolNameSchema;
  args: TUnknown;
  parentToolCallId: TOptional<TString>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: ToolNameSchema,
    args: Type.Unknown(),
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ToolExecutionStartPayload = Static<typeof ToolExecutionStartPayloadSchema>;

export const ToolExecutionUpdatePayloadSchema: TObject<{
  toolCallId: TString;
  toolName: typeof ToolNameSchema;
  args: TUnknown;
  partialResult: TUnknown;
  parentToolCallId: TOptional<TString>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: ToolNameSchema,
    args: Type.Unknown(),
    partialResult: Type.Unknown(),
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ToolExecutionUpdatePayload = Static<typeof ToolExecutionUpdatePayloadSchema>;

export const ToolExecutionEndPayloadSchema: TObject<{
  toolCallId: TString;
  toolName: typeof ToolNameSchema;
  result: TUnknown;
  isError: TBoolean;
  durationMs: TOptional<TNumber>;
  parentToolCallId: TOptional<TString>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: ToolNameSchema,
    result: Type.Unknown(),
    isError: Type.Boolean(),
    /** execute()가 걸린 시간(단조 시계). 도구가 실행되지 않았으면 없다 */
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ToolExecutionEndPayload = Static<typeof ToolExecutionEndPayloadSchema>;
