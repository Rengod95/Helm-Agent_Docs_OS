import {
  attemptAsync,
  err,
  parse,
  parseJson,
  type JsonParseError,
  type ParseError,
  type Result,
} from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import { FailureKindSchema, type FailureKind } from "@fresnel/contracts/services";
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
  type TSchema,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import type { ShellBridge } from "../shell/bridge.ts";

// L4.desktop.spec 3.3. 셸 호출은 모두 src/shell 어댑터를 거친다(W2). 이 파일은 ShellBridge만 안다(L4.desktop.design §15.1).
// 테스트는 DesktopIpc 가짜를 주입한다(eng.testing.guide TS-05).

const IsoTimeSchema: TString = Type.String({ format: "date-time", maxLength: 32 });

const EngineSourceSchema: TUnion<[TLiteral<"sidecar">, TLiteral<"service">]> = Type.Union([
  Type.Literal("sidecar"),
  Type.Literal("service"),
]);

const EngineExitSchema: TObject<{
  code: TUnion<[TInteger, TNull]>;
  signal: TUnion<[TInteger, TNull]>;
  at: TString;
  detail: TOptional<TUnion<[TString, TNull]>>;
}> = Type.Object(
  {
    /** 신호로 끝나면 null */
    code: Type.Union([Type.Integer(), Type.Null()]),
    /** Windows는 항상 null */
    signal: Type.Union([Type.Integer(), Type.Null()]),
    at: IsoTimeSchema,
    /** 죽은 엔진의 stderr 첫 줄(영어, 사이드카·CLI가 쓴다). 연결 실패 원인을 고르는 데 쓴다. 없으면 생략하거나 null이다 */
    detail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

const EngineStateSchema: TUnion<
  [
    TObject<{ kind: TLiteral<"starting">; source: typeof EngineSourceSchema; attempt: TInteger }>,
    TObject<{
      kind: TLiteral<"running">;
      source: typeof EngineSourceSchema;
      pid: TUnion<[TInteger, TNull]>;
    }>,
    TObject<{
      kind: TLiteral<"restarting">;
      attempt: TInteger;
      retryAt: TString;
      lastExit: typeof EngineExitSchema;
    }>,
    TObject<{ kind: TLiteral<"stopping"> }>,
    TObject<{ kind: TLiteral<"failed">; attempts: TInteger; lastExit: typeof EngineExitSchema }>,
    TObject<{ kind: TLiteral<"stopped"> }>,
  ]
> = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("starting"),
      source: EngineSourceSchema,
      attempt: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("running"),
      source: EngineSourceSchema,
      pid: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("restarting"),
      attempt: Type.Integer({ minimum: 1 }),
      retryAt: IsoTimeSchema,
      lastExit: EngineExitSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("stopping") }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal("failed"),
      attempts: Type.Integer({ minimum: 0 }),
      lastExit: EngineExitSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("stopped") }, { additionalProperties: false }),
]);
export type EngineState = Static<typeof EngineStateSchema>;

const AttachResultSchema: TObject<{ epoch: TInteger; state: typeof EngineStateSchema }> =
  Type.Object(
    { epoch: Type.Integer({ minimum: 1 }), state: EngineStateSchema },
    { additionalProperties: false },
  );
export type AttachResult = Static<typeof AttachResultSchema>;

/** 셸이 보낸 값도 WebView 입장에서는 프로세스 밖의 값이다(TY-10) */
export function parseEngineState(value: unknown): Result<EngineState, ParseError> {
  return parse(EngineStateSchema, value);
}

export function parseAttachResult(value: unknown): Result<AttachResult, ParseError> {
  return parse(AttachResultSchema, value);
}

/**
 * 데이터 복원 보고서(`fresnel db restore --json`의 stdout, platform-store `RestoreReport`와 같은 모양).
 * 이 화면이 셸이 보낸 글을 읽으므로 스키마로 검사한다(TY-10). 모르는 필드는 거절한다.
 */
const RestoreReportSchema: TObject<{
  dbPath: TString;
  backupDir: TString;
  blobsAdded: TInteger;
  missingBlobs: TArray<TString>;
  previousDir: TUnion<[TString, TNull]>;
  recovered: TUnion<[TLiteral<"rolled_back">, TLiteral<"rolled_forward">, TNull]>;
}> = Type.Object(
  {
    dbPath: Type.String({ maxLength: 4096 }),
    backupDir: Type.String({ maxLength: 4096 }),
    blobsAdded: Type.Integer({ minimum: 0 }),
    missingBlobs: Type.Array(Type.String({ maxLength: 128 })),
    previousDir: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    recovered: Type.Union([
      Type.Literal("rolled_back"),
      Type.Literal("rolled_forward"),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type RestoreReport = Static<typeof RestoreReportSchema>;

/** 셸 `db_restore`의 stdout을 읽는다. 종료 코드 0일 때만 이것으로 읽는다(app/restore.ts) */
export function parseRestoreReport(
  text: string,
): Result<RestoreReport, JsonParseError | ParseError> {
  const json = parseJson(text);
  if (!json.ok) return err(json.error);
  return parse(RestoreReportSchema, json.value);
}

/** 셸 `db_restore`가 돌려준 실행 결과. 종료 코드와 두 출력을 그대로 싣는다. 뜻은 app/restore.ts가 정한다 */
const DbRestoreReplySchema: TObject<{ exitCode: TInteger; stdout: TString; stderr: TString }> =
  Type.Object(
    {
      exitCode: Type.Integer(),
      stdout: Type.String(),
      stderr: Type.String(),
    },
    { additionalProperties: false },
  );
export type DbRestoreReply = Static<typeof DbRestoreReplySchema>;

/**
 * 백업 보고서(`fresnel db export --json`의 stdout, platform-store `ExportReport`와 같은 모양).
 * 셸이 보낸 글이므로 스키마로 검사한다(TY-10). 모르는 필드는 거절한다.
 */
const BackupReportSchema: TObject<{
  destDir: TString;
  exportedAt: TInteger;
  blobCount: TInteger;
  missingBlobs: TArray<TString>;
}> = Type.Object(
  {
    destDir: Type.String({ maxLength: 4096 }),
    exportedAt: Type.Integer({ minimum: 0 }),
    blobCount: Type.Integer({ minimum: 0 }),
    missingBlobs: Type.Array(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type BackupReport = Static<typeof BackupReportSchema>;

/** 복원 전 사본 하나(`fresnel db usage --json`의 `previous` 원소). 이름은 `db restore`가 만든 UTC 시각 폴더 이름이다 */
const PreviousCopySchema: TObject<{ name: TString; bytes: TInteger }> = Type.Object(
  {
    name: Type.String({ maxLength: 128 }),
    bytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** 저장 공간 사용량(`fresnel db usage --json`의 stdout). 개수와 바이트 수는 0 이상의 정수다 */
const StorageUsageSchema: TObject<{
  dataDir: TString;
  conversations: TInteger;
  attachments: TInteger;
  measurements: TInteger;
  logs: TInteger;
  restorePrevious: TInteger;
  previous: TArray<typeof PreviousCopySchema>;
}> = Type.Object(
  {
    dataDir: Type.String({ maxLength: 4096 }),
    conversations: Type.Integer({ minimum: 0 }),
    attachments: Type.Integer({ minimum: 0 }),
    measurements: Type.Integer({ minimum: 0 }),
    logs: Type.Integer({ minimum: 0 }),
    restorePrevious: Type.Integer({ minimum: 0 }),
    previous: Type.Array(PreviousCopySchema),
  },
  { additionalProperties: false },
);
export type StorageUsage = Static<typeof StorageUsageSchema>;

/** 복원 전 사본 하나를 지운 결과(`fresnel db previous-rm <이름> --json`의 stdout) */
const PreviousRemovedSchema: TObject<{ removed: TString; freedBytes: TInteger }> = Type.Object(
  {
    removed: Type.String({ maxLength: 128 }),
    freedBytes: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type PreviousRemoved = Static<typeof PreviousRemovedSchema>;

/**
 * 로그인 자동 시작 상태(`service_status`의 `autostart`). 등록 파일의 경로는 싣지 않는다. `linger`는 Linux에서만 알고, 모르면 `null`이다.
 * 모르는 필드는 거절한다.
 */
const ServiceAutostartSchema: TObject<{
  supported: TBoolean;
  registered: TBoolean;
  active: TBoolean;
  linger: TUnion<[TBoolean, TNull]>;
  platform: TString;
}> = Type.Object(
  {
    supported: Type.Boolean(),
    registered: Type.Boolean(),
    active: Type.Boolean(),
    linger: Type.Union([Type.Boolean(), Type.Null()]),
    platform: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type ServiceAutostart = Static<typeof ServiceAutostartSchema>;

/**
 * 서비스 상태(`service_status`). 실행 중이면 등록 정보의 일부(소켓, pid, 버전, 시작 시각)만 싣고, 아니면 이유만 싣는다.
 * 두 경우 모두 자동 시작 상태(`autostart`)를 싣는다. 토큰은 셸 밖으로 나오지 않는다. 모르는 필드는 거절한다.
 */
/** 서비스를 쓰려다 앱 안 엔진으로 돌아간 마지막 사유. `code`는 셸의 `ServiceStartFailureCode`(저장 문자열)이고 화면이 번역 문구로 바꾼다 */
const ServiceStartFailureSchema: TObject<{ code: TString; detail: TString }> = Type.Object(
  { code: Type.String({ maxLength: 64 }), detail: Type.String({ maxLength: 512 }) },
  { additionalProperties: false },
);

const ServiceStatusSchema: TUnion<
  [
    TObject<{
      running: TLiteral<false>;
      reason: TString;
      autostart: typeof ServiceAutostartSchema;
      startFailure: TOptional<typeof ServiceStartFailureSchema>;
    }>,
    TObject<{
      running: TLiteral<true>;
      socket: TString;
      pid: TInteger;
      version: TString;
      startedAt: TInteger;
      autostart: typeof ServiceAutostartSchema;
      startFailure: TOptional<typeof ServiceStartFailureSchema>;
    }>,
  ]
> = Type.Union([
  Type.Object(
    {
      running: Type.Literal(false),
      reason: Type.String({ maxLength: 512 }),
      autostart: ServiceAutostartSchema,
      startFailure: Type.Optional(ServiceStartFailureSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      running: Type.Literal(true),
      socket: Type.String({ maxLength: 4096 }),
      pid: Type.Integer({ minimum: 0 }),
      version: Type.String({ maxLength: 128 }),
      startedAt: Type.Integer({ minimum: 0 }),
      autostart: ServiceAutostartSchema,
      startFailure: Type.Optional(ServiceStartFailureSchema),
    },
    { additionalProperties: false },
  ),
]);
export type ServiceStatusReply = Static<typeof ServiceStatusSchema>;

/** 서비스 켜기(`service_ensure`)의 답. `action`은 셸이 한 일의 이름이다(띄웠는지 이미 떠 있었는지) */
const ServiceEnsureSchema: TObject<{ socket: TString; version: TString; action: TString }> =
  Type.Object(
    {
      socket: Type.String({ maxLength: 4096 }),
      version: Type.String({ maxLength: 128 }),
      action: Type.String({ maxLength: 64 }),
    },
    { additionalProperties: false },
  );
export type ServiceEnsureReply = Static<typeof ServiceEnsureSchema>;

/** 서비스 멈추기(`service_stop`)의 답. 멈췄으면 항상 `true`다 */
const ServiceStopSchema: TObject<{ stopped: TLiteral<true> }> = Type.Object(
  { stopped: Type.Literal(true) },
  { additionalProperties: false },
);
export type ServiceStopReply = Static<typeof ServiceStopSchema>;

/** 로그인 자동 시작 켜기·끄기(`service_autostart_set`)의 답. `lingerAdvice`는 Linux에서 linger 안내가 나왔다는 뜻이다 */
const ServiceAutostartSetSchema: TObject<{ enabled: TBoolean; lingerAdvice: TBoolean }> =
  Type.Object(
    { enabled: Type.Boolean(), lingerAdvice: Type.Boolean() },
    { additionalProperties: false },
  );
export type ServiceAutostartSetReply = Static<typeof ServiceAutostartSetSchema>;

// ---- 원격 붙기 명령(L4.remote.spec §3.3). 셸이 보낸 값은 모두 스키마로 읽는다(TY-10). 필요한 필드만 선언하고,
// 모르는 필드는 거절하지 않는다(지시: 모르는 필드는 거절하지 말고 필요한 필드만 읽는다). ----

const NullableString = (maxLength: number): TUnion<[TString, TNull]> =>
  Type.Union([Type.String({ maxLength }), Type.Null()]);

/** `ssh_hosts`의 항목 하나(`~/.ssh/config`의 `Host`). 값이 없으면 null이다 */
const SshHostsSchema = Type.Object({
  hosts: Type.Array(
    Type.Object({
      name: Type.String({ maxLength: 256 }),
      hostName: NullableString(256),
      user: NullableString(256),
      port: Type.Union([Type.Integer({ minimum: 1, maximum: 65535 }), Type.Null()]),
      proxyJump: Type.Boolean(),
    }),
  ),
  unreadable: Type.Union([Type.Literal("missing"), Type.Literal("unreadable"), Type.Null()]),
});
/** `ssh_hosts`의 답. `unreadable`은 설정 파일이 없거나 읽지 못했을 때의 사유다(없으면 null) */
export type SshHostsReply = {
  readonly hosts: readonly {
    readonly name: string;
    readonly hostName: string | null;
    readonly user: string | null;
    readonly port: number | null;
    readonly proxyJump: boolean;
  }[];
  readonly unreadable: "missing" | "unreadable" | null;
};

/** 사전 점검의 단계 이름. 여섯 단계 가운데 하나가 아니면 그 이벤트는 버린다 */
const PreflightStepSchema = Type.Union([
  Type.Literal("resolve"),
  Type.Literal("connect"),
  Type.Literal("install"),
  Type.Literal("service"),
  Type.Literal("socket"),
  Type.Literal("tunnel"),
]);
type PreflightStepName = "resolve" | "connect" | "install" | "service" | "socket" | "tunnel";

const PreflightHostKeySchema = Type.Object({
  fingerprint: Type.String({ maxLength: 256 }),
  keyType: Type.String({ maxLength: 32 }),
  hostname: Type.String({ maxLength: 256 }),
  port: Type.Integer({ minimum: 0, maximum: 65535 }),
  scanned: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 16 }),
});

/** 점검 이벤트와 답의 상세. 원인별로 쓰는 값만 선언한다. 주소와 토큰은 셸이 싣지 않는다 */
const PreflightDetailSchema = Type.Object({
  hostname: Type.Optional(Type.String({ maxLength: 256 })),
  port: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),
  user: Type.Optional(Type.String({ maxLength: 256 })),
  proxyJump: Type.Optional(Type.Boolean()),
  hostKey: Type.Optional(PreflightHostKeySchema),
  local: Type.Optional(Type.String({ maxLength: 64 })),
  remote: Type.Optional(Type.String({ maxLength: 64 })),
  lower: Type.Optional(Type.Union([Type.Literal("local"), Type.Literal("remote")])),
  cliDiffers: Type.Optional(Type.Boolean()),
  action: Type.Optional(Type.Literal("started_service")),
  reason: Type.Optional(Type.String({ maxLength: 64 })),
  socket: Type.Optional(Type.String({ maxLength: 4096 })),
  stderr: Type.Optional(Type.String({ maxLength: 4096 })),
  serverVersion: Type.Optional(Type.String({ maxLength: 128 })),
});
/** 점검 이벤트와 답의 상세. `hostKey`는 새 호스트 키를 확인할 때만 있다 */
type PreflightDetail = {
  readonly hostname?: string;
  readonly port?: number;
  readonly user?: string;
  readonly proxyJump?: boolean;
  readonly hostKey?: {
    readonly fingerprint: string;
    readonly keyType: string;
    readonly hostname: string;
    readonly port: number;
    readonly scanned: readonly string[];
  };
  readonly local?: string;
  readonly remote?: string;
  readonly lower?: "local" | "remote";
  readonly cliDiffers?: boolean;
  readonly action?: "started_service";
  readonly reason?: string;
  readonly socket?: string;
  readonly stderr?: string;
  readonly serverVersion?: string;
};

/** 고치는 법. `commands`는 터미널에서 복사해 실행할 줄들이다. 설치 경로가 확정되지 않으면 `installPath`는 null이다 */
const PreflightFixSchema = Type.Object({
  commands: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 16 }),
  hint: Type.Optional(Type.String({ maxLength: 64 })),
  installPath: Type.Optional(Type.Null()),
});
/** 고치는 법. `commands`는 터미널에서 복사해 실행할 줄들이다. 설치 경로가 확정되지 않으면 `installPath`는 null이다 */
type PreflightFix = {
  readonly commands: readonly string[];
  readonly hint?: string;
  readonly installPath?: null;
};

/** 단계 이벤트 하나(`{step, status, code, durationMs, actions, detail?, fix?}`). `durationMs`는 밀리초다 */
const PreflightEventSchema = Type.Object({
  step: PreflightStepSchema,
  status: Type.Union([
    Type.Literal("running"),
    Type.Literal("pass"),
    Type.Literal("fail"),
    Type.Literal("action"),
  ]),
  code: Type.String({ minLength: 1, maxLength: 64 }),
  durationMs: Type.Number({ minimum: 0 }),
  actions: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 }),
  detail: Type.Optional(PreflightDetailSchema),
  fix: Type.Optional(PreflightFixSchema),
});
/** 단계 이벤트 하나. `durationMs`는 밀리초다 */
export type PreflightEvent = {
  readonly step: PreflightStepName;
  readonly status: "running" | "pass" | "fail" | "action";
  readonly code: string;
  readonly durationMs: number;
  readonly actions: readonly string[];
  readonly detail?: PreflightDetail;
  readonly fix?: PreflightFix;
};

/** 채널 메시지 한 줄. `{type: "step", event}`만 받는다. 다른 모양은 버린다 */
const PreflightChannelSchema = Type.Object({
  type: Type.Literal("step"),
  event: PreflightEventSchema,
});

/** 사전 점검의 답(`ssh_preflight`의 반환). 성공이면 저장할 주소와 소켓, 멈췄으면 멈춘 단계와 원인이다 */
const PreflightOkSchema = Type.Object({
  ok: Type.Literal(true),
  address: Type.String({ maxLength: 512 }),
  socket: Type.String({ maxLength: 4096 }),
  remoteVersion: Type.Object({
    cli: Type.String({ maxLength: 128 }),
    contract: Type.String({ maxLength: 128 }),
  }),
  serviceVersion: Type.String({ maxLength: 128 }),
  tunnelMs: Type.Number({ minimum: 0 }),
});
const PreflightStopSchema = Type.Object({
  ok: Type.Literal(false),
  step: PreflightStepSchema,
  status: Type.Union([Type.Literal("fail"), Type.Literal("action")]),
  code: Type.String({ minLength: 1, maxLength: 64 }),
  actions: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 8 }),
  detail: Type.Optional(PreflightDetailSchema),
  fix: Type.Optional(PreflightFixSchema),
});
const PreflightOutcomeSchema = Type.Union([PreflightOkSchema, PreflightStopSchema]);
/** 사전 점검의 답. 성공이면 저장할 주소와 소켓, 멈췄으면 멈춘 단계와 원인이다 */
export type PreflightOutcome =
  | {
      readonly ok: true;
      readonly address: string;
      readonly socket: string;
      readonly remoteVersion: { readonly cli: string; readonly contract: string };
      readonly serviceVersion: string;
      readonly tunnelMs: number;
    }
  | {
      readonly ok: false;
      readonly step: PreflightStepName;
      readonly status: "fail" | "action";
      readonly code: string;
      readonly actions: readonly string[];
      readonly detail?: PreflightDetail;
      readonly fix?: PreflightFix;
    };

/** 연결 시험(`remote_test`)의 답. 같은 상세 모양을 성공과 실패가 쓴다 */
const RemoteTestDetailSchema = Type.Object({
  serverVersion: Type.Optional(Type.String({ maxLength: 128 })),
  reason: Type.Optional(Type.String({ maxLength: 64 })),
  local: Type.Optional(Type.String({ maxLength: 64 })),
  remote: Type.Optional(Type.String({ maxLength: 64 })),
});
const RemoteTestSchema = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    code: Type.String({ maxLength: 64 }),
    durationMs: Type.Number({ minimum: 0 }),
    detail: Type.Optional(RemoteTestDetailSchema),
  }),
  Type.Object({
    ok: Type.Literal(false),
    code: Type.String({ minLength: 1, maxLength: 64 }),
    durationMs: Type.Number({ minimum: 0 }),
    detail: Type.Optional(RemoteTestDetailSchema),
  }),
]);
/** 연결 시험(`remote_test`)의 답. 성공과 실패가 같은 상세 모양을 쓴다 */
export type RemoteTestOutcome =
  | {
      readonly ok: true;
      readonly code: string;
      readonly durationMs: number;
      readonly detail?: {
        readonly serverVersion?: string;
        readonly reason?: string;
        readonly local?: string;
        readonly remote?: string;
      };
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly durationMs: number;
      readonly detail?: {
        readonly serverVersion?: string;
        readonly reason?: string;
        readonly local?: string;
        readonly remote?: string;
      };
    };

/** 서버 지문 재기(`remote_fingerprint`)의 답. 실패는 재기 코드(`refused`, `timeout`, `io`)다 */
const RemoteFingerprintSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), fingerprint: Type.String({ maxLength: 256 }) }),
  Type.Object({ ok: Type.Literal(false), code: Type.String({ maxLength: 64 }) }),
]);
export type RemoteFingerprintReply =
  | { readonly ok: true; readonly fingerprint: string }
  | { readonly ok: false; readonly code: string };

/** 기기 페어링(`remote_pair`)의 답. 토큰은 싣지 않는다. 잠김이면 `retryAfterSeconds`가 있다 */
const RemotePairSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), deviceName: Type.String({ maxLength: 64 }) }),
  Type.Object({
    ok: Type.Literal(false),
    code: Type.String({ minLength: 1, maxLength: 64 }),
    retryAfterSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  }),
]);
export type RemotePairReply =
  | { readonly ok: true; readonly deviceName: string }
  | { readonly ok: false; readonly code: string; readonly retryAfterSeconds?: number };

/** 원격 서비스 살아 있음(`ssh_service_alive`)의 답. 살아 있으면 서비스 버전을 준다. `code`는 점검의 결과 코드다 */
const ServiceAliveSchema = Type.Object({
  alive: Type.Boolean(),
  version: Type.Optional(Type.String({ maxLength: 128 })),
  code: Type.String({ maxLength: 64 }),
});
/** 원격 서비스 살아 있음(`ssh_service_alive`)의 답. `code`는 점검의 결과 코드다 */
export type ServiceAliveReply = {
  readonly alive: boolean;
  readonly version?: string;
  readonly code: string;
};

/** 사전 점검 인자. 이 기기의 버전은 셸이 정하므로 화면은 대상과 지문 확인만 준다 */
export interface SshPreflightArgs {
  readonly target: string;
  readonly trustHostKey?: { readonly fingerprint: string };
  readonly replaceChangedHostKey?: boolean;
}

/** 기기 페어링 인자. 연결 코드와 기기 이름은 셸 명령 본문으로만 간다 */
export interface RemotePairArgs {
  readonly host: string;
  readonly port: number;
  readonly pin: string;
  readonly code: string;
  readonly deviceName: string;
}

/** 사전 점검 인자를 셸 인자 모양으로 옮긴다. 정해지지 않은 키는 보내지 않는다 */
function sshPreflightArgsOf(args: SshPreflightArgs): Readonly<Record<string, unknown>> {
  return {
    target: args.target,
    ...(args.trustHostKey === undefined ? {} : { trustHostKey: args.trustHostKey }),
    ...(args.replaceChangedHostKey === undefined
      ? {}
      : { replaceChangedHostKey: args.replaceChangedHostKey }),
  };
}

/** 셸 `db_export`의 stdout을 읽는다. 종료 코드 0일 때만 이것으로 읽는다(app/storage.ts) */
export function parseBackupReport(text: string): Result<BackupReport, JsonParseError | ParseError> {
  const json = parseJson(text);
  if (!json.ok) return err(json.error);
  return parse(BackupReportSchema, json.value);
}

/** 셸 `db_usage`의 stdout을 읽는다. 종료 코드 0일 때만 이것으로 읽는다(app/storage.ts) */
export function parseStorageUsage(text: string): Result<StorageUsage, JsonParseError | ParseError> {
  const json = parseJson(text);
  if (!json.ok) return err(json.error);
  return parse(StorageUsageSchema, json.value);
}

/** 셸 `db_previous_remove`의 stdout을 읽는다. 종료 코드 0일 때만 이것으로 읽는다(app/storage.ts) */
export function parsePreviousRemoved(
  text: string,
): Result<PreviousRemoved, JsonParseError | ParseError> {
  const json = parseJson(text);
  if (!json.ok) return err(json.error);
  return parse(PreviousRemovedSchema, json.value);
}

/**
 * 키 등록 명령(`secret_register`)의 오류. 셸이 `{kind, ...}` 객체로 거부한다(셸 모듈 `secret_register`).
 * `unknown`은 IPC 자체가 실패했거나 셸이 모르는 모양을 돌려준 경우다.
 */
export type SecretRegisterError =
  | { readonly kind: "bad-request" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large" }
  | { readonly kind: "busy" }
  | { readonly kind: "timeout" }
  | { readonly kind: "keystore" }
  | { readonly kind: "unavailable"; readonly detail: string }
  | {
      readonly kind: "rejected";
      readonly exitCode: number | null;
      readonly detail: string;
      /** 엔진의 종류 코드(`fresnel-code` 줄). 모르면 `unknown`이다 */
      readonly code: FailureKind;
    }
  | { readonly kind: "unknown" };

const SecretRegisterErrorSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Union([
        Type.Literal("bad-request"),
        Type.Literal("empty"),
        Type.Literal("too-large"),
        Type.Literal("busy"),
        Type.Literal("timeout"),
        Type.Literal("keystore"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("unavailable"), detail: Type.String({ maxLength: 4096 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("rejected"),
      exitCode: Type.Union([Type.Integer(), Type.Null()]),
      detail: Type.String({ maxLength: 4096 }),
      code: FailureKindSchema,
    },
    { additionalProperties: false },
  ),
]);

/** 셸이 거부한 값도 프로세스 밖의 값이다(TY-10). 모르는 모양은 `unknown`이다 */
function parseSecretRegisterError(value: unknown): SecretRegisterError {
  const parsed = parse(SecretRegisterErrorSchema, value);
  return parsed.ok ? parsed.value : { kind: "unknown" };
}

export type IpcError =
  | { readonly kind: "command"; readonly command: string; readonly code: string }
  | { readonly kind: "invalid"; readonly command: string };

/** W-08. 엔진이 붙을 곳: 이 기기의 사이드카, 또는 `host --stdio --remote <주소>`의 원격 서비스. 접속 토큰은 여기에 싣지 않는다(환경 변수 `FRESNEL_REMOTE_TOKEN`) */
export type EngineTarget =
  | { readonly kind: "local" }
  | { readonly kind: "remote"; readonly address: string };

/** `engine_restart` 옵션. `safeMode`를 생략하면 지금 안전 모드 값을 그대로 쓴다. 살아 있는 엔진은 `confirmed: true`여야 다시 뜬다 */
export type RestartOptions = {
  readonly safeMode?: boolean;
  readonly confirmed?: boolean;
};

export interface DesktopIpc {
  /** 현재 페이지에 릴레이를 붙인다. 이전 세대는 끊긴다. 바이트는 완성된 줄 단위로 온다 */
  attach(
    onBytes: (chunk: Uint8Array) => void,
    onState: (state: EngineState) => void,
  ): Promise<Result<AttachResult, IpcError>>;
  /** 엔진 stdin에 한 프레임(줄)을 쓴다. 세대가 다르면 거부된다 */
  write(epoch: number, chunk: Uint8Array): Promise<Result<null, IpcError>>;
  /** 처리를 끝낸 바이트 수를 알려 신용을 돌려준다 */
  ack(epoch: number, bytes: number): Promise<Result<null, IpcError>>;
  /** 엔진을 다시 띄운다. `failed`면 확인 없이, 살아 있는 엔진은 `confirmed: true`일 때만 다시 뜬다(W-35). 거절은 `not-confirmed` 등의 코드로 온다 */
  restart(options?: RestartOptions): Promise<Result<null, IpcError>>;
  /** 대상을 바꾸고 엔진을 새 대상으로 다시 띄운다(W-08). 같은 대상이면 아무 일도 없다 */
  retarget(target: EngineTarget): Promise<Result<null, IpcError>>;
  /**
   * 데이터 복원(`db_restore`). 셸이 `fresnel db restore <폴더> --json`을 엔진을 띄우지 않고 실행해 종료 코드와 두 출력을 돌려준다.
   * 셸이 거절하면(원격 대상, 이미 진행 중 등) 오류 코드가 `IpcError`로 온다. 종료 코드의 뜻은 app/restore.ts가 나눈다.
   */
  dbRestore(backupDir: string): Promise<Result<DbRestoreReply, IpcError>>;
  /**
   * 백업 만들기(`db_export`). 셸이 `parent` 아래에 UTC 시각 이름의 새 폴더를 만들고 `fresnel db export <폴더> --json --yes`를 엔진 없이 실행한다.
   * 종료 코드의 뜻은 app/storage.ts가 나눈다. 셸이 거절하면 `IpcError`다.
   */
  dbExport(parent: string): Promise<Result<DbRestoreReply, IpcError>>;
  /** 저장 공간 사용량(`db_usage`). `fresnel db usage --json`의 실행 결과를 그대로 준다 */
  dbUsage(): Promise<Result<DbRestoreReply, IpcError>>;
  /** 복원 전 사본 하나를 지운다(`db_previous_remove`). 이름 모양은 셸이 먼저 본다 */
  dbPreviousRemove(name: string): Promise<Result<DbRestoreReply, IpcError>>;
  /** 데이터 폴더를 OS 파일 관리자로 연다(`open_data_dir`). 셸이 열지 못하면 `IpcError`다 */
  openDataDir(): Promise<Result<null, IpcError>>;
  /** 이 기기의 서비스 상태(`service_status`). 실행 중이 아니면 이유를 준다. 셸이 읽지 못하면 `IpcError`다 */
  serviceStatus(): Promise<Result<ServiceStatusReply, IpcError>>;
  /** 이 기기의 서비스를 켠다(`service_ensure`). 이미 떠 있으면 그대로 둔다. 셸이 켜지 못하면 `start_failed`다 */
  serviceEnsure(): Promise<Result<ServiceEnsureReply, IpcError>>;
  /** 이 기기의 서비스를 멈춘다(`service_stop`). 멈추지 못하면 `service_failed`다 */
  serviceStop(): Promise<Result<ServiceStopReply, IpcError>>;
  /**
   * 로그인 자동 시작을 켜거나 끈다(`service_autostart_set`). 켜기는 설치 파일을 쓰고, 끄기는 지운다. 동의는 호출하는 화면이 받는다.
   * 실패는 `autostart_failed`다. 인자가 boolean이 아니면 셸이 `bad-request`로 거절한다.
   */
  serviceAutostartSet(enabled: boolean): Promise<Result<ServiceAutostartSetReply, IpcError>>;
  /** 데스크톱 로컬 설정 파일의 내용(V-14). 파일이 없으면 빈 객체 */
  readSettings(): Promise<Result<Readonly<Record<string, unknown>>, IpcError>>;
  /** 로컬 설정 한 키를 쓴다. 모르는 키나 범위 밖 값은 셸이 거부한다 */
  writeSettings(key: string, value: unknown): Promise<Result<null, IpcError>>;
  detach(epoch: number): Promise<Result<null, IpcError>>;
  /** `~/.ssh/config`의 호스트 목록(`ssh_hosts`). 파일이 없거나 읽지 못하면 `unreadable`로 알린다 */
  sshHosts(): Promise<Result<SshHostsReply, IpcError>>;
  /**
   * 사전 점검(`ssh_preflight`). 단계 이벤트는 채널로 와서 `onEvent`로 넘긴다(모양이 맞지 않으면 버린다). 답은 성공이나 멈춘 단계다.
   * 셸이 거절하면 `IpcError`다.
   */
  sshPreflight(
    args: SshPreflightArgs,
    onEvent: (event: PreflightEvent) => void,
  ): Promise<Result<PreflightOutcome, IpcError>>;
  /** 연결 시험(`remote_test`). 주소 하나로 엔진을 띄워 `host.hello`까지 왕복한다 */
  remoteTest(address: string): Promise<Result<RemoteTestOutcome, IpcError>>;
  /** 서버 인증서 지문 재기(`remote_fingerprint`). 검증 없이 재기만 한다. 실패는 재기 코드로 온다 */
  remoteFingerprint(host: string, port: number): Promise<Result<RemoteFingerprintReply, IpcError>>;
  /** 기기 페어링(`remote_pair`). 토큰은 셸이 보안 저장소에 두고 답에 싣지 않는다 */
  remotePair(args: RemotePairArgs): Promise<Result<RemotePairReply, IpcError>>;
  /** 원격 서비스가 살아 있는지(`ssh_service_alive`). 점검 주소는 `[user@]host[:port]`다. 서비스 상태만 읽고 띄우지 않는다 */
  sshServiceAlive(target: string): Promise<Result<ServiceAliveReply, IpcError>>;
  /**
   * 모델 키를 등록한다. 셸이 번들된 사이드카를 `fresnel secret <동작> <이름>`으로 실행하고 값을 그 stdin에 한 번 쓴다.
   * 값은 요청 본문 바이트로만 가고 이 함수가 돌아오기 전에 그 버퍼를 0으로 덮는다. `value`는 호출자가 덮는다.
   */
  registerSecret(
    name: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, SecretRegisterError>>;
  /**
   * 값 보기의 로컬 채널을 연다(`secret_reveal_open`). 셸이 0700 폴더에 일회용 유닉스 소켓을 만들고 그 경로를 돌려준다.
   * 경로는 `secret.beginReveal`의 `channel`로 wire에 실린다. 값은 이 답에 없다.
   */
  revealOpen(): Promise<Result<RevealChannelReply, IpcError>>;
  /**
   * 채널에서 호스트가 쓴 값을 기다려 받는다(`secret_reveal_take`). 없었거나 시한이 지나거나 닫혔으면 `null`이다.
   * 받은 바이트는 호출자가 쓴 뒤 0으로 덮는다.
   */
  revealTake(id: string): Promise<Result<Uint8Array | null, IpcError>>;
  /** 채널을 닫는다(`secret_reveal_close`). 기다리던 받기는 `null`로 끝난다 */
  revealClose(id: string): Promise<Result<null, IpcError>>;
}

/** `secret_reveal_open`의 답. `path`는 소켓의 절대 경로이고 값이 아니다 */
interface RevealChannelReply {
  readonly id: string;
  readonly path: string;
}

const RevealChannelSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    path: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

function codeOf(cause: unknown): string {
  return typeof cause === "string" ? cause : "unknown";
}

async function call<T>(command: string, run: () => Promise<T>): Promise<Result<T, IpcError>> {
  const result = await attemptAsync(run);
  return result.ok
    ? result
    : { ok: false, error: { kind: "command", command, code: codeOf(result.error.cause) } };
}

/** Channel 메시지는 원시 바이트일 때 ArrayBuffer로 온다. 그 밖의 값은 버린다 */
function bytesOf(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return null;
}

const SettingsFileSchema: TRecord<string, TUnknown> = Type.Record(Type.String(), Type.Unknown());

/** `engine_restart` 인자. 정해지지 않은 키는 보내지 않는다(셸은 빠진 키를 `None`으로 읽는다) */
function restartArgs(options: RestartOptions = {}): RestartOptions {
  const { safeMode, confirmed } = options;
  return {
    ...(safeMode === undefined ? {} : { safeMode }),
    ...(confirmed === undefined ? {} : { confirmed }),
  };
}

/** `db_*` 명령 하나의 실행 결과를 읽는다. 종료 코드와 두 출력의 모양이 맞지 않으면 `invalid`다 */
async function dbReplyOf(
  command: string,
  run: () => Promise<unknown>,
): Promise<Result<DbRestoreReply, IpcError>> {
  const raw = await call<unknown>(command, run);
  if (!raw.ok) return raw;
  const parsed = parse(DbRestoreReplySchema, raw.value);
  return parsed.ok ? parsed : { ok: false, error: { kind: "invalid", command } };
}

/** 셸 명령 하나의 답을 스키마로 읽는다. 명령이 거절되면 그 코드를, 모양이 맞지 않으면 `invalid`를 준다 */
async function replyOf<S extends TSchema>(
  command: string,
  schema: S,
  run: () => Promise<unknown>,
): Promise<Result<Static<S>, IpcError>> {
  const raw = await call<unknown>(command, run);
  if (!raw.ok) return raw;
  const parsed = parse(schema, raw.value);
  return parsed.ok ? parsed : { ok: false, error: { kind: "invalid", command } };
}

/** 셸 다리(Electron)로 DesktopIpc를 만든다 */
export function createDesktopIpc(bridge: ShellBridge): DesktopIpc {
  return {
    async attach(onBytes, onState) {
      const bytes = bridge.createChannel((message) => {
        const chunk = bytesOf(message);
        if (chunk !== null) onBytes(chunk);
      });
      const state = bridge.createChannel((message) => {
        const parsed = parseEngineState(message);
        if (parsed.ok) onState(parsed.value);
      });
      const raw = await call<unknown>("engine_attach", () =>
        bridge.invoke("engine_attach", { onBytes: bytes, onState: state }),
      );
      if (!raw.ok) return raw;
      const parsed = parseAttachResult(raw.value);
      return parsed.ok
        ? parsed
        : { ok: false, error: { kind: "invalid", command: "engine_attach" } };
    },
    write: (epoch, chunk) =>
      call("engine_write", async () => {
        await bridge.invokeBytes("engine_write", chunk, { "x-fresnel-epoch": String(epoch) });
        return null;
      }),
    ack: (epoch, bytes) =>
      call("engine_ack", async () => {
        await bridge.invoke("engine_ack", { epoch, bytes });
        return null;
      }),
    restart: (options) =>
      call("engine_restart", async () => {
        await bridge.invoke("engine_restart", restartArgs(options));
        return null;
      }),
    retarget: (target) =>
      call("engine_retarget", async () => {
        await bridge.invoke("engine_retarget", { target });
        return null;
      }),
    dbRestore: (backupDir) =>
      dbReplyOf("db_restore", () => bridge.invoke("db_restore", { backupDir })),
    dbExport: (parent) => dbReplyOf("db_export", () => bridge.invoke("db_export", { parent })),
    dbUsage: () => dbReplyOf("db_usage", () => bridge.invoke("db_usage")),
    dbPreviousRemove: (name) =>
      dbReplyOf("db_previous_remove", () => bridge.invoke("db_previous_remove", { name })),
    async openDataDir() {
      const raw = await call<unknown>("open_data_dir", () => bridge.invoke("open_data_dir"));
      if (!raw.ok) return raw;
      // 셸은 연 뒤 아무 값도 싣지 않는다(null). 다른 값은 셸이 보낸 모양이 아니다(TY-10)
      return raw.value === null
        ? { ok: true, value: null }
        : { ok: false, error: { kind: "invalid", command: "open_data_dir" } };
    },
    serviceStatus: () =>
      replyOf("service_status", ServiceStatusSchema, () => bridge.invoke("service_status")),
    serviceEnsure: () =>
      replyOf("service_ensure", ServiceEnsureSchema, () => bridge.invoke("service_ensure")),
    serviceStop: () =>
      replyOf("service_stop", ServiceStopSchema, () => bridge.invoke("service_stop")),
    serviceAutostartSet: (enabled) =>
      replyOf("service_autostart_set", ServiceAutostartSetSchema, () =>
        bridge.invoke("service_autostart_set", { enabled }),
      ),
    async readSettings() {
      const raw = await call<unknown>("desktop_settings_read", () =>
        bridge.invoke("desktop_settings_read"),
      );
      if (!raw.ok) return raw;
      const parsed = parse(SettingsFileSchema, raw.value);
      return parsed.ok
        ? parsed
        : { ok: false, error: { kind: "invalid", command: "desktop_settings_read" } };
    },
    writeSettings: (key, value) =>
      call("desktop_settings_write", async () => {
        await bridge.invoke("desktop_settings_write", { key, value });
        return null;
      }),
    detach: (epoch) =>
      call("engine_detach", async () => {
        await bridge.invoke("engine_detach", { epoch });
        return null;
      }),
    sshHosts: () => replyOf("ssh_hosts", SshHostsSchema, () => bridge.invoke("ssh_hosts")),
    sshPreflight: (args, onEvent) =>
      replyOf("ssh_preflight", PreflightOutcomeSchema, () => {
        // 단계 이벤트는 채널 메시지로 온다. 모양이 맞지 않는 메시지는 버린다(TY-10)
        const events = bridge.createChannel((message) => {
          const parsed = parse(PreflightChannelSchema, message);
          if (parsed.ok) onEvent(parsed.value.event);
        });
        return bridge.invoke("ssh_preflight", { ...sshPreflightArgsOf(args), events });
      }),
    remoteTest: (address) =>
      replyOf("remote_test", RemoteTestSchema, () => bridge.invoke("remote_test", { address })),
    remoteFingerprint: (host, port) =>
      replyOf("remote_fingerprint", RemoteFingerprintSchema, () =>
        bridge.invoke("remote_fingerprint", { host, port }),
      ),
    remotePair: (args) =>
      replyOf("remote_pair", RemotePairSchema, () =>
        bridge.invoke("remote_pair", {
          host: args.host,
          port: args.port,
          pin: args.pin,
          code: args.code,
          deviceName: args.deviceName,
        }),
      ),
    sshServiceAlive: (target) =>
      replyOf("ssh_service_alive", ServiceAliveSchema, () =>
        bridge.invoke("ssh_service_alive", { target }),
      ),
    async registerSecret(name, action, value) {
      // 본문은 `<동작> <이름>\n<값>`이다. 값을 문자열로 바꾸거나 JSON에 싣지 않는다
      const head = new TextEncoder().encode(`${action} ${name}\n`);
      const body = new Uint8Array(head.byteLength + value.byteLength);
      body.set(head, 0);
      body.set(value, head.byteLength);
      try {
        const sent = await attemptAsync(() => bridge.invokeBytes("secret_register", body));
        return sent.ok
          ? { ok: true, value: null }
          : { ok: false, error: parseSecretRegisterError(sent.error.cause) };
      } finally {
        body.fill(0);
      }
    },
    revealOpen: () =>
      replyOf("secret_reveal_open", RevealChannelSchema, () => bridge.invoke("secret_reveal_open")),
    async revealTake(id) {
      const raw = await call<unknown>("secret_reveal_take", () =>
        bridge.invoke("secret_reveal_take", { id }),
      );
      if (!raw.ok) return raw;
      // `null`은 값이 없었다는 뜻이다. 그 밖의 모양은 바이트여야 한다(TY-10)
      if (raw.value === null) return { ok: true, value: null };
      const bytes = bytesOf(raw.value);
      return bytes === null
        ? { ok: false, error: { kind: "invalid", command: "secret_reveal_take" } }
        : { ok: true, value: bytes };
    },
    revealClose: (id) =>
      call("secret_reveal_close", async () => {
        await bridge.invoke("secret_reveal_close", { id });
        return null;
      }),
  };
}
