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
  type TSchema,
  type TString,
  type TUnion,
  type TUnknown,
  type TUnsafe,
} from "typebox";
import { Nullable, type SchemaSound } from "../../base/index.ts";
import {
  CommandInfoSchema,
  CommandRunOutput,
  SecretApprovalSchema,
  SecretMetaSchema,
  SecretNameSchema,
  SecretUsePolicySchema,
  SecretScopeSchema,
  SemVerSchema,
  type SemVer,
} from "../../capabilities/index.ts";
import { ApprovalAnswerSchema, ApprovalRequestedPayloadSchema } from "../../records/index.ts";
import {
  EventIdSchema,
  ImageContentSchema,
  ItemIdSchema,
  ItemRecordSchema,
  TextContentSchema,
  ThreadIdSchema,
  ThreadStatusSchema,
  TurnIdSchema,
  type UserMessage,
} from "../../conversation/index.ts";
import {
  EffectiveSettingSchema,
  SettingDefWireSchema,
  SettingKeySchema,
  SettingScopeSchema,
} from "../settings/index.ts";
import {
  EventsSubscribeParamsSchema,
  EventsSubscribeResultSchema,
  EventsUnsubscribeParamsSchema,
  SeqSchema,
  StoreIdSchema,
  StreamPositionSchema,
} from "./cursor.ts";
import { WireMetaSchema } from "./jsonrpc.ts";
import { FeatureInfoSchema, FeatureNameSchema, type FeatureStatus } from "./version.ts";
import {
  CancelRequestParamsSchema,
  EmptyParamsSchema,
  EventsBatchParamsSchema,
  EventsEndedParamsSchema,
  IsoTimeSchema,
  SettingsInvalidatedParamsSchema,
  StreamChunkParamsSchema,
  type EmptyParams,
} from "./notifications.ts";

const SHORT = 256;

// ── 공통 조각 ────────────────────────────────────────────────────────────

export const TransportKindSchema: TUnion<
  [TLiteral<"in-process">, TLiteral<"stdio">, TLiteral<"socket">]
> = Type.Union([Type.Literal("in-process"), Type.Literal("stdio"), Type.Literal("socket")]);
export type TransportKind = Static<typeof TransportKindSchema>;

export const EmptyResultSchema: typeof EmptyParamsSchema = EmptyParamsSchema;
export type EmptyResult = EmptyParams;

/** 브랜드 없는 멱등 키(1~64자). F.conversation.spec §3.5의 requestId와 같은 뜻이다 */
const RequestKeySchema: TString = Type.String({ minLength: 1, maxLength: 64 });

// ── host.* ───────────────────────────────────────────────────────────────

export const HostHelloParamsSchema: TObject<{
  protocolVersion: typeof SemVerSchema;
  client: TObject<{
    name: TString;
    version: TString;
    kind: TUnion<[TLiteral<"cli">, TLiteral<"desktop">, TLiteral<"other">]>;
  }>;
  experimental: TOptional<TArray<typeof FeatureNameSchema>>;
  auth: TOptional<TObject<{ token: TString }>>;
}> = Type.Object(
  {
    protocolVersion: SemVerSchema,
    client: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        version: Type.String({ minLength: 1, maxLength: 64 }),
        kind: Type.Union([Type.Literal("cli"), Type.Literal("desktop"), Type.Literal("other")]),
      },
      { additionalProperties: false },
    ),
    experimental: Type.Optional(Type.Array(FeatureNameSchema, { maxItems: 64 })),
    /** M2: 서비스 소켓 인증 */
    auth: Type.Optional(
      Type.Object(
        { token: Type.String({ minLength: 1, maxLength: 512 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type HostHelloParams = Static<typeof HostHelloParamsSchema>;

export const HostHelloResultSchema: TObject<{
  protocolVersion: typeof SemVerSchema;
  server: TObject<{ name: TString; version: TString }>;
  storeId: typeof StoreIdSchema;
  transport: typeof TransportKindSchema;
  features: TArray<typeof FeatureInfoSchema>;
  experimental: TArray<typeof FeatureNameSchema>;
}> = Type.Object(
  {
    protocolVersion: SemVerSchema,
    server: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        version: Type.String({ minLength: 1, maxLength: 64 }),
      },
      { additionalProperties: false },
    ),
    storeId: StoreIdSchema,
    transport: TransportKindSchema,
    features: Type.Array(FeatureInfoSchema, { maxItems: 512 }),
    /** 연결이 opt-in해 열린 실험 기능 */
    experimental: Type.Array(FeatureNameSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type HostHelloResult = Static<typeof HostHelloResultSchema>;

export const HostStatusParamsSchema: typeof EmptyParamsSchema = EmptyParamsSchema;
export type HostStatusParams = EmptyParams;

export const HostStatusResultSchema: TObject<{
  mode: TUnion<[TLiteral<"in-process">, TLiteral<"stdio">, TLiteral<"service">]>;
  pid: TInteger;
  startedAt: typeof IsoTimeSchema;
  connections: TInteger;
  liveTurns: TInteger;
  idleShutdownAt: TUnion<[typeof IsoTimeSchema, TNull]>;
}> = Type.Object(
  {
    mode: Type.Union([Type.Literal("in-process"), Type.Literal("stdio"), Type.Literal("service")]),
    pid: Type.Integer({ minimum: 0 }),
    startedAt: IsoTimeSchema,
    connections: Type.Integer({ minimum: 0 }),
    liveTurns: Type.Integer({ minimum: 0 }),
    idleShutdownAt: Nullable(IsoTimeSchema),
  },
  { additionalProperties: false },
);
export type HostStatusResult = Static<typeof HostStatusResultSchema>;

export const HostShutdownParamsSchema: TObject<{
  reason: TUnion<[TLiteral<"client_exit">, TLiteral<"version_replace">, TLiteral<"user">]>;
  deadlineMs: TOptional<TInteger>;
}> = Type.Object(
  {
    reason: Type.Union([
      Type.Literal("client_exit"),
      Type.Literal("version_replace"),
      Type.Literal("user"),
    ]),
    deadlineMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type HostShutdownParams = Static<typeof HostShutdownParamsSchema>;

export const HostShutdownResultSchema: TObject<{ accepted: TBoolean }> = Type.Object(
  { accepted: Type.Boolean() },
  { additionalProperties: false },
);
export type HostShutdownResult = Static<typeof HostShutdownResultSchema>;

// ── thread.* ─────────────────────────────────────────────────────────────

export const ThreadListParamsSchema: TObject<{
  cursor: TOptional<TString>;
  limit: TOptional<TInteger>;
  workspace: TOptional<TString>;
}> = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: SHORT })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    workspace: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export type ThreadListParams = Static<typeof ThreadListParamsSchema>;

/** 이어서 실행할 수 있는 thread의 표식. 열린 turn이 프로세스 종료로 끊겼을 때 있다(L1.persistence.spec RecoveryMarker) */
export const ThreadResumableSchema: TObject<{
  turnId: typeof TurnIdSchema;
  runningSince: typeof IsoTimeSchema;
  resumeAttempts: TInteger;
}> = Type.Object(
  {
    turnId: TurnIdSchema,
    /** 끊긴 turn의 turn.started 시각 */
    runningSince: IsoTimeSchema,
    /** 그 turn의 thread.resumed 횟수 */
    resumeAttempts: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ThreadResumable = Static<typeof ThreadResumableSchema>;

/**
 * thread.list의 결과 원소(F.wire-settings.spec §10 미결 9). 필드는 L1.persistence의 ThreadSummaryRow를 따르고
 * 시각은 IsoTime 문자열로 바꾼다. 호스트가 행을 이 모양으로 옮긴다.
 */
export const ThreadSummarySchema: TObject<{
  threadId: typeof ThreadIdSchema;
  title: TUnion<[TString, TNull]>;
  status: typeof ThreadStatusSchema;
  workspace: TUnion<[TString, TNull]>;
  createdAt: typeof IsoTimeSchema;
  updatedAt: typeof IsoTimeSchema;
  headSeq: TInteger;
  forkedFrom: TUnion<
    [TObject<{ threadId: typeof ThreadIdSchema; eventId: typeof EventIdSchema }>, TNull]
  >;
  resumable: TUnion<[typeof ThreadResumableSchema, TNull]>;
  queuedInputs: TInteger;
  pendingApprovals: TInteger;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    title: Nullable(Type.String({ maxLength: 200 })),
    status: ThreadStatusSchema,
    /** thread.create가 받은 작업 폴더. 없으면 null */
    workspace: Nullable(Type.String({ minLength: 1, maxLength: 4096 })),
    createdAt: IsoTimeSchema,
    /** 마지막 이벤트 시각 */
    updatedAt: IsoTimeSchema,
    /** 이 thread의 마지막 seq */
    headSeq: Type.Integer({ minimum: 0 }),
    forkedFrom: Nullable(
      Type.Object(
        { threadId: ThreadIdSchema, eventId: EventIdSchema },
        { additionalProperties: false },
      ),
    ),
    /** 이어서 실행 후보 표식. 후보가 아니면 null(HS-30) */
    resumable: Nullable(ThreadResumableSchema),
    queuedInputs: Type.Integer({ minimum: 0 }),
    pendingApprovals: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ThreadSummary = Static<typeof ThreadSummarySchema>;

export const ThreadListResultSchema: TObject<{
  threads: TArray<typeof ThreadSummarySchema>;
  nextCursor: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    threads: Type.Array(ThreadSummarySchema, { maxItems: 200 }),
    nextCursor: Nullable(Type.String({ minLength: 1, maxLength: SHORT })),
  },
  { additionalProperties: false },
);
export type ThreadListResult = Static<typeof ThreadListResultSchema>;

export const ThreadCreateParamsSchema: TObject<{
  workspace: TOptional<TString>;
  title: TOptional<TString>;
}> = Type.Object(
  {
    workspace: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type ThreadCreateParams = Static<typeof ThreadCreateParamsSchema>;

export const ThreadCreateResultSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  position: typeof StreamPositionSchema;
}> = Type.Object(
  { threadId: ThreadIdSchema, position: StreamPositionSchema },
  { additionalProperties: false },
);
export type ThreadCreateResult = Static<typeof ThreadCreateResultSchema>;

export const ThreadOpenParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  mode: TUnion<[TLiteral<"write">, TLiteral<"observe">]>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    mode: Type.Union([Type.Literal("write"), Type.Literal("observe")]),
  },
  { additionalProperties: false },
);
export type ThreadOpenParams = Static<typeof ThreadOpenParamsSchema>;

export const ThreadOpenResultSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  role: TUnion<[TLiteral<"owner">, TLiteral<"observer">]>;
  position: typeof StreamPositionSchema;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    role: Type.Union([Type.Literal("owner"), Type.Literal("observer")]),
    position: StreamPositionSchema,
  },
  { additionalProperties: false },
);
export type ThreadOpenResult = Static<typeof ThreadOpenResultSchema>;

/** 한 번에 받을 item 수 상한. thread.read의 limit과 결과 items의 maxItems가 같다 */
const THREAD_READ_MAX_ITEMS = 500;

/**
 * thread.read params. 소유를 얻지 않는 읽기다(thread.open과 다르다).
 * `before`가 없으면 가장 새 item부터 `limit`개, 있으면 그 item 바로 앞부터 `limit`개를 돌려준다.
 */
export const ThreadReadParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  limit: TOptional<TInteger>;
  before: TOptional<typeof ItemIdSchema>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    /** 상한이다. 호스트는 프레임 한도 때문에 더 적게 돌려줄 수 있다(그때 hasMore는 참). 기본 200 */
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: THREAD_READ_MAX_ITEMS })),
    /** 앞선 결과의 items[0].itemId. 이 item은 결과에 들어가지 않는다 */
    before: Type.Optional(ItemIdSchema),
  },
  { additionalProperties: false },
);
export type ThreadReadParams = Static<typeof ThreadReadParamsSchema>;

/**
 * thread.read result(F.wire-settings.spec §3.4.6). items는 현재 가지(branch)의 내구 ItemRecord를 오래된 것부터 담는다.
 * `position.seq`는 items와 같은 읽기 트랜잭션에서 잰 저장소 head이고, 그 seq까지의 이 thread 이벤트가 items에 반영되어 있다.
 */
export const ThreadReadResultSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  items: TArray<typeof ItemRecordSchema>;
  position: typeof StreamPositionSchema;
  hasMore: TBoolean;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    items: Type.Array(ItemRecordSchema, { maxItems: THREAD_READ_MAX_ITEMS }),
    position: StreamPositionSchema,
    /** items[0]보다 앞선 item이 더 있다 */
    hasMore: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ThreadReadResult = Static<typeof ThreadReadResultSchema>;

/** thread.close, thread.delete */
export const ThreadRefParamsSchema: TObject<{ threadId: typeof ThreadIdSchema }> = Type.Object(
  { threadId: ThreadIdSchema },
  { additionalProperties: false },
);
export type ThreadRefParams = Static<typeof ThreadRefParamsSchema>;

export const ThreadForkParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  at: TOptional<typeof ItemIdSchema>;
}> = Type.Object(
  { threadId: ThreadIdSchema, at: Type.Optional(ItemIdSchema) },
  { additionalProperties: false },
);
export type ThreadForkParams = Static<typeof ThreadForkParamsSchema>;

export const ThreadForkResultSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  position: typeof StreamPositionSchema;
}> = Type.Object(
  { threadId: ThreadIdSchema, position: StreamPositionSchema },
  { additionalProperties: false },
);
export type ThreadForkResult = Static<typeof ThreadForkResultSchema>;

export const ThreadRevertParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  to: typeof ItemIdSchema;
}> = Type.Object({ threadId: ThreadIdSchema, to: ItemIdSchema }, { additionalProperties: false });
export type ThreadRevertParams = Static<typeof ThreadRevertParamsSchema>;

export const ThreadRevertResultSchema: TObject<{ position: typeof StreamPositionSchema }> =
  Type.Object({ position: StreamPositionSchema }, { additionalProperties: false });
export type ThreadRevertResult = Static<typeof ThreadRevertResultSchema>;

// ── turn.* ───────────────────────────────────────────────────────────────

/** pi UserMessage["content"]와 같은 모양: 문자열 또는 텍스트·이미지 블록 목록 */
export type TurnStartInput = UserMessage["content"];
const turnStartInputShape = Type.Union([
  Type.String({ maxLength: 4_000_000 }),
  Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 64 }),
]);

export const TurnStartInputSchema: TUnsafe<TurnStartInput> = Type.Unsafe<TurnStartInput>(
  turnStartInputShape satisfies SchemaSound<TurnStartInput, typeof turnStartInputShape>,
);

export const TurnStartParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  input: typeof TurnStartInputSchema;
  requestId: TOptional<typeof RequestKeySchema>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    input: TurnStartInputSchema,
    /** 같은 연결 재시도의 중복 제출을 막는 멱등 키. 같은 키는 처음 발급한 turnId를 돌려준다 */
    requestId: Type.Optional(RequestKeySchema),
  },
  { additionalProperties: false },
);
export type TurnStartParams = Static<typeof TurnStartParamsSchema>;

/** turn 접수만 뜻한다. 접수된 turn을 멈추려면 turn.interrupt를 쓴다 */
export const TurnStartResultSchema: TObject<{ turnId: typeof TurnIdSchema }> = Type.Object(
  { turnId: TurnIdSchema },
  { additionalProperties: false },
);
export type TurnStartResult = Static<typeof TurnStartResultSchema>;

export const TurnInterruptParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  turnId: TOptional<typeof TurnIdSchema>;
}> = Type.Object(
  { threadId: ThreadIdSchema, turnId: Type.Optional(TurnIdSchema) },
  { additionalProperties: false },
);
export type TurnInterruptParams = Static<typeof TurnInterruptParamsSchema>;

export const TurnInterruptResultSchema: TObject<{ interrupted: TBoolean }> = Type.Object(
  { interrupted: Type.Boolean() },
  { additionalProperties: false },
);
export type TurnInterruptResult = Static<typeof TurnInterruptResultSchema>;

/**
 * turn.resume params. 끊긴 turn을 이어 실행하라는 요청이다. 대상은 `thread.list`의 `ThreadSummary.resumable.turnId` 후보이고
 * 호스트가 열린 turn을 직접 찾으므로 turnId는 받지 않는다(한 thread에 열린 turn은 하나다).
 */
export const TurnResumeParamsSchema: TObject<{ threadId: typeof ThreadIdSchema }> = Type.Object(
  { threadId: ThreadIdSchema },
  { additionalProperties: false },
);
export type TurnResumeParams = Static<typeof TurnResumeParamsSchema>;

/** 어느 단계부터 이어 실행했는가. `ResumeFrom`(`services/loop.ts`)과 같은 집합이다 */
export const TurnResumeFromSchema: TUnion<
  [
    TLiteral<"turn_start">,
    TLiteral<"request">,
    TLiteral<"tools">,
    TLiteral<"await_input">,
    TLiteral<"turn_end">,
  ]
> = Type.Union([
  Type.Literal("turn_start"),
  Type.Literal("request"),
  Type.Literal("tools"),
  Type.Literal("await_input"),
  Type.Literal("turn_end"),
]);
export type TurnResumeFrom = Static<typeof TurnResumeFromSchema>;

/**
 * turn.resume result. `ResumeResult`(`services/loop.ts`)와 같은 세 모양이다.
 * `resumed`는 이어 실행을 접수했다는 뜻이고 진행은 이벤트로 온다. `closed`는 이어 실행하지 않고 닫았다(중단 요청이 있었거나 소유자가 취소했다).
 * `nothing`은 이어 실행할 열린 turn이 없다.
 */
export const TurnResumeResultSchema: TUnion<
  [
    TObject<{
      status: TLiteral<"resumed">;
      turnId: typeof TurnIdSchema;
      from: typeof TurnResumeFromSchema;
    }>,
    TObject<{
      status: TLiteral<"closed">;
      turnId: typeof TurnIdSchema;
      reason: TUnion<[TLiteral<"abort_requested">, TLiteral<"owner_cancelled">]>;
    }>,
    TObject<{ status: TLiteral<"nothing"> }>,
  ]
> = Type.Union([
  Type.Object(
    { status: Type.Literal("resumed"), turnId: TurnIdSchema, from: TurnResumeFromSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("closed"),
      turnId: TurnIdSchema,
      reason: Type.Union([Type.Literal("abort_requested"), Type.Literal("owner_cancelled")]),
    },
    { additionalProperties: false },
  ),
  Type.Object({ status: Type.Literal("nothing") }, { additionalProperties: false }),
]);
export type TurnResumeResult = Static<typeof TurnResumeResultSchema>;

// ── approval.* (승인 요청은 내구 이벤트 approval.requested로 오고 응답만 메서드다, review.decisions-2 U-02) ──

export const ApprovalRespondParamsSchema: TObject<{
  approvalId: TString;
  decision: TUnion<[TLiteral<"allow">, TLiteral<"deny">, TLiteral<"answer">]>;
  answer: TOptional<typeof ApprovalAnswerSchema>;
  remember: TOptional<TUnion<[TLiteral<"once">, TLiteral<"thread">, TLiteral<"always">]>>;
}> = Type.Object(
  {
    /** 승인 요청 이벤트의 id(EventId) [가정] */
    approvalId: Type.String({ minLength: 1, maxLength: 64 }),
    decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
    /**
     * kind별 정본 모양(F.wire-settings.spec §3.3.1): 질문 `answer`는 QuestionAnswer(질문 id → `{ selected, text? }`),
     * 계획 `allow`는 `{ mode }`, `deny`는 `{ feedback }`. L2.dialog의 `AskAnswer`로 옮기는 일은 cap-dialog 어댑터가 한다
     */
    answer: Type.Optional(ApprovalAnswerSchema),
    remember: Type.Optional(
      Type.Union([Type.Literal("once"), Type.Literal("thread"), Type.Literal("always")]),
    ),
  },
  { additionalProperties: false },
);
export type ApprovalRespondParams = Static<typeof ApprovalRespondParamsSchema>;

export const ApprovalRespondResultSchema: TObject<{ applied: TBoolean }> = Type.Object(
  { applied: Type.Boolean() },
  { additionalProperties: false },
);
export type ApprovalRespondResult = Static<typeof ApprovalRespondResultSchema>;

/** approval.list가 돌려줄 대기 승인 수 상한(thread 하나) */
const APPROVAL_LIST_MAX = 1000;

export const ApprovalListParamsSchema: TObject<{ threadId: typeof ThreadIdSchema }> = Type.Object(
  { threadId: ThreadIdSchema },
  { additionalProperties: false },
);
export type ApprovalListParams = Static<typeof ApprovalListParamsSchema>;

/**
 * 대기 승인 하나. `request`는 approval.requested 이벤트 payload 그대로이고(`request.surfaceThreadId`가 이벤트를 기록한 thread),
 * `approvalId`는 그 이벤트의 envelope id, `seq`는 그 이벤트의 seq다.
 */
export const PendingApprovalSchema: TObject<{
  approvalId: typeof EventIdSchema;
  seq: typeof SeqSchema;
  request: typeof ApprovalRequestedPayloadSchema;
}> = Type.Object(
  { approvalId: EventIdSchema, seq: SeqSchema, request: ApprovalRequestedPayloadSchema },
  { additionalProperties: false },
);
export type PendingApproval = Static<typeof PendingApprovalSchema>;

/**
 * approval.list result(F.wire-settings.spec §3.4.6). approvals는 seq 오름차순이다.
 * `position.seq`까지의 approval.requested·approval.resolved 이벤트가 반영되어 있다.
 */
export const ApprovalListResultSchema: TObject<{
  approvals: TArray<typeof PendingApprovalSchema>;
  position: typeof StreamPositionSchema;
}> = Type.Object(
  {
    approvals: Type.Array(PendingApprovalSchema, { maxItems: APPROVAL_LIST_MAX }),
    position: StreamPositionSchema,
  },
  { additionalProperties: false },
);
export type ApprovalListResult = Static<typeof ApprovalListResultSchema>;

// ── command.* (엔진에 등록한 슬래시 명령. 클라이언트가 목록을 읽고 실행한다, G1-01) ──

/** command.list가 돌려줄 명령 수 상한 */
const COMMAND_LIST_MAX = 512;

/** `dialog.commands.list`의 입력과 같은 뜻이다(F.capabilities.spec §3.9 dialog). `prefix`는 이름 앞부분이고 `/`는 붙이지 않는다 */
export const CommandListParamsSchema: TObject<{
  prefix: TOptional<TString>;
  includeHidden: TOptional<TBoolean>;
}> = Type.Object(
  {
    prefix: Type.Optional(Type.String({ minLength: 1, maxLength: 97 })),
    includeHidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CommandListParams = Static<typeof CommandListParamsSchema>;

export const CommandListResultSchema: TObject<{ commands: TArray<typeof CommandInfoSchema> }> =
  Type.Object(
    { commands: Type.Array(CommandInfoSchema, { maxItems: COMMAND_LIST_MAX }) },
    { additionalProperties: false },
  );
export type CommandListResult = Static<typeof CommandListResultSchema>;

/**
 * command.run params. `text`는 사용자가 친 줄 그대로다(`/plan 설계`처럼 `/`로 시작). 명령은 thread 문맥에서 돈다.
 * 없는 thread는 `thread.notFound`다.
 */
export const CommandRunParamsSchema: TObject<{
  threadId: typeof ThreadIdSchema;
  text: TString;
  confirmShell: TOptional<TBoolean>;
}> = Type.Object(
  {
    threadId: ThreadIdSchema,
    text: Type.String({ minLength: 1, maxLength: 65536 }),
    /** 셸 주입 실행을 사용자가 확인했는지. `needs_confirmation`을 받은 뒤 참으로 다시 부른다 */
    confirmShell: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CommandRunParams = Static<typeof CommandRunParamsSchema>;

/**
 * command.run result는 `dialog.commands.run`의 출력(`CommandRunOutput`)과 같다.
 * `not_command`는 명령이 아닌 입력, `expanded`는 `turn.start`로 보낼 최종 텍스트, `needs_confirmation`은 셸 주입 확인 요청,
 * `done`은 동작 명령의 처리 결과다. 화면에 낼 출력은 `done.message`(사람이 읽는 텍스트)와 `done.result`(구조 값)다.
 */
export const CommandRunResultSchema: typeof CommandRunOutput = CommandRunOutput;
export type CommandRunResult = Static<typeof CommandRunResultSchema>;

// ── settings.* ───────────────────────────────────────────────────────────

export const SettingsGetParamsSchema: TObject<{
  keys: TOptional<TArray<typeof SettingKeySchema>>;
  threadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    keys: Type.Optional(Type.Array(SettingKeySchema, { maxItems: 256 })),
    threadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SettingsGetParams = Static<typeof SettingsGetParamsSchema>;

export const SettingsGetResultSchema: TObject<{ settings: TArray<typeof EffectiveSettingSchema> }> =
  Type.Object(
    { settings: Type.Array(EffectiveSettingSchema, { maxItems: 4096 }) },
    { additionalProperties: false },
  );
export type SettingsGetResult = Static<typeof SettingsGetResultSchema>;

export const SettingsSetParamsSchema: TObject<{
  key: typeof SettingKeySchema;
  value: TUnknown;
  scope: typeof SettingScopeSchema;
  threadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    key: SettingKeySchema,
    value: Type.Unknown(),
    scope: SettingScopeSchema,
    threadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SettingsSetParams = Static<typeof SettingsSetParamsSchema>;

/** 값 지우기를 settings.set의 특수 값으로 표현하면 null이 유효한 설정 값과 겹치므로 따로 둔다 */
export const SettingsResetParamsSchema: TObject<{
  key: typeof SettingKeySchema;
  scope: typeof SettingScopeSchema;
  threadId: TOptional<typeof ThreadIdSchema>;
}> = Type.Object(
  {
    key: SettingKeySchema,
    scope: SettingScopeSchema,
    threadId: Type.Optional(ThreadIdSchema),
  },
  { additionalProperties: false },
);
export type SettingsResetParams = Static<typeof SettingsResetParamsSchema>;

/** settings.set과 settings.reset의 결과 */
export const SettingsSetResultSchema: TObject<{ setting: typeof EffectiveSettingSchema }> =
  Type.Object({ setting: EffectiveSettingSchema }, { additionalProperties: false });
export type SettingsSetResult = Static<typeof SettingsSetResultSchema>;

export const SettingsListParamsSchema: TObject<{
  prefix: TOptional<TString>;
  includeDeprecated: TOptional<TBoolean>;
}> = Type.Object(
  {
    prefix: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    includeDeprecated: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type SettingsListParams = Static<typeof SettingsListParamsSchema>;

export const SettingsListResultSchema: TObject<{ defs: TArray<typeof SettingDefWireSchema> }> =
  Type.Object(
    { defs: Type.Array(SettingDefWireSchema, { maxItems: 4096 }) },
    { additionalProperties: false },
  );
export type SettingsListResult = Static<typeof SettingsListResultSchema>;

// ── secret.* (모두 값 필드가 없다. 값 입력은 호스트 쪽 L0.secrets가 wire 밖에서 받는다) ──

export const SecretListParamsSchema: TObject<{
  meta: TOptional<TBoolean>;
  usage: TOptional<TBoolean>;
}> = Type.Object(
  { meta: Type.Optional(Type.Boolean()), usage: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type SecretListParams = Static<typeof SecretListParamsSchema>;

/** 값 없는 목록 항목. 필드는 [가정]이다: L0.secrets.spec의 SecretListing에서 값이 없는 부분. M2 착수 때 정한다 */
export const SecretListEntrySchema: TObject<{
  name: typeof SecretNameSchema;
  status: TUnion<
    [
      TLiteral<"valid">,
      TLiteral<"expiring">,
      TLiteral<"expired">,
      TLiteral<"missing">,
      TLiteral<"orphaned">,
    ]
  >;
  meta: TOptional<typeof SecretMetaSchema>;
  lastUsedAt: TOptional<typeof IsoTimeSchema>;
}> = Type.Object(
  {
    name: SecretNameSchema,
    status: Type.Union([
      Type.Literal("valid"),
      Type.Literal("expiring"),
      Type.Literal("expired"),
      Type.Literal("missing"),
      Type.Literal("orphaned"),
    ]),
    meta: Type.Optional(SecretMetaSchema),
    lastUsedAt: Type.Optional(IsoTimeSchema),
  },
  { additionalProperties: false },
);
export type SecretListEntry = Static<typeof SecretListEntrySchema>;

export const SecretListResultSchema: TObject<{ secrets: TArray<typeof SecretListEntrySchema> }> =
  Type.Object(
    { secrets: Type.Array(SecretListEntrySchema, { maxItems: 4096 }) },
    { additionalProperties: false },
  );
export type SecretListResult = Static<typeof SecretListResultSchema>;

export const SecretMetaParamsSchema: TObject<{
  name: typeof SecretNameSchema;
  desc: TOptional<TString>;
  scope: TOptional<typeof SecretScopeSchema>;
  expiresAt: TOptional<TUnion<[TString, TNull]>>;
  use: TOptional<typeof SecretUsePolicySchema>;
  approval: TOptional<typeof SecretApprovalSchema>;
  ttlSeconds: TOptional<TInteger>;
  maxUses: TOptional<TInteger>;
}> = Type.Object(
  {
    name: SecretNameSchema,
    desc: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    scope: Type.Optional(SecretScopeSchema),
    expiresAt: Type.Optional(Nullable(Type.String({ format: "date", maxLength: 10 }))),
    use: Type.Optional(SecretUsePolicySchema),
    approval: Type.Optional(SecretApprovalSchema),
    ttlSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
    maxUses: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  },
  { additionalProperties: false },
);
export type SecretMetaParams = Static<typeof SecretMetaParamsSchema>;

export const SecretMetaResultSchema: TObject<{ secret: typeof SecretListEntrySchema }> =
  Type.Object({ secret: SecretListEntrySchema }, { additionalProperties: false });
export type SecretMetaResult = Static<typeof SecretMetaResultSchema>;

/** secret.remove, secret.test */
export const SecretNameParamsSchema: TObject<{ name: typeof SecretNameSchema }> = Type.Object(
  { name: SecretNameSchema },
  { additionalProperties: false },
);
export type SecretNameParams = Static<typeof SecretNameParamsSchema>;

export const SecretRemoveResultSchema: TObject<{ removed: TBoolean }> = Type.Object(
  { removed: Type.Boolean() },
  { additionalProperties: false },
);
export type SecretRemoveResult = Static<typeof SecretRemoveResultSchema>;

export const SecretTestResultSchema: TObject<{
  state: TUnion<[TLiteral<"registered">, TLiteral<"missing">]>;
}> = Type.Object(
  { state: Type.Union([Type.Literal("registered"), Type.Literal("missing")]) },
  { additionalProperties: false },
);
export type SecretTestResult = Static<typeof SecretTestResultSchema>;

export const SecretBeginEntryParamsSchema: TObject<{
  name: typeof SecretNameSchema;
  action: TUnion<[TLiteral<"add">, TLiteral<"set">, TLiteral<"rotate">]>;
}> = Type.Object(
  {
    name: SecretNameSchema,
    action: Type.Union([Type.Literal("add"), Type.Literal("set"), Type.Literal("rotate")]),
  },
  { additionalProperties: false },
);
export type SecretBeginEntryParams = Static<typeof SecretBeginEntryParamsSchema>;

export const SecretBeginEntryResultSchema: TObject<{ started: TBoolean }> = Type.Object(
  { started: Type.Boolean() },
  { additionalProperties: false },
);
export type SecretBeginEntryResult = Static<typeof SecretBeginEntryResultSchema>;

/** secret.beginReveal. 값 필드가 없다. 표시는 호스트 쪽 L0.secrets가 TTY나 OS 창에 한다(L4.cli.spec §4.7) */
export const SecretBeginRevealResultSchema: TObject<{ started: TBoolean }> = Type.Object(
  { started: Type.Boolean() },
  { additionalProperties: false },
);
export type SecretBeginRevealResult = Static<typeof SecretBeginRevealResultSchema>;

// ── trust.* (프로젝트 신뢰. 판정과 결정을 클라이언트가 부른다, X.loading-trust.spec §4.7) ──

/** 결정 범위: 이 폴더, 상위 폴더, 이 호스트 프로세스 동안만(`session`은 저장하지 않는다) */
export const TrustChoiceKindSchema: TUnion<
  [TLiteral<"folder">, TLiteral<"parent">, TLiteral<"session">]
> = Type.Union([Type.Literal("folder"), Type.Literal("parent"), Type.Literal("session")]);
export type TrustChoiceKind = Static<typeof TrustChoiceKindSchema>;

export const TrustChoiceSchema: TObject<{
  kind: typeof TrustChoiceKindSchema;
  verdict: TUnion<[TLiteral<"allow">, TLiteral<"deny">]>;
}> = Type.Object(
  {
    kind: TrustChoiceKindSchema,
    verdict: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
  },
  { additionalProperties: false },
);
export type TrustChoice = Static<typeof TrustChoiceSchema>;

/** 판정이 어디서 나왔는가. `ext-host`의 `TrustVia`와 같은 집합이다 */
export const TrustViaSchema: TUnion<
  [
    TLiteral<"override">,
    TLiteral<"notRequired">,
    TLiteral<"point">,
    TLiteral<"store">,
    TLiteral<"sessionMemory">,
    TLiteral<"default">,
    TLiteral<"prompt">,
    TLiteral<"headless">,
    TLiteral<"corruptStore">,
  ]
> = Type.Union([
  Type.Literal("override"),
  Type.Literal("notRequired"),
  Type.Literal("point"),
  Type.Literal("store"),
  Type.Literal("sessionMemory"),
  Type.Literal("default"),
  Type.Literal("prompt"),
  Type.Literal("headless"),
  Type.Literal("corruptStore"),
]);
export type TrustVia = Static<typeof TrustViaSchema>;

/** 클라이언트가 화면에 낼 선택지. `label`은 현지화 식별자다(`trust-folder`, `trust-parent`, `trust-session`, `deny-folder`, `deny-session`) */
export const TrustOptionSchema: TObject<{
  choice: typeof TrustChoiceSchema;
  label: TString;
  savedPath: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    choice: TrustChoiceSchema,
    label: Type.String({ minLength: 1, maxLength: 64 }),
    /** 저장되는 폴더. `session` 선택지는 저장하지 않아 null이다 */
    savedPath: Nullable(Type.String({ minLength: 1, maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export type TrustOption = Static<typeof TrustOptionSchema>;

export const TrustStatusSchema: TObject<{
  projectRoot: TString;
  required: TBoolean;
  verdict: TUnion<[TLiteral<"allow">, TLiteral<"deny">, TLiteral<"undecided">]>;
  via: typeof TrustViaSchema;
  resources: TArray<TString>;
  options: TArray<typeof TrustOptionSchema>;
}> = Type.Object(
  {
    /** 정규화한 폴더 경로(심볼릭 링크를 푼 값) */
    projectRoot: Type.String({ minLength: 1, maxLength: 4096 }),
    /** 신뢰가 필요한 자원(프로젝트 설정, 스킬, MCP 서버 정의)이 있는가. 없으면 판정은 allow(`notRequired`)다 */
    required: Type.Boolean(),
    /** `undecided`는 결정이 없는 상태이고 불신으로 다룬다(fail-closed) */
    verdict: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("undecided")]),
    via: TrustViaSchema,
    /** 신뢰 필요 자원(프로젝트 루트 기준 상대 경로) */
    resources: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
    options: Type.Array(TrustOptionSchema, { maxItems: 8 }),
  },
  { additionalProperties: false },
);
export type TrustStatus = Static<typeof TrustStatusSchema>;

export const TrustGetParamsSchema: TObject<{ workspace: TString }> = Type.Object(
  { workspace: Type.String({ minLength: 1, maxLength: 4096 }) },
  { additionalProperties: false },
);
export type TrustGetParams = Static<typeof TrustGetParamsSchema>;

export const TrustDecideParamsSchema: TObject<{
  workspace: TString;
  choice: typeof TrustChoiceSchema;
}> = Type.Object(
  { workspace: Type.String({ minLength: 1, maxLength: 4096 }), choice: TrustChoiceSchema },
  { additionalProperties: false },
);
export type TrustDecideParams = Static<typeof TrustDecideParamsSchema>;

// ── 모든 요청 params의 _meta (§3.6) ──────────────────────────────────────

/** params 스키마에 예약 키 `_meta?: WireMeta`를 더한 타입 */
export type WithMeta<S extends TObject> = TObject<
  S["properties"] & { _meta: TOptional<typeof WireMetaSchema> }
>;

/**
 * 레지스트리가 모든 요청 메서드의 params 스키마에 자동으로 더하는 `_meta`(F.wire-settings.spec §3.6).
 * 원래 스키마의 필드와 `additionalProperties: false`를 그대로 두고 `_meta`만 더한다. 순수 함수.
 */
export function withMeta<S extends TObject>(schema: S): WithMeta<S> {
  return Type.Object(
    { ...schema.properties, _meta: Type.Optional(WireMetaSchema) },
    { additionalProperties: false },
  );
}

/** host.status 요청 params. 키가 없는 객체에 `_meta`만 허용한다 */
const HostStatusRequestSchema: WithMeta<TObject<{}>> = withMeta(
  Type.Object({}, { additionalProperties: false }),
);
/** 같은 params를 쓰는 메서드가 한 스키마 객체를 나눠 쓰도록 한 번만 만든다 */
const ThreadRefRequestSchema: WithMeta<typeof ThreadRefParamsSchema> =
  withMeta(ThreadRefParamsSchema);
const SecretNameRequestSchema: WithMeta<typeof SecretNameParamsSchema> =
  withMeta(SecretNameParamsSchema);

// ── 레지스트리 타입 ──────────────────────────────────────────────────────

/** 메서드별 params·result 스키마. 타입 쪽(WireMethodMap)과 값 쪽(WIRE_METHODS)의 같은 원천이다 */
interface WireSchemas {
  "host.hello": {
    params: WithMeta<typeof HostHelloParamsSchema>;
    result: typeof HostHelloResultSchema;
  };
  "host.status": {
    params: typeof HostStatusRequestSchema;
    result: typeof HostStatusResultSchema;
  };
  "thread.list": {
    params: WithMeta<typeof ThreadListParamsSchema>;
    result: typeof ThreadListResultSchema;
  };
  "thread.create": {
    params: WithMeta<typeof ThreadCreateParamsSchema>;
    result: typeof ThreadCreateResultSchema;
  };
  "thread.open": {
    params: WithMeta<typeof ThreadOpenParamsSchema>;
    result: typeof ThreadOpenResultSchema;
  };
  "thread.read": {
    params: WithMeta<typeof ThreadReadParamsSchema>;
    result: typeof ThreadReadResultSchema;
  };
  "thread.close": {
    params: typeof ThreadRefRequestSchema;
    result: typeof EmptyResultSchema;
  };
  "thread.delete": {
    params: typeof ThreadRefRequestSchema;
    result: typeof EmptyResultSchema;
  };
  "thread.fork": {
    params: WithMeta<typeof ThreadForkParamsSchema>;
    result: typeof ThreadForkResultSchema;
  };
  "thread.revert": {
    params: WithMeta<typeof ThreadRevertParamsSchema>;
    result: typeof ThreadRevertResultSchema;
  };
  "turn.start": {
    params: WithMeta<typeof TurnStartParamsSchema>;
    result: typeof TurnStartResultSchema;
  };
  "turn.interrupt": {
    params: WithMeta<typeof TurnInterruptParamsSchema>;
    result: typeof TurnInterruptResultSchema;
  };
  "turn.resume": {
    params: WithMeta<typeof TurnResumeParamsSchema>;
    result: typeof TurnResumeResultSchema;
  };
  "events.subscribe": {
    params: WithMeta<typeof EventsSubscribeParamsSchema>;
    result: typeof EventsSubscribeResultSchema;
  };
  "events.unsubscribe": {
    params: WithMeta<typeof EventsUnsubscribeParamsSchema>;
    result: typeof EmptyResultSchema;
  };
  "approval.respond": {
    params: WithMeta<typeof ApprovalRespondParamsSchema>;
    result: typeof ApprovalRespondResultSchema;
  };
  "approval.list": {
    params: WithMeta<typeof ApprovalListParamsSchema>;
    result: typeof ApprovalListResultSchema;
  };
  "command.list": {
    params: WithMeta<typeof CommandListParamsSchema>;
    result: typeof CommandListResultSchema;
  };
  "command.run": {
    params: WithMeta<typeof CommandRunParamsSchema>;
    result: typeof CommandRunResultSchema;
  };
  "settings.get": {
    params: WithMeta<typeof SettingsGetParamsSchema>;
    result: typeof SettingsGetResultSchema;
  };
  "settings.set": {
    params: WithMeta<typeof SettingsSetParamsSchema>;
    result: typeof SettingsSetResultSchema;
  };
  "settings.reset": {
    params: WithMeta<typeof SettingsResetParamsSchema>;
    result: typeof SettingsSetResultSchema;
  };
  "settings.list": {
    params: WithMeta<typeof SettingsListParamsSchema>;
    result: typeof SettingsListResultSchema;
  };
  "host.shutdown": {
    params: WithMeta<typeof HostShutdownParamsSchema>;
    result: typeof HostShutdownResultSchema;
  };
  "secret.list": {
    params: WithMeta<typeof SecretListParamsSchema>;
    result: typeof SecretListResultSchema;
  };
  "secret.meta": {
    params: WithMeta<typeof SecretMetaParamsSchema>;
    result: typeof SecretMetaResultSchema;
  };
  "secret.remove": {
    params: typeof SecretNameRequestSchema;
    result: typeof SecretRemoveResultSchema;
  };
  "secret.test": {
    params: typeof SecretNameRequestSchema;
    result: typeof SecretTestResultSchema;
  };
  "secret.beginEntry": {
    params: WithMeta<typeof SecretBeginEntryParamsSchema>;
    result: typeof SecretBeginEntryResultSchema;
  };
  "secret.beginReveal": {
    params: typeof SecretNameRequestSchema;
    result: typeof SecretBeginRevealResultSchema;
  };
  "trust.get": {
    params: WithMeta<typeof TrustGetParamsSchema>;
    result: typeof TrustStatusSchema;
  };
  "trust.decide": {
    params: WithMeta<typeof TrustDecideParamsSchema>;
    result: typeof TrustStatusSchema;
  };
}

/** 메서드 이름 → { params, result } 정적 타입. 스키마에서 Static으로 만든다 */
export type WireMethodMap = {
  readonly [M in keyof WireSchemas]: {
    readonly params: Static<WireSchemas[M]["params"]>;
    readonly result: Static<WireSchemas[M]["result"]>;
  };
};
export type WireMethodName = keyof WireMethodMap;
export type WireParams<M extends WireMethodName> = WireMethodMap[M]["params"];
export type WireResult<M extends WireMethodName> = WireMethodMap[M]["result"];

/** 서버 → 클라이언트 알림별 params 스키마 */
interface ServerNotificationSchemas {
  "events.batch": typeof EventsBatchParamsSchema;
  "events.ended": typeof EventsEndedParamsSchema;
  "stream.chunk": typeof StreamChunkParamsSchema;
  "settings.invalidated": typeof SettingsInvalidatedParamsSchema;
}
export type ServerNotificationMap = {
  readonly [N in keyof ServerNotificationSchemas]: Static<ServerNotificationSchemas[N]>;
};
export type ServerNotificationName = keyof ServerNotificationMap;
export type ServerNotificationParams<N extends ServerNotificationName> = Static<
  ServerNotificationSchemas[N]
>;

/** 클라이언트 → 서버 알림별 params 스키마 */
interface ClientNotificationSchemas {
  "$/cancelRequest": typeof CancelRequestParamsSchema;
  /** M2 */
  "$/connectionReset": typeof EmptyParamsSchema;
}
export type ClientNotificationMap = {
  readonly [N in keyof ClientNotificationSchemas]: Static<ClientNotificationSchemas[N]>;
};
export type ClientNotificationName = keyof ClientNotificationMap;
export type ClientNotificationParams<N extends ClientNotificationName> = ClientNotificationMap[N];

/** 런타임 검사용 표. 키 집합은 WireMethodMap과 같아야 한다(타입 테스트로 확인) */
export interface WireMethodSpec {
  readonly params: TSchema;
  readonly result: TSchema;
  readonly since: SemVer;
  readonly status: FeatureStatus;
  /** 처음 구현하는 마일스톤 */
  readonly stage: "M1" | "M2";
}

function spec<P extends TSchema, R extends TSchema>(
  params: P,
  result: R,
  stage: "M1" | "M2",
): WireMethodSpec & { readonly params: P; readonly result: R } {
  return { params, result, since: "0.1.0", status: "active", stage };
}

export const WIRE_METHODS: {
  readonly [M in WireMethodName]: WireMethodSpec & {
    readonly params: WireSchemas[M]["params"];
    readonly result: WireSchemas[M]["result"];
  };
} = {
  "host.hello": spec(withMeta(HostHelloParamsSchema), HostHelloResultSchema, "M1"),
  "host.status": spec(HostStatusRequestSchema, HostStatusResultSchema, "M2"),
  "thread.list": spec(withMeta(ThreadListParamsSchema), ThreadListResultSchema, "M2"),
  "thread.create": spec(withMeta(ThreadCreateParamsSchema), ThreadCreateResultSchema, "M1"),
  "thread.open": spec(withMeta(ThreadOpenParamsSchema), ThreadOpenResultSchema, "M2"),
  "thread.read": spec(withMeta(ThreadReadParamsSchema), ThreadReadResultSchema, "M2"),
  "thread.close": spec(ThreadRefRequestSchema, EmptyResultSchema, "M2"),
  "thread.delete": spec(ThreadRefRequestSchema, EmptyResultSchema, "M2"),
  "thread.fork": spec(withMeta(ThreadForkParamsSchema), ThreadForkResultSchema, "M2"),
  "thread.revert": spec(withMeta(ThreadRevertParamsSchema), ThreadRevertResultSchema, "M2"),
  "turn.start": spec(withMeta(TurnStartParamsSchema), TurnStartResultSchema, "M1"),
  "turn.interrupt": spec(withMeta(TurnInterruptParamsSchema), TurnInterruptResultSchema, "M2"),
  "turn.resume": spec(withMeta(TurnResumeParamsSchema), TurnResumeResultSchema, "M2"),
  "events.subscribe": spec(
    withMeta(EventsSubscribeParamsSchema),
    EventsSubscribeResultSchema,
    "M1",
  ),
  "events.unsubscribe": spec(withMeta(EventsUnsubscribeParamsSchema), EmptyResultSchema, "M2"),
  "approval.respond": spec(
    withMeta(ApprovalRespondParamsSchema),
    ApprovalRespondResultSchema,
    "M2",
  ),
  "approval.list": spec(withMeta(ApprovalListParamsSchema), ApprovalListResultSchema, "M2"),
  "command.list": spec(withMeta(CommandListParamsSchema), CommandListResultSchema, "M2"),
  "command.run": spec(withMeta(CommandRunParamsSchema), CommandRunResultSchema, "M2"),
  "settings.get": spec(withMeta(SettingsGetParamsSchema), SettingsGetResultSchema, "M1"),
  "settings.set": spec(withMeta(SettingsSetParamsSchema), SettingsSetResultSchema, "M2"),
  "settings.reset": spec(withMeta(SettingsResetParamsSchema), SettingsSetResultSchema, "M2"),
  "settings.list": spec(withMeta(SettingsListParamsSchema), SettingsListResultSchema, "M2"),
  "host.shutdown": spec(withMeta(HostShutdownParamsSchema), HostShutdownResultSchema, "M2"),
  "secret.list": spec(withMeta(SecretListParamsSchema), SecretListResultSchema, "M2"),
  "secret.meta": spec(withMeta(SecretMetaParamsSchema), SecretMetaResultSchema, "M2"),
  "secret.remove": spec(SecretNameRequestSchema, SecretRemoveResultSchema, "M2"),
  "secret.test": spec(SecretNameRequestSchema, SecretTestResultSchema, "M2"),
  "secret.beginEntry": spec(
    withMeta(SecretBeginEntryParamsSchema),
    SecretBeginEntryResultSchema,
    "M2",
  ),
  "secret.beginReveal": spec(SecretNameRequestSchema, SecretBeginRevealResultSchema, "M2"),
  "trust.get": spec(withMeta(TrustGetParamsSchema), TrustStatusSchema, "M2"),
  "trust.decide": spec(withMeta(TrustDecideParamsSchema), TrustStatusSchema, "M2"),
};

export const WIRE_NOTIFICATIONS: {
  readonly [N in ServerNotificationName]: {
    readonly params: ServerNotificationSchemas[N];
    readonly since: SemVer;
    readonly stage: "M1" | "M2";
  };
} = {
  "events.batch": { params: EventsBatchParamsSchema, since: "0.1.0", stage: "M1" },
  "events.ended": { params: EventsEndedParamsSchema, since: "0.1.0", stage: "M1" },
  "stream.chunk": { params: StreamChunkParamsSchema, since: "0.1.0", stage: "M1" },
  "settings.invalidated": {
    params: SettingsInvalidatedParamsSchema,
    since: "0.1.0",
    stage: "M2",
  },
};

export const WIRE_CLIENT_NOTIFICATIONS: {
  readonly [N in ClientNotificationName]: {
    readonly params: ClientNotificationSchemas[N];
    readonly since: SemVer;
    readonly stage: "M1" | "M2";
  };
} = {
  "$/cancelRequest": { params: CancelRequestParamsSchema, since: "0.1.0", stage: "M1" },
  "$/connectionReset": { params: EmptyParamsSchema, since: "0.1.0", stage: "M2" },
};
