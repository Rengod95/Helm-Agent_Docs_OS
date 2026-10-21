import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TNumber,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { Nullable } from "../../base/index.ts";
import { AgentMessageSchema, ModelThinkingLevelSchema } from "../../conversation/index.ts";

/** 헤더 값. null은 삭제를 뜻한다(before_provider_headers) */
const HeaderValueSchema: TUnion<[TString, TNull]> = Nullable(Type.String({ maxLength: 8192 }));

const MessagesSchema: TArray<typeof AgentMessageSchema> = Type.Array(AgentMessageSchema, {
  maxItems: 100_000,
});

// ── #4 context, #5 context_with_system (chain) ───────────────────────────

export const ContextPayloadSchema: TObject<{ messages: typeof MessagesSchema }> = Type.Object(
  { messages: MessagesSchema },
  { additionalProperties: false },
);
export type ContextPayload = Static<typeof ContextPayloadSchema>;

export const ContextValueSchema: TObject<{ messages: typeof MessagesSchema }> = Type.Object(
  { messages: MessagesSchema },
  { additionalProperties: false },
);
export type ContextValue = Static<typeof ContextValueSchema>;

/** 교체 */
export const ContextPatchSchema: TObject<{ messages: typeof MessagesSchema }> = Type.Object(
  { messages: MessagesSchema },
  { additionalProperties: false },
);
export type ContextPatch = Static<typeof ContextPatchSchema>;

// ── #6 cache_warming_decision (chain) ────────────────────────────────────

export const CacheWarmingActionSchema: TUnion<[TLiteral<"warm">, TLiteral<"stop">]> = Type.Union([
  Type.Literal("warm"),
  Type.Literal("stop"),
]);

export const CacheWarmingDecisionPayloadSchema: TObject<{
  warmCost: TNumber;
  missCost: TNumber;
  continuationProbability: TNumber;
  action: typeof CacheWarmingActionSchema;
}> = Type.Object(
  {
    warmCost: Type.Number(),
    missCost: Type.Number(),
    continuationProbability: Type.Number(),
    /** pi의 판정. 핸들러가 받는 원본 */
    action: CacheWarmingActionSchema,
  },
  { additionalProperties: false },
);
export type CacheWarmingDecisionPayload = Static<typeof CacheWarmingDecisionPayloadSchema>;

export const CacheWarmingValueSchema: TObject<{ action: typeof CacheWarmingActionSchema }> =
  Type.Object({ action: CacheWarmingActionSchema }, { additionalProperties: false });
export type CacheWarmingValue = Static<typeof CacheWarmingValueSchema>;

export const CacheWarmingPatchSchema: TObject<{
  action: TOptional<typeof CacheWarmingActionSchema>;
}> = Type.Object(
  { action: Type.Optional(CacheWarmingActionSchema) },
  { additionalProperties: false },
);
export type CacheWarmingPatch = Static<typeof CacheWarmingPatchSchema>;

// ── #7 before_provider_request (chain) ───────────────────────────────────

export const BeforeProviderRequestPayloadSchema: TObject<{
  provider: TString;
  modelId: TString;
  role: TString;
  payload: TUnknown;
}> = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    /** L1.models.spec ModelRole */
    role: Type.String({ minLength: 1, maxLength: 64 }),
    payload: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type BeforeProviderRequestPayload = Static<typeof BeforeProviderRequestPayloadSchema>;

export const ProviderPayloadValueSchema: TObject<{ payload: TUnknown }> = Type.Object(
  { payload: Type.Unknown() },
  { additionalProperties: false },
);
export type ProviderPayloadValue = Static<typeof ProviderPayloadValueSchema>;

/** 교체 */
export const ProviderPayloadPatchSchema: TObject<{ payload: TUnknown }> = Type.Object(
  { payload: Type.Unknown() },
  { additionalProperties: false },
);
export type ProviderPayloadPatch = Static<typeof ProviderPayloadPatchSchema>;

// ── #8 before_provider_headers (chain) ───────────────────────────────────

export const BeforeProviderHeadersPayloadSchema: TObject<{
  provider: TString;
  modelId: TString;
  role: TString;
  headers: TRecord<"^.*$", typeof HeaderValueSchema>;
}> = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    role: Type.String({ minLength: 1, maxLength: 64 }),
    /** 인증 헤더 값은 "[secret]"로 가린다 */
    headers: Type.Record(Type.String(), HeaderValueSchema),
  },
  { additionalProperties: false },
);
export type BeforeProviderHeadersPayload = Static<typeof BeforeProviderHeadersPayloadSchema>;

export const HeadersValueSchema: TObject<{ headers: TRecord<"^.*$", typeof HeaderValueSchema> }> =
  Type.Object(
    { headers: Type.Record(Type.String(), HeaderValueSchema) },
    { additionalProperties: false },
  );
export type HeadersValue = Static<typeof HeadersValueSchema>;

export const HeadersPatchSchema: TObject<{ set: TRecord<"^.*$", typeof HeaderValueSchema> }> =
  Type.Object(
    { set: Type.Record(Type.String(), HeaderValueSchema) },
    { additionalProperties: false },
  );
export type HeadersPatch = Static<typeof HeadersPatchSchema>;

// ── #9 after_provider_response, #10 provider_stream_event (tap) ──────────

export const AfterProviderResponsePayloadSchema: TObject<{
  provider: TString;
  modelId: TString;
  role: TString;
  status: TInteger;
  headers: TRecord<"^.*$", TString>;
}> = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    role: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.Integer({ minimum: 0, maximum: 999 }),
    /** 인증·쿠키 헤더 제외 */
    headers: Type.Record(Type.String(), Type.String({ maxLength: 8192 })),
  },
  { additionalProperties: false },
);
export type AfterProviderResponsePayload = Static<typeof AfterProviderResponsePayloadSchema>;

export const ProviderStreamPayloadSchema: TObject<{
  provider: TString;
  api: TString;
  model: TString;
  data: TUnknown;
}> = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    api: Type.String({ minLength: 1, maxLength: 128 }),
    model: Type.String({ minLength: 1, maxLength: 256 }),
    data: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type ProviderStreamPayload = Static<typeof ProviderStreamPayloadSchema>;

// ── #11 model_select, #12 thinking_level_select (tap) ────────────────────

/** 확장은 L1 타입을 import할 수 없어 모델 바인딩을 JSON 수준 모양으로 적는다 */
export const ModelBindingJsonSchema: TObject<{
  role: TString;
  provider: TString;
  modelId: TString;
  thinkingLevel: typeof ModelThinkingLevelSchema;
}> = Type.Object(
  {
    role: Type.String({ minLength: 1, maxLength: 64 }),
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    thinkingLevel: ModelThinkingLevelSchema,
  },
  { additionalProperties: false },
);
export type ModelBindingJson = Static<typeof ModelBindingJsonSchema>;

export const ModelSelectPayloadSchema: TObject<{
  binding: typeof ModelBindingJsonSchema;
  previous: TUnion<[typeof ModelBindingJsonSchema, TNull]>;
  source: TUnion<[TLiteral<"set">, TLiteral<"route">, TLiteral<"restore">, TLiteral<"fallback">]>;
}> = Type.Object(
  {
    binding: ModelBindingJsonSchema,
    previous: Nullable(ModelBindingJsonSchema),
    /** pi의 "cycle"은 Xeon에 대응 기능이 없어 뺐다(L1.models.spec §7.2) */
    source: Type.Union([
      Type.Literal("set"),
      Type.Literal("route"),
      Type.Literal("restore"),
      Type.Literal("fallback"),
    ]),
  },
  { additionalProperties: false },
);
export type ModelSelectPayload = Static<typeof ModelSelectPayloadSchema>;

export const ThinkingLevelSelectPayloadSchema: TObject<{
  role: TString;
  level: typeof ModelThinkingLevelSchema;
  previousLevel: TUnion<[typeof ModelThinkingLevelSchema, TNull]>;
}> = Type.Object(
  {
    role: Type.String({ minLength: 1, maxLength: 64 }),
    level: ModelThinkingLevelSchema,
    previousLevel: Nullable(ModelThinkingLevelSchema),
  },
  { additionalProperties: false },
);
export type ThinkingLevelSelectPayload = Static<typeof ThinkingLevelSelectPayloadSchema>;
