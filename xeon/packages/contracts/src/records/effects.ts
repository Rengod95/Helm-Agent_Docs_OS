import {
  Type,
  type Static,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Nullable } from "../base/index.ts";
import {
  EffectIdSchema,
  InputRequiredInfoSchema,
  ItemIdSchema,
  JsonObjectSchema,
  JsonValueSchema,
  ReplayPolicySchema,
  ResultStatusSchema,
  type EffectId,
  type ItemId,
  type JsonObject,
  type JsonValue,
  type ReplayPolicy,
} from "../conversation/index.ts";
import { BlobRefSchema } from "./blob.ts";

// ReplayPolicy, ReplayPolicySchema, toReplayPolicy의 정의는 F.conversation.spec §3.6(tool-result.ts)이다.
// records와 capabilities가 함께 쓰므로 둘 다 import할 수 있는 conversation에 둔다(F.readme §3). records는 같은 심볼을 다시 export한다.
export {
  type ReplayPolicy,
  ReplayPolicySchema,
  toReplayPolicy,
} from "../conversation/tool-result.ts";

/** 실행 전 의도(effect.intent). tool_call 지점을 통과한 최종 인자를 실행 전에 커밋한다. */
export const EffectIntentSchema: TObject<{
  effectId: TUnsafe<EffectId>;
  toolCallId: TString;
  toolName: TString;
  itemId: TUnsafe<ItemId>;
  argsHash: TString;
  args: TUnion<[TUnsafe<JsonObject>, typeof BlobRefSchema]>;
  replay: typeof ReplayPolicySchema;
  idempotencyKey: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    effectId: EffectIdSchema,
    /** pi ToolCall.id */
    toolCallId: Type.String({ minLength: 1, maxLength: 256 }),
    toolName: Type.String({ minLength: 1, maxLength: 128 }),
    /** 도구 호출 item */
    itemId: ItemIdSchema,
    /** 최종 인자 정규화 JSON의 sha256 hex */
    argsHash: Type.String({ pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 }),
    /** 검증·정규화한 최종 인자. 재실행 입력 */
    args: Type.Union([JsonObjectSchema, BlobRefSchema]),
    replay: ReplayPolicySchema,
    /** 외부 멱등 키(도구가 제공할 때) */
    idempotencyKey: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type EffectIntent = Static<typeof EffectIntentSchema>;

/** 실행 시작 표시(effect.exec). */
export const EffectExecSchema: TObject<{
  effectId: TUnsafe<EffectId>;
  startedAt: TInteger;
}> = Type.Object(
  { effectId: EffectIdSchema, startedAt: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type EffectExec = Static<typeof EffectExecSchema>;

export const EffectStatusSchema: TUnion<
  [TLiteral<"ok">, TLiteral<"error">, TLiteral<"interrupted">, TLiteral<"abandoned">]
> = Type.Union([
  Type.Literal("ok"),
  Type.Literal("error"),
  Type.Literal("interrupted"),
  Type.Literal("abandoned"),
]);
export type EffectStatus = Static<typeof EffectStatusSchema>;

export const EffectOutputSchema: TObject<{
  structuredContent: TUnsafe<JsonValue>;
  terminate: TBoolean;
  status: TOptional<typeof ResultStatusSchema>;
  inputRequired: TOptional<typeof InputRequiredInfoSchema>;
}> = Type.Object(
  {
    structuredContent: JsonValueSchema,
    terminate: Type.Boolean(),
    /** 없으면 "complete" (F.conversation.spec §3.6) */
    status: Type.Optional(ResultStatusSchema),
    inputRequired: Type.Optional(InputRequiredInfoSchema),
  },
  { additionalProperties: false },
);
export type EffectOutput = Static<typeof EffectOutputSchema>;

/** 결과(effect.result). toolResult item.recorded와 같은 커밋에 쓴다. */
export const EffectResultSchema: TObject<{
  effectId: TUnsafe<EffectId>;
  status: typeof EffectStatusSchema;
  resultItemId: TUnion<[TUnsafe<ItemId>, TNull]>;
  output: TUnion<[typeof EffectOutputSchema, TNull]>;
  blobRef: TUnion<[typeof BlobRefSchema, TNull]>;
  durationMs: TUnion<[TInteger, TNull]>;
  synthesized: TBoolean;
}> = Type.Object(
  {
    effectId: EffectIdSchema,
    status: EffectStatusSchema,
    /** 같은 커밋의 toolResult item */
    resultItemId: Nullable(ItemIdSchema),
    /** 합성 결과는 null */
    output: Nullable(EffectOutputSchema),
    /** 잘리기 전 전체 원본 출력 */
    blobRef: Nullable(BlobRefSchema),
    durationMs: Nullable(Type.Integer({ minimum: 0 })),
    /** 복구 규칙이 만든 결과면 true */
    synthesized: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type EffectResult = Static<typeof EffectResultSchema>;

export const OUTCOME_UNKNOWN_TEXT: string =
  "The tool call was interrupted before its result was recorded. It may have taken effect. Check the current state before retrying.";
export const NOT_STARTED_TEXT: string =
  "The tool call was interrupted before it started. It had no effect.";

export type EffectRecovery =
  /** 결과가 이미 있음 */
  | { action: "none" }
  /** 저장 인자로 다시 실행 */
  | { action: "rerun"; intent: EffectIntent }
  | {
      action: "synthesize";
      code: "not_started" | "outcome_unknown";
      result: EffectResult;
      content: string;
    };

export interface EffectRecoveryInput {
  intent: EffectIntent;
  exec: EffectExec | null;
  result: EffectResult | null;
  /** 현재 등록된 도구의 선언. 도구가 사라졌으면 null */
  currentReplay: ReplayPolicy | null;
}

/**
 * 재개 시 결과 없는 효과를 어떻게 닫을지 정하는 순수 함수(F.records.spec §3.5 결정표).
 * 재실행은 저장된 intent.replay와 현재 선언이 모두 safe일 때만 한다. 입력을 바꾸지 않는다.
 */
export function decideEffectRecovery(input: EffectRecoveryInput): EffectRecovery {
  const { intent, exec, result, currentReplay } = input;
  if (result !== null) return { action: "none" };
  if (intent.replay === "safe" && currentReplay === "safe") return { action: "rerun", intent };

  const started = exec !== null;
  const synthesized: EffectResult = {
    effectId: intent.effectId,
    status: started ? "interrupted" : "abandoned",
    resultItemId: null,
    output: null,
    blobRef: null,
    durationMs: null,
    synthesized: true,
  };
  return {
    action: "synthesize",
    code: started ? "outcome_unknown" : "not_started",
    result: synthesized,
    content: started ? OUTCOME_UNKNOWN_TEXT : NOT_STARTED_TEXT,
  };
}
