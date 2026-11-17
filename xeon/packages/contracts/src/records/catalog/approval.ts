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
  type TRecord,
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

/**
 * `origin.caller`가 따라야 하는 형식. 값을 만드는 함수는 `approvalCallerOf`(`services/approvals.ts`)이고 타입은 `ApprovalCaller`다.
 * records는 services보다 낮아 그 타입을 import하지 못하므로 형식만 여기에 두고 services가 이 상수를 쓴다.
 */
export const APPROVAL_CALLER_PATTERN: string =
  "^(main|background|host|subagent:.+|ext:.+|plugin:[a-z][a-z0-9-]{1,31})$";

export const ApprovalOriginJsonSchema: TObject<{
  threadId: TUnsafe<ThreadId>;
  turnId: TUnion<[TUnsafe<TurnId>, TNull]>;
  stepId: TUnion<[TUnsafe<StepId>, TNull]>;
  toolCallId: TUnion<[TString, TNull]>;
  caller: TString;
  source: TOptional<TObject<{ scopeId: TString; label: TUnion<[TString, TNull]> }>>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    turnId: Nullable(TurnIdSchema),
    stepId: Nullable(StepIdSchema),
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    /** `ApprovalCaller`(`approvalCallerOf`가 만든다): main, background, host, subagent:<이름>, ext:<이름>, 플러그인 기능 호출은 plugin:<이름> */
    caller: Type.String({ minLength: 1, maxLength: 128, pattern: APPROVAL_CALLER_PATTERN }),
    /** 하위 대화를 띄운 그룹의 출처(`RunSource`). 선택이라 옛 기록에는 없다 */
    source: Type.Optional(
      Type.Object(
        {
          scopeId: Type.String({ minLength: 1, maxLength: 96 }),
          label: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ApprovalOriginJson = Static<typeof ApprovalOriginJsonSchema>;

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
const REVIEW_ID_PATTERN = `^rvw_${ULID}$`;
const ARTIFACT_ID_PATTERN = `^art_${ULID}$`;
const HUNK_ID_PATTERN = "^f[0-9]{1,4}h[0-9]{1,4}$";

/** MCP 서버가 도구 annotations로 알린 성질(값이 있는 것만). 서버의 자기 선언이라 신뢰하지 않는다: 화면 표시에만 쓴다 */
const McpDeclaredHintsSchema: TObject<{
  readOnlyHint: TOptional<TBoolean>;
  destructiveHint: TOptional<TBoolean>;
  idempotentHint: TOptional<TBoolean>;
  openWorldHint: TOptional<TBoolean>;
}> = Type.Object(
  {
    readOnlyHint: Type.Optional(Type.Boolean()),
    destructiveHint: Type.Optional(Type.Boolean()),
    idempotentHint: Type.Optional(Type.Boolean()),
    openWorldHint: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const ToolApprovalDetail: TObject<{
  toolName: TString;
  capability: TOptional<TObject<{ id: TString; method: TString }>>;
  risk: TString;
  args: TUnion<[TUnsafe<JsonObject>, typeof BlobRefSchema]>;
  argsHash: TString;
  ruleId: TUnion<[TString, TNull]>;
  mcp: TOptional<TObject<{ server: TString; declared: TOptional<typeof McpDeclaredHintsSchema> }>>;
  askedBy: TOptional<TObject<{ extension: TString; reason: TString }>>;
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
    /** MCP 서버 도구면 서버 이름과 서버가 알린 성질. 옛 기록에는 없다 */
    mcp: Type.Optional(
      Type.Object(
        {
          server: Type.String({ minLength: 1, maxLength: 128 }),
          declared: Type.Optional(McpDeclaredHintsSchema),
        },
        { additionalProperties: false },
      ),
    ),
    /** 훅이 이 카드를 물었으면 그 확장 이름과 사유(`hook:<확장 이름>` 규칙 옆에 실린다). 훅이 묻지 않았으면 없다 [제안: 4.2] */
    askedBy: Type.Optional(
      Type.Object(
        {
          extension: Type.String({ minLength: 1, maxLength: 64 }),
          reason: Type.String({ minLength: 1, maxLength: 500 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const QuestionOption: TObject<{
  id: TString;
  label: TString;
  description: TOptional<TString>;
  recommended: TOptional<TBoolean>;
}> = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })),
    /** 추천 표시. 화면이 강조만 한다 */
    recommended: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const Question: TObject<{
  id: TString;
  header: TOptional<TString>;
  text: TString;
  options: TArray<typeof QuestionOption>;
  multiSelect: TBoolean;
  allowFreeText: TBoolean;
}> = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    /** 질문 위에 얹는 짧은 머리글 */
    header: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    text: Type.String({ minLength: 1, maxLength: 2000 }),
    options: Type.Array(QuestionOption, { maxItems: 32 }),
    multiSelect: Type.Boolean(),
    allowFreeText: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const QuestionApprovalDetailSchema: TObject<{ questions: TArray<typeof Question> }> =
  Type.Object(
    { questions: Type.Array(Question, { minItems: 1, maxItems: 4 }) },
    { additionalProperties: false },
  );
export type QuestionApprovalDetail = Static<typeof QuestionApprovalDetailSchema>;

/** 검토 승인 본문의 파일 요약. 필드 뜻은 L2.artifacts.spec §3.3 `ReviewFileView`의 부분 집합이다 */
const ReviewFileSummary: TObject<{
  path: TString;
  change: TUnion<
    [TLiteral<"added">, TLiteral<"modified">, TLiteral<"deleted">, TLiteral<"renamed">]
  >;
  binary: TBoolean;
  hunks: TInteger;
}> = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    change: Type.Union([
      Type.Literal("added"),
      Type.Literal("modified"),
      Type.Literal("deleted"),
      Type.Literal("renamed"),
    ]),
    /** 이진 파일은 hunk가 없고 파일 단위로 결정한다 */
    binary: Type.Boolean(),
    /** 파일의 hunk 수 */
    hunks: Type.Integer({ minimum: 0, maximum: 4096 }),
  },
  { additionalProperties: false },
);

/**
 * 검토 승인(kind `review`)의 본문 [제안: ADR-0018 §6 미결의 답. L2.artifacts.spec §4.2.4 `subject { reviewId, artifactId, files }`의 최소 집합].
 * hunk 본문은 싣지 않는다. 클라이언트는 `artifacts.reviews.get`으로 diff를 읽고 이 요약으로 카드를 그린다.
 */
const ReviewApprovalDetail: TObject<{
  reviewId: TString;
  artifactId: TString;
  title: TString;
  round: TInteger;
  files: TArray<typeof ReviewFileSummary>;
  writes: TOptional<TArray<TString>>;
}> = Type.Object(
  {
    reviewId: Type.String({ pattern: REVIEW_ID_PATTERN }),
    /** 변경 묶음을 담은 changeset 산출물 */
    artifactId: Type.String({ pattern: ARTIFACT_ID_PATTERN }),
    title: Type.String({ maxLength: 200 }),
    /** 이 요청이 묻는 라운드. 열 때 1 */
    round: Type.Integer({ minimum: 1 }),
    files: Type.Array(ReviewFileSummary, { maxItems: 256 }),
    /**
     * 사용자가 hunk를 거절하면 검토가 작업 공간에 하는 되돌림 쓰기의 해시 목록 [제안: U-11].
     * 해시는 쓰기 호출 입력(`{ path, edits }`)의 정규 JSON sha256 hex다. 이 카드에 사람이 답하면 엔진이 이 목록에 든 쓰기에만 새 승인 카드를 건너뛴다
     */
    writes: Type.Optional(
      Type.Array(Type.String({ pattern: "^[0-9a-f]{64}$" }), { maxItems: 4096 }),
    ),
  },
  { additionalProperties: false },
);

const ToolBody: TObject<{ kind: TLiteral<"tool">; tool: typeof ToolApprovalDetail }> = Type.Object(
  { kind: Type.Literal("tool"), tool: ToolApprovalDetail },
  { additionalProperties: false },
);
// 계획 승인(plan)은 더는 쓰지 않음 [결정: 2026-11-13 사용자]. 옛 요청을 디코드하려고 kind만 본다.
// 나머지 필드(plan, planRef, nextModes)는 옛 기록에 있던 그대로 두고 값을 검사하지 않는다 [결정: 2026-11-15 사용자]
const LegacyPlanBody: TObject<{ kind: TLiteral<"plan"> }> = Type.Object(
  { kind: Type.Literal("plan") },
  { additionalProperties: true },
);
const QuestionBody: TObject<{
  kind: TLiteral<"question">;
  question: typeof QuestionApprovalDetailSchema;
}> = Type.Object(
  { kind: Type.Literal("question"), question: QuestionApprovalDetailSchema },
  { additionalProperties: false },
);

const ReviewBody: TObject<{
  kind: TLiteral<"review">;
  review: typeof ReviewApprovalDetail;
}> = Type.Object(
  { kind: Type.Literal("review"), review: ReviewApprovalDetail },
  { additionalProperties: false },
);

/** body.kind는 tool, question, review와 옛 기록의 plan(LegacyPlanBody)이다. ADR-0018 §3 2의 넷에서 plan은 은퇴했다. */
export const ApprovalBodyJsonSchema: TUnion<
  [typeof ToolBody, typeof LegacyPlanBody, typeof QuestionBody, typeof ReviewBody]
> = Type.Union([ToolBody, LegacyPlanBody, QuestionBody, ReviewBody]);
export type ApprovalBodyJson = Static<typeof ApprovalBodyJsonSchema>;

const RememberScope: TUnion<[TLiteral<"once">, TLiteral<"thread">, TLiteral<"always">]> =
  Type.Union([Type.Literal("once"), Type.Literal("thread"), Type.Literal("always")]);

/** approvalId는 envelope id다. payload에 두지 않는다 */
/** 만료 때의 해결(`ApprovalOnExpire`). `answer`의 모양은 요청 kind가 정한다 */
export const ApprovalOnExpireJsonSchema: TUnion<
  [
    TObject<{ decision: TLiteral<"deny"> }>,
    TObject<{ decision: TLiteral<"answer">; answer: TUnsafe<JsonValue> }>,
  ]
> = Type.Union([
  Type.Object({ decision: Type.Literal("deny") }, { additionalProperties: false }),
  Type.Object(
    { decision: Type.Literal("answer"), answer: JsonValueSchema },
    { additionalProperties: false },
  ),
]);
export type ApprovalOnExpireJson = Static<typeof ApprovalOnExpireJsonSchema>;

export const ApprovalRequestedPayloadSchema: TObject<{
  origin: typeof ApprovalOriginJsonSchema;
  requestKey: TString;
  title: TString;
  body: typeof ApprovalBodyJsonSchema;
  remember: TArray<typeof RememberScope>;
  surfaceThreadId: TUnsafe<ThreadId>;
  requestedAt: TInteger;
  expiresAt: TOptional<TInteger>;
  onExpire: TOptional<typeof ApprovalOnExpireJsonSchema>;
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
    /** 만료 시각(epoch ms). 없으면 만료가 없다. 이 필드가 생기기 전에 기록된 요청에는 없다 [결정: m2c G1-11] */
    expiresAt: Type.Optional(Type.Integer({ minimum: 0 })),
    /** 만료 때의 해결. 생략하면 거부 */
    onExpire: Type.Optional(ApprovalOnExpireJsonSchema),
  },
  { additionalProperties: false },
);
export type ApprovalRequestedPayload = Static<typeof ApprovalRequestedPayloadSchema>;

/** 해결한 주체(`ApprovalResolvedBy`). 기록과 훅 payload(`ask.human.after`)가 같은 목록을 쓴다 */
export const ApprovalResolvedBySchema: TUnion<
  [
    TLiteral<"user">,
    TLiteral<"noninteractive">,
    TLiteral<"cancelled">,
    TLiteral<"superseded">,
    TLiteral<"expired">,
    TLiteral<"extension">,
  ]
> = Type.Union([
  Type.Literal("user"),
  Type.Literal("noninteractive"),
  Type.Literal("cancelled"),
  Type.Literal("superseded"),
  Type.Literal("expired"),
  Type.Literal("extension"),
]);

export const ApprovalResolvedPayloadSchema: TObject<{
  approvalId: TUnsafe<EventId>;
  decision: TUnion<[TLiteral<"allow">, TLiteral<"deny">, TLiteral<"answer">]>;
  answer: TUnsafe<JsonValue>;
  remember: typeof RememberScope;
  requestedRemember: TUnion<[typeof RememberScope, TNull]>;
  resolvedBy: typeof ApprovalResolvedBySchema;
  resolvedByExtension: TOptional<TString>;
  deviceId: TOptional<TString>;
}> = Type.Object(
  {
    /** approval.requested 이벤트 id */
    approvalId: EventIdSchema,
    decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
    /** 질문 응답 등. 없으면 null */
    answer: JsonValueSchema,
    remember: RememberScope,
    requestedRemember: Nullable(RememberScope),
    resolvedBy: ApprovalResolvedBySchema,
    /** `resolvedBy`가 `extension`이면 해결한 확장 이름. 다른 값에는 없다 [제안: 4.2] */
    resolvedByExtension: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    /** 다른 기기에서 답했으면 그 기기 id(게이트웨이가 hello에 실은 값). 이 컴퓨터에서 답했으면 없다 [결정: 2026-11-12 사용자] */
    deviceId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);
export type ApprovalResolvedPayload = Static<typeof ApprovalResolvedPayloadSchema>;

// ── approval.respond의 answer 정본 모양 (L1.tools.spec §3.6, F.wire-settings.spec §3.3.1) ─────────────────
// kind와 decision이 모양을 정한다: question + answer → QuestionAnswer, review + answer → ReviewAnswer, deny → DenyAnswer.
// 옛 계획 승인의 allow 답은 `approval.resolved.answer`에 남는다. 그 칸은 JsonValueSchema라 어떤 JSON이든 읽힌다.
// 어느 조합이 맞는지는 승인 서비스가 요청 body와 대조해 판단하고, 여기서는 JSON 모양만 검사한다.

/** 질문 하나의 답. 선택지 id 목록과 자유 입력 */
export const QuestionAnswerItemSchema: TObject<{
  selected: TArray<TString>;
  text: TOptional<TString>;
}> = Type.Object(
  {
    selected: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    text: Type.Optional(Type.String({ maxLength: 8192 })),
  },
  { additionalProperties: false },
);

/** 질문 id → 답. 질문은 최대 4개다 */
export const QuestionAnswerSchema: TRecord<"^.*$", typeof QuestionAnswerItemSchema> = Type.Record(
  Type.String(),
  QuestionAnswerItemSchema,
  { maxProperties: 4 },
);
export type QuestionAnswerJson = Static<typeof QuestionAnswerSchema>;

/** `deny`의 answer. 모델에 돌려줄 거부 이유 */
export const DenyAnswerSchema: TObject<{ feedback: TString }> = Type.Object(
  { feedback: Type.String({ minLength: 1, maxLength: 8192 }) },
  { additionalProperties: false },
);
export type DenyAnswerJson = Static<typeof DenyAnswerSchema>;

const HunkDecision: TUnion<[TLiteral<"pending">, TLiteral<"approved">, TLiteral<"rejected">]> =
  Type.Union([Type.Literal("pending"), Type.Literal("approved"), Type.Literal("rejected")]);

/** 코멘트 대상(`L2.artifacts.spec` §3.3 `CommentTarget`) */
const ReviewCommentTarget: TUnion<
  [
    TObject<{
      type: TLiteral<"hunk">;
      hunkId: TString;
      line: TOptional<
        TObject<{ side: TUnion<[TLiteral<"old">, TLiteral<"new">]>; number: TInteger }>
      >;
    }>,
    TObject<{ type: TLiteral<"file">; path: TString }>,
    TObject<{ type: TLiteral<"review"> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      type: Type.Literal("hunk"),
      hunkId: Type.String({ pattern: HUNK_ID_PATTERN }),
      line: Type.Optional(
        Type.Object(
          {
            side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
            number: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("file"), path: Type.String({ minLength: 1, maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("review") }, { additionalProperties: false }),
]);

/** 검토 승인(kind `review`) decision `answer`의 answer [제안]. 모양은 `L2.artifacts.spec` §4.2.4 `ReviewAnswer`와 같다 */
export const ReviewAnswerSchema: TObject<{
  decisions: TArray<TObject<{ hunkId: TString; decision: typeof HunkDecision }>>;
  comments: TArray<TObject<{ target: typeof ReviewCommentTarget; body: TString }>>;
  submit: TBoolean;
  approveRemaining: TOptional<TBoolean>;
}> = Type.Object(
  {
    decisions: Type.Array(
      Type.Object(
        { hunkId: Type.String({ pattern: HUNK_ID_PATTERN }), decision: HunkDecision },
        { additionalProperties: false },
      ),
      { maxItems: 4096 },
    ),
    comments: Type.Array(
      Type.Object(
        { target: ReviewCommentTarget, body: Type.String({ minLength: 1, maxLength: 8000 }) },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    /** 참이면 결정 반영 뒤 submit까지 한다 */
    submit: Type.Boolean(),
    approveRemaining: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ReviewAnswerJson = Static<typeof ReviewAnswerSchema>;

export const ApprovalAnswerSchema: TUnion<
  [typeof DenyAnswerSchema, typeof QuestionAnswerSchema, typeof ReviewAnswerSchema]
> = Type.Union([DenyAnswerSchema, QuestionAnswerSchema, ReviewAnswerSchema]);
export type ApprovalAnswerJson = Static<typeof ApprovalAnswerSchema>;
