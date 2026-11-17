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
} from "typebox";
import { CallerIdSchema } from "../../capabilities/index.ts";
import { ThreadIdSchema, UsageSchema } from "../../conversation/index.ts";

// 서브에이전트 앞뒤 훅(M5e 스펙 §4.3.3, §4.3.4). 서브에이전트 서비스의 입구(`spawn`, `delegate`)와 정착 뒤가 발화한다.

/**
 * 보고 본문 상한(글자). 서브에이전트가 `agent.settled` 기록에 싣는 값(core-agents `STORED_REPORT_MAX`, service.ts:52)과 같다.
 * 65,536자 기록 상한에서 격리 블록 여유를 뺀 값이다. 같은 값을 쓰는 곳은 이 상수를 가져다 쓴다.
 */
export const AGENT_REPORT_TEXT_MAX = 60_000;

/** 자식을 만든 입구. 모델이 부른 `agent` 도구, 주도 함수의 `loop.spawn`, 그룹의 `g.delegate` */
export const AgentSpawnEntrySchema: TUnion<
  [TLiteral<"tool">, TLiteral<"drive">, TLiteral<"delegate">]
> = Type.Union([Type.Literal("tool"), Type.Literal("drive"), Type.Literal("delegate")]);
export type AgentSpawnEntry = Static<typeof AgentSpawnEntrySchema>;

export const AgentSpawnBeforePayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  requestId: TString;
  agent: TString;
  /** 과제 본문. 앞 4,000자만 싣는다(호출하는 쪽이 자른다) */
  task: TString;
  caller: typeof CallerIdSchema;
  depth: TInteger;
  entry: typeof AgentSpawnEntrySchema;
  /** `entry`가 `tool`이면 부른 도구 호출 id. 도구 블록의 `tool.call.before`와 겹침을 가리는 데 쓴다 */
  toolCallId: TOptional<TString>;
  background: TBoolean;
  model: TOptional<TString>;
  limits: TOptional<
    TObject<{ maxSteps: TOptional<TInteger>; maxInputTokens: TOptional<TInteger> }>
  >;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    agent: Type.String({ minLength: 1, maxLength: 64 }),
    task: Type.String({ maxLength: 4000 }),
    caller: CallerIdSchema,
    depth: Type.Integer({ minimum: 0 }),
    entry: AgentSpawnEntrySchema,
    toolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    background: Type.Boolean(),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    limits: Type.Optional(
      Type.Object(
        {
          maxSteps: Type.Optional(Type.Integer({ minimum: 0 })),
          maxInputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type AgentSpawnBeforePayload = Static<typeof AgentSpawnBeforePayloadSchema>;

/**
 * 서브에이전트 앞 결정. `block`과 `ask`는 도구 실행 앞과 같다. `replace`는 자식을 만들지 않고 보고만 돌려준다.
 * 합치기는 `block` > `replace` > `ask`다(H-2).
 */
export const AgentSpawnBeforeDecisionSchema: TUnion<
  [
    TObject<{ block: TLiteral<true>; reason: TString }>,
    TObject<{ ask: TLiteral<true>; reason: TString }>,
    TObject<{ replace: TObject<{ report: TString }>; reason: TString }>,
  ]
> = Type.Union([
  Type.Object(
    { block: Type.Literal(true), reason: Type.String({ maxLength: 500 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { ask: Type.Literal(true), reason: Type.String({ maxLength: 500 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      replace: Type.Object(
        { report: Type.String({ maxLength: AGENT_REPORT_TEXT_MAX }) },
        { additionalProperties: false },
      ),
      reason: Type.String({ maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
]);
export type AgentSpawnBeforeDecision = Static<typeof AgentSpawnBeforeDecisionSchema>;

export const AgentSpawnAfterPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  requestId: TString;
  agent: TString;
  status: TUnion<[TLiteral<"completed">, TLiteral<"aborted">, TLiteral<"error">]>;
  usage: TUnion<[typeof UsageSchema, TNull]>;
  childThreadId: typeof ThreadIdSchema;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
    agent: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.Union([Type.Literal("completed"), Type.Literal("aborted"), Type.Literal("error")]),
    usage: Type.Union([UsageSchema, Type.Null()]),
    childThreadId: ThreadIdSchema,
  },
  { additionalProperties: false },
);
export type AgentSpawnAfterPayload = Static<typeof AgentSpawnAfterPayloadSchema>;

/** 정착한 보고의 값. 결과 검사(`result-guard`)를 거친 본문과 잘렸는지 여부다 */
export const AgentSpawnAfterValueSchema: TObject<{
  report: TObject<{ text: TString; truncated: TBoolean }>;
}> = Type.Object(
  {
    report: Type.Object(
      { text: Type.String({ maxLength: AGENT_REPORT_TEXT_MAX }), truncated: Type.Boolean() },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type AgentSpawnAfterValue = Static<typeof AgentSpawnAfterValueSchema>;

/** 보고 본문만 고친다. `status`와 `usage`는 고칠 수 없다 */
export const AgentSpawnAfterPatchSchema: TObject<{ reportText: TOptional<TString> }> = Type.Object(
  { reportText: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
export type AgentSpawnAfterPatch = Static<typeof AgentSpawnAfterPatchSchema>;
