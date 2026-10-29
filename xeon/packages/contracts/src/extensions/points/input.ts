import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import {
  DeepJsonObjectSchema,
  ImageContentSchema,
  JsonValueSchema,
  TextContentSchema,
} from "../../conversation/index.ts";

/** 큰 본문(사용자 입력, 프롬프트)용 상한. 더 큰 내용은 blob이다(DT-15) */
const TEXT_MAX = 4_000_000;

const ImagesSchema: TArray<typeof ImageContentSchema> = Type.Array(ImageContentSchema, {
  maxItems: 64,
});

// ── #1 input (chain) ─────────────────────────────────────────────────────

export const InputSourceSchema: TUnion<
  [TLiteral<"interactive">, TLiteral<"rpc">, TLiteral<"extension">]
> = Type.Union([Type.Literal("interactive"), Type.Literal("rpc"), Type.Literal("extension")]);

export const InputPayloadSchema: TObject<{
  text: TString;
  images: TOptional<typeof ImagesSchema>;
  source: typeof InputSourceSchema;
  streamingBehavior: TOptional<TUnion<[TLiteral<"steer">, TLiteral<"followUp">]>>;
}> = Type.Object(
  {
    text: Type.String({ maxLength: TEXT_MAX }),
    images: Type.Optional(ImagesSchema),
    source: InputSourceSchema,
    streamingBehavior: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
  },
  { additionalProperties: false },
);
export type InputPayload = Static<typeof InputPayloadSchema>;

export const InputValueSchema: TObject<{
  text: TString;
  images: TOptional<typeof ImagesSchema>;
  handled: TBoolean;
}> = Type.Object(
  {
    text: Type.String({ maxLength: TEXT_MAX }),
    images: Type.Optional(ImagesSchema),
    handled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type InputValue = Static<typeof InputValueSchema>;

export const InputTransformPatchSchema: TObject<{
  action: TLiteral<"transform">;
  text: TString;
  images: TOptional<typeof ImagesSchema>;
}> = Type.Object(
  {
    action: Type.Literal("transform"),
    text: Type.String({ maxLength: TEXT_MAX }),
    images: Type.Optional(ImagesSchema),
  },
  { additionalProperties: false },
);
export const InputHandledPatchSchema: TObject<{ action: TLiteral<"handled"> }> = Type.Object(
  { action: Type.Literal("handled") },
  { additionalProperties: false },
);
export const InputPatchSchema: TUnion<
  [typeof InputTransformPatchSchema, typeof InputHandledPatchSchema]
> = Type.Union([InputTransformPatchSchema, InputHandledPatchSchema]);
export type InputPatch = Static<typeof InputPatchSchema>;

// ── #2 user_bash (first) ─────────────────────────────────────────────────

export const UserBashPayloadSchema: TObject<{
  command: TString;
  excludeFromContext: TBoolean;
  cwd: TString;
}> = Type.Object(
  {
    command: Type.String({ maxLength: 65_536 }),
    /** "!!" 접두로 실행해 LLM 컨텍스트에서 뺀 명령 */
    excludeFromContext: Type.Boolean(),
    cwd: Type.String({ maxLength: 4096 }),
  },
  { additionalProperties: false },
);
export type UserBashPayload = Static<typeof UserBashPayloadSchema>;

/** pi BashResult와 같은 필드. 실행 연산(pi BashOperations)은 함수라 F에 두지 않는다 */
export const UserBashResultSchema: TObject<{
  output: TString;
  exitCode: TOptional<TInteger>;
  cancelled: TBoolean;
  truncated: TBoolean;
  fullOutputPath: TOptional<TString>;
}> = Type.Object(
  {
    output: Type.String({ maxLength: TEXT_MAX }),
    exitCode: Type.Optional(Type.Integer()),
    cancelled: Type.Boolean(),
    truncated: Type.Boolean(),
    fullOutputPath: Type.Optional(Type.String({ maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export type UserBashResult = Static<typeof UserBashResultSchema>;

export const UserBashReplaceDecisionSchema: TObject<{
  type: TLiteral<"result">;
  result: typeof UserBashResultSchema;
}> = Type.Object(
  { type: Type.Literal("result"), result: UserBashResultSchema },
  { additionalProperties: false },
);
export const UserBashDenyDecisionSchema: TObject<{
  type: TLiteral<"deny">;
  reason: TString;
}> = Type.Object(
  { type: Type.Literal("deny"), reason: Type.String({ maxLength: 500 }) },
  { additionalProperties: false },
);
/** 실행 결과 대체 또는 거부. pi 결정에 deny 변형을 더했다(F.extensions.spec §3.4 2행) */
export const UserBashDecisionSchema: TUnion<
  [typeof UserBashReplaceDecisionSchema, typeof UserBashDenyDecisionSchema]
> = Type.Union([UserBashReplaceDecisionSchema, UserBashDenyDecisionSchema]);
export type UserBashDecision = Static<typeof UserBashDecisionSchema>;

// ── #3 before_agent_start (chain) ────────────────────────────────────────

export const BeforeAgentStartPayloadSchema: TObject<{
  prompt: TString;
  images: TOptional<typeof ImagesSchema>;
  systemPrompt: TString;
  systemPromptOptions: typeof DeepJsonObjectSchema;
}> = Type.Object(
  {
    /** 확장을 거친 사용자 프롬프트 텍스트 */
    prompt: Type.String({ maxLength: TEXT_MAX }),
    images: Type.Optional(ImagesSchema),
    /** 핸들러가 돌기 전 시스템 프롬프트(원본). 누적은 current.systemPrompt에 쌓인다 */
    systemPrompt: Type.String({ maxLength: TEXT_MAX }),
    /** pi NormalizedBuildSystemPromptOptions를 JSON 객체로 직렬화한 값. 읽기 전용이다 */
    systemPromptOptions: DeepJsonObjectSchema,
  },
  { additionalProperties: false },
);
export type BeforeAgentStartPayload = Static<typeof BeforeAgentStartPayloadSchema>;

/** pi BeforeAgentStartEventResult.message: customType, content, display, details */
export const CustomMessageDraftSchema: TObject<{
  customType: TString;
  content: TUnion<[TString, TArray<TUnion<[typeof TextContentSchema, typeof ImageContentSchema]>>]>;
  display: TBoolean;
  details: TOptional<typeof JsonValueSchema>;
}> = Type.Object(
  {
    customType: Type.String({ minLength: 1, maxLength: 160 }),
    content: Type.Union([
      Type.String({ maxLength: TEXT_MAX }),
      Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 256 }),
    ]),
    display: Type.Boolean(),
    details: Type.Optional(JsonValueSchema),
  },
  { additionalProperties: false },
);
export type CustomMessageDraft = Static<typeof CustomMessageDraftSchema>;

export const BeforeAgentStartValueSchema: TObject<{
  messages: TArray<typeof CustomMessageDraftSchema>;
  systemPrompt: TString;
}> = Type.Object(
  {
    messages: Type.Array(CustomMessageDraftSchema, { maxItems: 64 }),
    systemPrompt: Type.String({ maxLength: TEXT_MAX }),
  },
  { additionalProperties: false },
);
export type BeforeAgentStartValue = Static<typeof BeforeAgentStartValueSchema>;

export const BeforeAgentStartPatchSchema: TObject<{
  message: TOptional<typeof CustomMessageDraftSchema>;
  systemPrompt: TOptional<TString>;
}> = Type.Object(
  {
    /** 추가한다(merge). 여러 핸들러의 메시지가 순서대로 쌓인다 */
    message: Type.Optional(CustomMessageDraftSchema),
    /** 시스템 프롬프트. 원본 뒤에 덧붙인 값은 여러 핸들러의 덧붙임이 순서대로 쌓이고, 원본으로 시작하지 않는 전체 교체는 마지막 값이 이긴다(collect 병합). 핸들러는 모두 원본을 본다 */
    systemPrompt: Type.Optional(Type.String({ maxLength: TEXT_MAX })),
  },
  { additionalProperties: false },
);
export type BeforeAgentStartPatch = Static<typeof BeforeAgentStartPatchSchema>;
