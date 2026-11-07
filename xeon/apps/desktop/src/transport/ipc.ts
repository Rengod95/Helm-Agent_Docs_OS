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
import {
  Type,
  type Static,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TRecord,
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
}> = Type.Object(
  {
    /** 신호로 끝나면 null */
    code: Type.Union([Type.Integer(), Type.Null()]),
    /** Windows는 항상 null */
    signal: Type.Union([Type.Integer(), Type.Null()]),
    at: IsoTimeSchema,
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
  | { readonly kind: "rejected"; readonly exitCode: number | null; readonly detail: string }
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
  /** 데스크톱 로컬 설정 파일의 내용(V-14). 파일이 없으면 빈 객체 */
  readSettings(): Promise<Result<Readonly<Record<string, unknown>>, IpcError>>;
  /** 로컬 설정 한 키를 쓴다. 모르는 키나 범위 밖 값은 셸이 거부한다 */
  writeSettings(key: string, value: unknown): Promise<Result<null, IpcError>>;
  detach(epoch: number): Promise<Result<null, IpcError>>;
  /**
   * 모델 키를 등록한다. 셸이 번들된 사이드카를 `fresnel secret <동작> <이름>`으로 실행하고 값을 그 stdin에 한 번 쓴다.
   * 값은 요청 본문 바이트로만 가고 이 함수가 돌아오기 전에 그 버퍼를 0으로 덮는다. `value`는 호출자가 덮는다.
   */
  registerSecret(
    name: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, SecretRegisterError>>;
}

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
  };
}
