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
} from "typebox";
import {
  CallerIdSchema,
  CapabilityIdTypedSchema,
  ToolHintsSchema,
  ToolNameSchema,
  ToolRiskSchema,
} from "../../capabilities/index.ts";
import {
  ImageContentSchema,
  AgentToolResultSchema,
  DeepJsonObjectSchema,
  JsonValueSchema,
  StepIdSchema,
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
  risk: TOptional<typeof ToolRiskSchema>;
  hints: TOptional<typeof ToolHintsSchema>;
  caller: TOptional<typeof CallerIdSchema>;
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
    /**
     * 도구의 효과 범위(미선언은 "exec"). 그룹 핸들러의 쓰기 판정에 쓴다(M3-REQ-04).
     * 선택이다: L1.tools가 채우기 전(M3-REQ-71)의 호출자가 컴파일되도록 열어 둔다. 채운 뒤에는 항상 있다 [제안]
     */
    risk: Type.Optional(ToolRiskSchema),
    /** 도구 작성자의 정책 힌트. 검증되지 않는 선언이다 */
    hints: Type.Optional(ToolHintsSchema),
    /** 호출 주체(주 대화 또는 서브에이전트). 자식 대화의 호출을 구분한다. `risk`와 같은 이유로 선택이다 [제안] */
    caller: Type.Optional(CallerIdSchema),
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
  risk: TOptional<typeof ToolRiskSchema>;
  hints: TOptional<typeof ToolHintsSchema>;
  caller: TOptional<typeof CallerIdSchema>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    toolName: ToolNameSchema,
    input: ToolInputSchema,
    capability: Type.Optional(CapabilityRefSchema),
    risk: Type.Optional(ToolRiskSchema),
    hints: Type.Optional(ToolHintsSchema),
    caller: Type.Optional(CallerIdSchema),
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
  args: typeof DeepJsonObjectSchema;
  parentToolCallId: TOptional<TString>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: ToolNameSchema,
    args: DeepJsonObjectSchema,
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ToolExecutionStartPayload = Static<typeof ToolExecutionStartPayloadSchema>;

export const ToolExecutionUpdatePayloadSchema: TObject<{
  toolCallId: TString;
  toolName: typeof ToolNameSchema;
  args: typeof DeepJsonObjectSchema;
  partialResult: typeof AgentToolResultSchema;
  parentToolCallId: TOptional<TString>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: ToolNameSchema,
    args: DeepJsonObjectSchema,
    partialResult: AgentToolResultSchema,
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ToolExecutionUpdatePayload = Static<typeof ToolExecutionUpdatePayloadSchema>;

export const ToolExecutionEndPayloadSchema: TObject<{
  toolCallId: TString;
  toolName: typeof ToolNameSchema;
  input: TOptional<typeof ToolInputSchema>;
  stepId: TOptional<typeof StepIdSchema>;
  result: typeof AgentToolResultSchema;
  isError: TBoolean;
  durationMs: TOptional<TNumber>;
  parentToolCallId: TOptional<TString>;
}> = Type.Object(
  {
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: ToolNameSchema,
    /** 호출 인자(비밀을 가린 값). 결과 한 건만으로 무엇을 실행했는지 알 수 있게 한다(M3-REQ-04). 선택이다: L1.tools가 채우기 전의 호출자가 컴파일되도록 열어 둔다 [제안] */
    input: Type.Optional(ToolInputSchema),
    /** 호출이 속한 step. 학습 그룹의 step 중복 방지에 쓴다. `input`과 같은 이유로 선택이다 [제안] */
    stepId: Type.Optional(StepIdSchema),
    result: AgentToolResultSchema,
    isError: Type.Boolean(),
    /** execute()가 걸린 시간(단조 시계). 도구가 실행되지 않았으면 없다 */
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    parentToolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ToolExecutionEndPayload = Static<typeof ToolExecutionEndPayloadSchema>;
