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
} from "typebox";
import {
  EventIdSchema,
  JsonValueSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
} from "../../conversation/index.ts";
import { ApprovalResolvedBySchema, QuestionAnswerSchema } from "../../records/index.ts";

// 사람에게 묻기 블록의 앞뒤 훅(M5e 스펙 §4.3.1, §4.3.2). 승인 서비스의 `open`과 `resolve`가 발화한다.
// 허용 방향 제한(H-1)은 스키마로 다 표현하지 못한다. `tool`·`review` 종류에서 `answer`를 내지 않는 검사는 발화하는 쪽이 한다.

/** 묻는 대상의 종류. 승인 카드 종류(`ApprovalKind`)에서 은퇴한 `plan`을 뺀 셋이다 */
export const AskKindSchema: TUnion<[TLiteral<"tool">, TLiteral<"question">, TLiteral<"review">]> =
  Type.Union([Type.Literal("tool"), Type.Literal("question"), Type.Literal("review")]);
export type AskKind = Static<typeof AskKindSchema>;

/**
 * 카드를 일으킨 자리. 승인 origin과 같은 뜻이다. `caller`는 `ApprovalCaller` 문자열이라
 * `background`, `host`, `ext:<이름>`도 든다
 */
export const AskOriginSchema: TObject<{
  turnId: TOptional<typeof TurnIdSchema>;
  stepId: TOptional<typeof StepIdSchema>;
  toolCallId: TOptional<TString>;
  caller: TString;
}> = Type.Object(
  {
    turnId: Type.Optional(TurnIdSchema),
    stepId: Type.Optional(StepIdSchema),
    toolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    caller: Type.String({ minLength: 1, maxLength: 96 }),
  },
  { additionalProperties: false },
);
export type AskOrigin = Static<typeof AskOriginSchema>;

export const AskHumanBeforePayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  surfaceThreadId: typeof ThreadIdSchema;
  requestKey: TString;
  askKind: typeof AskKindSchema;
  title: TString;
  origin: typeof AskOriginSchema;
  summary: TObject<{
    toolName: TOptional<TString>;
    risk: TOptional<TString>;
    questionIds: TOptional<TArray<TString>>;
  }>;
  interactive: TBoolean;
  unattended: TUnion<[TLiteral<"silent">, TLiteral<"wait">, TLiteral<"expire">, TNull]>;
  /** 훅이 묻는 것이면 그 확장 이름 */
  askedBy: TOptional<TString>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    surfaceThreadId: ThreadIdSchema,
    requestKey: Type.String({ minLength: 1, maxLength: 48 }),
    askKind: AskKindSchema,
    title: Type.String({ minLength: 1, maxLength: 120 }),
    origin: AskOriginSchema,
    summary: Type.Object(
      {
        toolName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        risk: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
        questionIds: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 4 }),
        ),
      },
      { additionalProperties: false },
    ),
    interactive: Type.Boolean(),
    unattended: Type.Union([
      Type.Literal("silent"),
      Type.Literal("wait"),
      Type.Literal("expire"),
      Type.Null(),
    ]),
    askedBy: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);
export type AskHumanBeforePayload = Static<typeof AskHumanBeforePayloadSchema>;

/**
 * 사람에게 묻기 앞 결정. `cancel`은 카드 없이 취소로 해결한다. `answer`는 질문 종류에서만 쓴다(`askKind`가 `question`일 때).
 * 허용을 값으로 내는 것은 `tool`·`review`에서 허용되지 않는다(H-1). 값이 없으면 사람에게 묻는다.
 */
export const AskHumanBeforeDecisionSchema: TUnion<
  [
    TObject<{ cancel: TLiteral<true>; reason: TString }>,
    TObject<{ answer: typeof QuestionAnswerSchema; reason: TString }>,
  ]
> = Type.Union([
  Type.Object(
    { cancel: Type.Literal(true), reason: Type.String({ maxLength: 500 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { answer: QuestionAnswerSchema, reason: Type.String({ maxLength: 500 }) },
    { additionalProperties: false },
  ),
]);
export type AskHumanBeforeDecision = Static<typeof AskHumanBeforeDecisionSchema>;

export const AskHumanAfterPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  approvalId: typeof EventIdSchema;
  askKind: typeof AskKindSchema;
  resolution: TObject<{
    decision: TUnion<[TLiteral<"allow">, TLiteral<"deny">, TLiteral<"answer">]>;
    resolvedBy: typeof ApprovalResolvedBySchema;
    resolvedByExtension: TOptional<TString>;
    /** 질문 답 본문. 없으면 null */
    answer: typeof JsonValueSchema;
  }>;
  durationMs: TInteger;
  origin: typeof AskOriginSchema;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    /** approval.requested 이벤트 id */
    approvalId: EventIdSchema,
    askKind: AskKindSchema,
    resolution: Type.Object(
      {
        decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
        resolvedBy: ApprovalResolvedBySchema,
        resolvedByExtension: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        answer: JsonValueSchema,
      },
      { additionalProperties: false },
    ),
    durationMs: Type.Integer({ minimum: 0 }),
    origin: AskOriginSchema,
  },
  { additionalProperties: false },
);
export type AskHumanAfterPayload = Static<typeof AskHumanAfterPayloadSchema>;
