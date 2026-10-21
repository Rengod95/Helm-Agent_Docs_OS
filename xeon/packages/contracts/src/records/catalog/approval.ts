import {
  Type,
  type Static,
  type TArray,
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
import { Nullable } from "../../base/index.ts";
import {
  EventIdSchema,
  JsonObjectSchema,
  JsonValueSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  type EventId,
  type JsonObject,
  type JsonValue,
  type StepId,
  type ThreadId,
  type TurnId,
} from "../../conversation/index.ts";
import { BlobRefSchema } from "../blob.ts";

// 하위 모양의 필드 뜻은 L1.tools.spec §3.6 소관이다. records는 capabilities보다 낮은 순서가 아니라 같은 순서라
// 그 도메인 타입을 import하지 않고 JSON 수준으로 같은 모양을 적는다.

export const ApprovalOriginJsonSchema: TObject<{
  threadId: TUnsafe<ThreadId>;
  turnId: TUnion<[TUnsafe<TurnId>, TNull]>;
  stepId: TUnion<[TUnsafe<StepId>, TNull]>;
  toolCallId: TUnion<[TString, TNull]>;
  caller: TString;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    /** CallerId */
    caller: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export type ApprovalOriginJson = Static<typeof ApprovalOriginJsonSchema>;

const ToolApprovalDetail: TObject<{
  toolName: TString;
  capability: TOptional<TObject<{ id: TString; method: TString }>>;
  risk: TString;
  args: TUnion<[TUnsafe<JsonObject>, typeof BlobRefSchema]>;
  argsHash: TString;
  ruleId: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    toolName: Type.String({ minLength: 1, maxLength: 128 }),
    capability: Type.Optional(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 96 }),
          method: Type.String({ minLength: 1, maxLength: 48 }),
        },
        { additionalProperties: false },
      ),
    ),
    risk: Type.String({ minLength: 1, maxLength: 32 }),
    args: Type.Union([JsonObjectSchema, BlobRefSchema]),
    argsHash: Type.String({ minLength: 1, maxLength: 128 }),
    ruleId: Nullable(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

const PlanApprovalDetail: TObject<{
  plan: TUnion<[TString, typeof BlobRefSchema]>;
  planRef: TUnion<[TString, TNull]>;
  nextModes: TArray<TString>;
}> = Type.Object(
  {
    plan: Type.Union([Type.String({ maxLength: 65_536 }), BlobRefSchema]),
    planRef: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    nextModes: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 }),
  },
  { additionalProperties: false },
);

const QuestionOption: TObject<{
  id: TString;
  label: TString;
  description: TOptional<TString>;
}> = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
  },
  { additionalProperties: false },
);

const Question: TObject<{
  id: TString;
  text: TString;
  options: TArray<typeof QuestionOption>;
  multiSelect: TBoolean;
  allowFreeText: TBoolean;
}> = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    text: Type.String({ minLength: 1, maxLength: 2000 }),
    options: Type.Array(QuestionOption, { maxItems: 32 }),
    multiSelect: Type.Boolean(),
    allowFreeText: Type.Boolean(),
  },
  { additionalProperties: false },
);

const QuestionApprovalDetail: TObject<{ questions: TArray<typeof Question> }> = Type.Object(
  { questions: Type.Array(Question, { minItems: 1, maxItems: 4 }) },
  { additionalProperties: false },
);

const ToolBody: TObject<{ kind: TLiteral<"tool">; tool: typeof ToolApprovalDetail }> = Type.Object(
  { kind: Type.Literal("tool"), tool: ToolApprovalDetail },
  { additionalProperties: false },
);
const PlanBody: TObject<{ kind: TLiteral<"plan">; plan: typeof PlanApprovalDetail }> = Type.Object(
  { kind: Type.Literal("plan"), plan: PlanApprovalDetail },
  { additionalProperties: false },
);
const QuestionBody: TObject<{
  kind: TLiteral<"question">;
  question: typeof QuestionApprovalDetail;
}> = Type.Object(
  { kind: Type.Literal("question"), question: QuestionApprovalDetail },
  { additionalProperties: false },
);

/** body.kind는 tool, question, plan 셋뿐이다. */
export const ApprovalBodyJsonSchema: TUnion<
  [typeof ToolBody, typeof PlanBody, typeof QuestionBody]
> = Type.Union([ToolBody, PlanBody, QuestionBody]);
export type ApprovalBodyJson = Static<typeof ApprovalBodyJsonSchema>;

const RememberScope: TUnion<[TLiteral<"once">, TLiteral<"thread">, TLiteral<"always">]> =
  Type.Union([Type.Literal("once"), Type.Literal("thread"), Type.Literal("always")]);

/** approvalId는 envelope id다. payload에 두지 않는다 */
export const ApprovalRequestedPayloadSchema: TObject<{
  origin: typeof ApprovalOriginJsonSchema;
  requestKey: TString;
  title: TString;
  body: typeof ApprovalBodyJsonSchema;
  remember: TArray<typeof RememberScope>;
  surfaceThreadId: TUnsafe<ThreadId>;
  requestedAt: TInteger;
}> = Type.Object(
  {
    origin: ApprovalOriginJsonSchema,
    /** 같은 thread에서 요청 멱등 키 */
    requestKey: Type.String({ minLength: 1, maxLength: 48 }),
    title: Type.String({ minLength: 1, maxLength: 120 }),
    body: ApprovalBodyJsonSchema,
    remember: Type.Array(RememberScope, { maxItems: 3 }),
    /** 이벤트를 기록하는 대화 */
    surfaceThreadId: ThreadIdSchema,
    requestedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ApprovalRequestedPayload = Static<typeof ApprovalRequestedPayloadSchema>;

export const ApprovalResolvedPayloadSchema: TObject<{
  approvalId: TUnsafe<EventId>;
  decision: TUnion<[TLiteral<"allow">, TLiteral<"deny">, TLiteral<"answer">]>;
  answer: TUnsafe<JsonValue>;
  remember: typeof RememberScope;
  requestedRemember: TUnion<[typeof RememberScope, TNull]>;
  resolvedBy: TUnion<
    [TLiteral<"user">, TLiteral<"noninteractive">, TLiteral<"cancelled">, TLiteral<"superseded">]
  >;
}> = Type.Object(
  {
    /** approval.requested 이벤트 id */
    approvalId: EventIdSchema,
    decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
    /** 질문 응답 등. 없으면 null */
    answer: JsonValueSchema,
    remember: RememberScope,
    requestedRemember: Nullable(RememberScope),
    resolvedBy: Type.Union([
      Type.Literal("user"),
      Type.Literal("noninteractive"),
      Type.Literal("cancelled"),
      Type.Literal("superseded"),
    ]),
  },
  { additionalProperties: false },
);
export type ApprovalResolvedPayload = Static<typeof ApprovalResolvedPayloadSchema>;
