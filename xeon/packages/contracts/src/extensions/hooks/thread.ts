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
import { Nullable } from "../../base/index.ts";
import {
  EventIdSchema,
  ItemIdSchema,
  JsonValueSchema,
  ThreadIdSchema,
} from "../../conversation/index.ts";

const CompactReasonSchema: TUnion<
  [TLiteral<"manual">, TLiteral<"threshold">, TLiteral<"overflow">]
> = Type.Union([Type.Literal("manual"), Type.Literal("threshold"), Type.Literal("overflow")]);

const PathsSchema: TArray<TString> = Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
  maxItems: 1024,
});

type EventIdOrNull = TUnion<[typeof EventIdSchema, TNull]>;
const NullableEventId: EventIdOrNull = Nullable(EventIdSchema);

// ── #27 project_trust (first) ────────────────────────────────────────────

export const ProjectTrustPayloadSchema: TObject<{ cwd: TString }> = Type.Object(
  { cwd: Type.String({ maxLength: 4096 }) },
  { additionalProperties: false },
);
export type ProjectTrustPayload = Static<typeof ProjectTrustPayloadSchema>;

/** pi ProjectTrustEventResult에서 "undecided"를 뺀 것. 결정하지 않으려면 undefined를 돌려준다 */
export const ProjectTrustDecisionSchema: TObject<{
  trusted: TUnion<[TLiteral<"yes">, TLiteral<"no">]>;
  remember: TOptional<TBoolean>;
}> = Type.Object(
  {
    trusted: Type.Union([Type.Literal("yes"), Type.Literal("no")]),
    remember: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ProjectTrustDecision = Static<typeof ProjectTrustDecisionSchema>;

// ── #28 resources_discover (chain) ───────────────────────────────────────

export const ResourcesDiscoverPayloadSchema: TObject<{
  cwd: TString;
  reason: TUnion<[TLiteral<"startup">, TLiteral<"reload">]>;
}> = Type.Object(
  {
    cwd: Type.String({ maxLength: 4096 }),
    reason: Type.Union([Type.Literal("startup"), Type.Literal("reload")]),
  },
  { additionalProperties: false },
);
export type ResourcesDiscoverPayload = Static<typeof ResourcesDiscoverPayloadSchema>;

export const ResourcesValueSchema: TObject<{
  skillPaths: typeof PathsSchema;
  promptPaths: typeof PathsSchema;
  themePaths: typeof PathsSchema;
}> = Type.Object(
  { skillPaths: PathsSchema, promptPaths: PathsSchema, themePaths: PathsSchema },
  { additionalProperties: false },
);
export type ResourcesValue = Static<typeof ResourcesValueSchema>;

/** 경로를 추가한다(merge). 확장 이름 표시는 디스패처(X)가 붙인다 */
export const ResourcesPatchSchema: TObject<{
  skillPaths: TOptional<typeof PathsSchema>;
  promptPaths: TOptional<typeof PathsSchema>;
  themePaths: TOptional<typeof PathsSchema>;
}> = Type.Object(
  {
    skillPaths: Type.Optional(PathsSchema),
    promptPaths: Type.Optional(PathsSchema),
    themePaths: Type.Optional(PathsSchema),
  },
  { additionalProperties: false },
);
export type ResourcesPatch = Static<typeof ResourcesPatchSchema>;

// ── #29 mcp_servers_change (tap, detached) ───────────────────────────────

export const McpServersChangePayloadSchema: TObject<{
  servers: TArray<
    TObject<{
      id: TString;
      status: TUnion<
        [TLiteral<"connected">, TLiteral<"disconnected">, TLiteral<"error">, TLiteral<"disabled">]
      >;
    }>
  >;
  toolsAdded: TArray<TString>;
  toolsRemoved: TArray<TString>;
}> = Type.Object(
  {
    servers: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 128 }),
          /** 값 집합은 [가정]이다. L2.mcp.spec의 서버 상태 이름이 다르면 그쪽으로 고친다 */
          status: Type.Union([
            Type.Literal("connected"),
            Type.Literal("disconnected"),
            Type.Literal("error"),
            Type.Literal("disabled"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    /** 도구 기계 이름 */
    toolsAdded: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 1024 }),
    toolsRemoved: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 1024 }),
  },
  { additionalProperties: false },
);
export type McpServersChangePayload = Static<typeof McpServersChangePayloadSchema>;

// ── #30 session_start, #39 session_shutdown (tap) ────────────────────────

export const SessionStartPayloadSchema: TObject<{
  reason: TUnion<
    [TLiteral<"startup">, TLiteral<"reload">, TLiteral<"new">, TLiteral<"resume">, TLiteral<"fork">]
  >;
  threadId: typeof ThreadIdSchema;
  previousThreadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    reason: Type.Union([
      Type.Literal("startup"),
      Type.Literal("reload"),
      Type.Literal("new"),
      Type.Literal("resume"),
      Type.Literal("fork"),
    ]),
    /** 시작한 thread. pi에 없는 필드다 */
    threadId: ThreadIdSchema,
    previousThreadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SessionStartPayload = Static<typeof SessionStartPayloadSchema>;

export const SessionShutdownPayloadSchema: TObject<{
  reason: TUnion<
    [TLiteral<"quit">, TLiteral<"reload">, TLiteral<"new">, TLiteral<"resume">, TLiteral<"fork">]
  >;
  targetThreadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    reason: Type.Union([
      Type.Literal("quit"),
      Type.Literal("reload"),
      Type.Literal("new"),
      Type.Literal("resume"),
      Type.Literal("fork"),
    ]),
    targetThreadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SessionShutdownPayload = Static<typeof SessionShutdownPayloadSchema>;

// ── #31 session_info_changed (tap, detached) ─────────────────────────────

export const SessionInfoChangedPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  name: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    /** 정규화한 thread 이름. 지웠으면 null */
    name: Nullable(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type SessionInfoChangedPayload = Static<typeof SessionInfoChangedPayloadSchema>;

// ── #32~#34, #37 session_before_* (first) ────────────────────────────────

export const SessionCancelDecisionSchema: TObject<{
  cancel: TLiteral<true>;
  reason: TString;
}> = Type.Object(
  { cancel: Type.Literal(true), reason: Type.String({ maxLength: 500 }) },
  { additionalProperties: false },
);
export type SessionCancelDecision = Static<typeof SessionCancelDecisionSchema>;

export const SessionBeforeSwitchPayloadSchema: TObject<{
  reason: TUnion<[TLiteral<"new">, TLiteral<"resume">]>;
  targetThreadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    reason: Type.Union([Type.Literal("new"), Type.Literal("resume")]),
    targetThreadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SessionBeforeSwitchPayload = Static<typeof SessionBeforeSwitchPayloadSchema>;

export const SessionBeforeForkPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  itemId: typeof ItemIdSchema;
  position: TUnion<[TLiteral<"before">, TLiteral<"at">]>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    /** pi entryId. 분기 지점 item [가정] */
    itemId: ItemIdSchema,
    position: Type.Union([Type.Literal("before"), Type.Literal("at")]),
  },
  { additionalProperties: false },
);
export type SessionBeforeForkPayload = Static<typeof SessionBeforeForkPayloadSchema>;

export const SessionBeforeForkContinueSchema: TObject<{
  cancel: TLiteral<false>;
  skipConversationRestore: TOptional<TBoolean>;
}> = Type.Object(
  { cancel: Type.Literal(false), skipConversationRestore: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export const SessionBeforeForkDecisionSchema: TUnion<
  [typeof SessionCancelDecisionSchema, typeof SessionBeforeForkContinueSchema]
> = Type.Union([SessionCancelDecisionSchema, SessionBeforeForkContinueSchema]);
export type SessionBeforeForkDecision = Static<typeof SessionBeforeForkDecisionSchema>;

export const SessionBeforeCompactPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  reason: typeof CompactReasonSchema;
  willRetry: TBoolean;
  preparation: TObject<{
    firstKeptEventId: typeof EventIdSchema;
    tokensBefore: TInteger;
    isSplitTurn: TBoolean;
    previousSummary: TUnion<[TString, TNull]>;
    messagesToSummarize: TInteger;
  }>;
  instructions: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    reason: CompactReasonSchema,
    /** 중단된 turn을 컴팩션 뒤 다시 시도하면 참(overflow 복구) */
    willRetry: Type.Boolean(),
    preparation: Type.Object(
      {
        firstKeptEventId: EventIdSchema,
        tokensBefore: Type.Integer({ minimum: 0 }),
        isSplitTurn: Type.Boolean(),
        previousSummary: Nullable(Type.String({ maxLength: 1_000_000 })),
        /** 개수만. 본문은 핸들러가 xeon.session으로 읽는다 */
        messagesToSummarize: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    instructions: Nullable(Type.String({ maxLength: 20_000 })),
  },
  { additionalProperties: false },
);
export type SessionBeforeCompactPayload = Static<typeof SessionBeforeCompactPayloadSchema>;

export const SessionCompactResultSchema: TObject<{
  cancel: TLiteral<false>;
  compaction: TObject<{
    summary: TString;
    firstKeptEventId: typeof EventIdSchema;
    details: TUnion<[typeof JsonValueSchema, TNull]>;
  }>;
}> = Type.Object(
  {
    cancel: Type.Literal(false),
    compaction: Type.Object(
      {
        summary: Type.String({ maxLength: 1_000_000 }),
        firstKeptEventId: EventIdSchema,
        details: Nullable(JsonValueSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const SessionBeforeCompactDecisionSchema: TUnion<
  [typeof SessionCancelDecisionSchema, typeof SessionCompactResultSchema]
> = Type.Union([SessionCancelDecisionSchema, SessionCompactResultSchema]);
export type SessionBeforeCompactDecision = Static<typeof SessionBeforeCompactDecisionSchema>;

export const SessionBeforeTreePayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  targetEventId: typeof EventIdSchema;
  oldLeafEventId: EventIdOrNull;
  commonAncestorEventId: EventIdOrNull;
  entriesToSummarize: TInteger;
  userWantsSummary: TBoolean;
  customInstructions: TOptional<TString>;
  replaceInstructions: TOptional<TBoolean>;
  label: TOptional<TString>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    targetEventId: EventIdSchema,
    oldLeafEventId: NullableEventId,
    commonAncestorEventId: NullableEventId,
    /** 개수만. 본문은 핸들러가 xeon.session으로 읽는다 */
    entriesToSummarize: Type.Integer({ minimum: 0 }),
    userWantsSummary: Type.Boolean(),
    customInstructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    /** 참이면 customInstructions가 기본 프롬프트를 대체한다 */
    replaceInstructions: Type.Optional(Type.Boolean()),
    label: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type SessionBeforeTreePayload = Static<typeof SessionBeforeTreePayloadSchema>;

export const SessionBeforeTreeContinueSchema: TObject<{
  cancel: TLiteral<false>;
  summary: TOptional<
    TObject<{ summary: TString; details: TUnion<[typeof JsonValueSchema, TNull]> }>
  >;
  customInstructions: TOptional<TString>;
  replaceInstructions: TOptional<TBoolean>;
  label: TOptional<TString>;
}> = Type.Object(
  {
    cancel: Type.Literal(false),
    summary: Type.Optional(
      Type.Object(
        { summary: Type.String({ maxLength: 1_000_000 }), details: Nullable(JsonValueSchema) },
        { additionalProperties: false },
      ),
    ),
    customInstructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    replaceInstructions: Type.Optional(Type.Boolean()),
    label: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export const SessionBeforeTreeDecisionSchema: TUnion<
  [typeof SessionCancelDecisionSchema, typeof SessionBeforeTreeContinueSchema]
> = Type.Union([SessionCancelDecisionSchema, SessionBeforeTreeContinueSchema]);
export type SessionBeforeTreeDecision = Static<typeof SessionBeforeTreeDecisionSchema>;

// ── #35 session_compact, #36 session_compact_failed, #38 session_tree (tap) ─

export const SessionCompactPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  eventId: typeof EventIdSchema;
  reason: typeof CompactReasonSchema;
  willRetry: TBoolean;
  fromExtension: TUnion<[TString, TNull]>;
  tokensBefore: TInteger;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    /** thread.compacted 이벤트 */
    eventId: EventIdSchema,
    reason: CompactReasonSchema,
    willRetry: Type.Boolean(),
    /** 확장이 컴팩션 내용을 냈으면 그 확장 이름 */
    fromExtension: Nullable(Type.String({ maxLength: 32 })),
    tokensBefore: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type SessionCompactPayload = Static<typeof SessionCompactPayloadSchema>;

export const SessionCompactFailedPayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  reason: typeof CompactReasonSchema;
  errorMessage: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    reason: CompactReasonSchema,
    /** 중단이면 null */
    errorMessage: Nullable(Type.String({ maxLength: 8192 })),
  },
  { additionalProperties: false },
);
export type SessionCompactFailedPayload = Static<typeof SessionCompactFailedPayloadSchema>;

export const SessionTreePayloadSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  newLeafEventId: EventIdOrNull;
  oldLeafEventId: EventIdOrNull;
  summaryEventId: TOptional<typeof EventIdSchema>;
  fromExtension: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    newLeafEventId: NullableEventId,
    oldLeafEventId: NullableEventId,
    summaryEventId: Type.Optional(EventIdSchema),
    fromExtension: Nullable(Type.String({ maxLength: 32 })),
  },
  { additionalProperties: false },
);
export type SessionTreePayload = Static<typeof SessionTreePayloadSchema>;

// ── #40 ui_prompt_start, #41 ui_prompt_end (tap, detached) ────────────────

export const UIPromptPayloadSchema: TObject<{
  reason: TLiteral<"ui_prompt">;
  kind: TUnion<
    [
      TLiteral<"select">,
      TLiteral<"confirm">,
      TLiteral<"input">,
      TLiteral<"editor">,
      TLiteral<"custom">,
    ]
  >;
  title: TOptional<TString>;
}> = Type.Object(
  {
    reason: Type.Literal("ui_prompt"),
    kind: Type.Union([
      Type.Literal("select"),
      Type.Literal("confirm"),
      Type.Literal("input"),
      Type.Literal("editor"),
      Type.Literal("custom"),
    ]),
    title: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type UIPromptPayload = Static<typeof UIPromptPayloadSchema>;
