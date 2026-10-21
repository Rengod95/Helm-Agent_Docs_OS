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
import { Nullable } from "../../base/index.ts";
import {
  SecretApprovalSchema,
  SecretMetaSchema,
  SecretNameSchema,
  SecretUsePolicySchema,
  SecretScopeSchema,
  SemVerSchema,
  type SemVer,
} from "../../capabilities/index.ts";
import {
  ImageContentSchema,
  ItemIdSchema,
  TextContentSchema,
  ThreadIdSchema,
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
  StoreIdSchema,
  StreamPositionSchema,
} from "./cursor.ts";
import { FeatureInfoSchema, FeatureNameSchema, type FeatureStatus } from "./version.ts";
import {
  CancelRequestParamsSchema,
  EmptyParamsSchema,
  EventsBatchParamsSchema,
  IsoTimeSchema,
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

/** ThreadSummary의 필드는 정하지 않았다(F.wire-settings.spec §10 미결 9). M2에서 정한다 */
export const ThreadListResultSchema: TObject<{
  threads: TArray<TUnknown>;
  nextCursor: TUnion<[TString, TNull]>;
}> = Type.Object(
  {
    threads: Type.Array(Type.Unknown(), { maxItems: 200 }),
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
export const TurnStartInputSchema: TUnsafe<TurnStartInput> = Type.Unsafe<TurnStartInput>(
  Type.Union([
    Type.String({ maxLength: 4_000_000 }),
    Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 64 }),
  ]),
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

// ── approval.* (승인 요청은 내구 이벤트 approval.requested로 오고 응답만 메서드다, review.decisions-2 U-02) ──

export const ApprovalRespondParamsSchema: TObject<{
  approvalId: TString;
  decision: TUnion<[TLiteral<"allow">, TLiteral<"deny">, TLiteral<"answer">]>;
  answer: TOptional<TUnknown>;
  remember: TOptional<TUnion<[TLiteral<"once">, TLiteral<"thread">, TLiteral<"always">]>>;
}> = Type.Object(
  {
    /** 승인 요청 이벤트의 id(EventId) [가정] */
    approvalId: Type.String({ minLength: 1, maxLength: 64 }),
    decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
    answer: Type.Optional(Type.Unknown()),
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

// ── 레지스트리 타입 ──────────────────────────────────────────────────────

/** 메서드별 params·result 스키마. 타입 쪽(WireMethodMap)과 값 쪽(WIRE_METHODS)의 같은 원천이다 */
interface WireSchemas {
  "host.hello": { params: typeof HostHelloParamsSchema; result: typeof HostHelloResultSchema };
  "host.status": { params: typeof HostStatusParamsSchema; result: typeof HostStatusResultSchema };
  "thread.list": { params: typeof ThreadListParamsSchema; result: typeof ThreadListResultSchema };
  "thread.create": {
    params: typeof ThreadCreateParamsSchema;
    result: typeof ThreadCreateResultSchema;
  };
  "thread.open": { params: typeof ThreadOpenParamsSchema; result: typeof ThreadOpenResultSchema };
  "thread.close": { params: typeof ThreadRefParamsSchema; result: typeof EmptyResultSchema };
  "thread.delete": { params: typeof ThreadRefParamsSchema; result: typeof EmptyResultSchema };
  "thread.fork": { params: typeof ThreadForkParamsSchema; result: typeof ThreadForkResultSchema };
  "thread.revert": {
    params: typeof ThreadRevertParamsSchema;
    result: typeof ThreadRevertResultSchema;
  };
  "turn.start": { params: typeof TurnStartParamsSchema; result: typeof TurnStartResultSchema };
  "turn.interrupt": {
    params: typeof TurnInterruptParamsSchema;
    result: typeof TurnInterruptResultSchema;
  };
  "events.subscribe": {
    params: typeof EventsSubscribeParamsSchema;
    result: typeof EventsSubscribeResultSchema;
  };
  "events.unsubscribe": {
    params: typeof EventsUnsubscribeParamsSchema;
    result: typeof EmptyResultSchema;
  };
  "approval.respond": {
    params: typeof ApprovalRespondParamsSchema;
    result: typeof ApprovalRespondResultSchema;
  };
  "settings.get": {
    params: typeof SettingsGetParamsSchema;
    result: typeof SettingsGetResultSchema;
  };
  "settings.set": {
    params: typeof SettingsSetParamsSchema;
    result: typeof SettingsSetResultSchema;
  };
  "settings.reset": {
    params: typeof SettingsResetParamsSchema;
    result: typeof SettingsSetResultSchema;
  };
  "settings.list": {
    params: typeof SettingsListParamsSchema;
    result: typeof SettingsListResultSchema;
  };
  "host.shutdown": {
    params: typeof HostShutdownParamsSchema;
    result: typeof HostShutdownResultSchema;
  };
  "secret.list": { params: typeof SecretListParamsSchema; result: typeof SecretListResultSchema };
  "secret.meta": { params: typeof SecretMetaParamsSchema; result: typeof SecretMetaResultSchema };
  "secret.remove": {
    params: typeof SecretNameParamsSchema;
    result: typeof SecretRemoveResultSchema;
  };
  "secret.test": { params: typeof SecretNameParamsSchema; result: typeof SecretTestResultSchema };
  "secret.beginEntry": {
    params: typeof SecretBeginEntryParamsSchema;
    result: typeof SecretBeginEntryResultSchema;
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
  "stream.chunk": typeof StreamChunkParamsSchema;
}
export type ServerNotificationMap = {
  readonly [N in keyof ServerNotificationSchemas]: Static<ServerNotificationSchemas[N]>;
};
export type ServerNotificationName = keyof ServerNotificationMap;
export type ServerNotificationParams<N extends ServerNotificationName> = ServerNotificationMap[N];

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
  "host.hello": spec(HostHelloParamsSchema, HostHelloResultSchema, "M1"),
  "host.status": spec(HostStatusParamsSchema, HostStatusResultSchema, "M2"),
  "thread.list": spec(ThreadListParamsSchema, ThreadListResultSchema, "M2"),
  "thread.create": spec(ThreadCreateParamsSchema, ThreadCreateResultSchema, "M1"),
  "thread.open": spec(ThreadOpenParamsSchema, ThreadOpenResultSchema, "M2"),
  "thread.close": spec(ThreadRefParamsSchema, EmptyResultSchema, "M2"),
  "thread.delete": spec(ThreadRefParamsSchema, EmptyResultSchema, "M2"),
  "thread.fork": spec(ThreadForkParamsSchema, ThreadForkResultSchema, "M2"),
  "thread.revert": spec(ThreadRevertParamsSchema, ThreadRevertResultSchema, "M2"),
  "turn.start": spec(TurnStartParamsSchema, TurnStartResultSchema, "M1"),
  "turn.interrupt": spec(TurnInterruptParamsSchema, TurnInterruptResultSchema, "M2"),
  "events.subscribe": spec(EventsSubscribeParamsSchema, EventsSubscribeResultSchema, "M1"),
  "events.unsubscribe": spec(EventsUnsubscribeParamsSchema, EmptyResultSchema, "M2"),
  "approval.respond": spec(ApprovalRespondParamsSchema, ApprovalRespondResultSchema, "M2"),
  "settings.get": spec(SettingsGetParamsSchema, SettingsGetResultSchema, "M1"),
  "settings.set": spec(SettingsSetParamsSchema, SettingsSetResultSchema, "M2"),
  "settings.reset": spec(SettingsResetParamsSchema, SettingsSetResultSchema, "M2"),
  "settings.list": spec(SettingsListParamsSchema, SettingsListResultSchema, "M2"),
  "host.shutdown": spec(HostShutdownParamsSchema, HostShutdownResultSchema, "M2"),
  "secret.list": spec(SecretListParamsSchema, SecretListResultSchema, "M2"),
  "secret.meta": spec(SecretMetaParamsSchema, SecretMetaResultSchema, "M2"),
  "secret.remove": spec(SecretNameParamsSchema, SecretRemoveResultSchema, "M2"),
  "secret.test": spec(SecretNameParamsSchema, SecretTestResultSchema, "M2"),
  "secret.beginEntry": spec(SecretBeginEntryParamsSchema, SecretBeginEntryResultSchema, "M2"),
};

export const WIRE_NOTIFICATIONS: {
  readonly [N in ServerNotificationName]: {
    readonly params: ServerNotificationSchemas[N];
    readonly since: SemVer;
    readonly stage: "M1" | "M2";
  };
} = {
  "events.batch": { params: EventsBatchParamsSchema, since: "0.1.0", stage: "M1" },
  "stream.chunk": { params: StreamChunkParamsSchema, since: "0.1.0", stage: "M1" },
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
