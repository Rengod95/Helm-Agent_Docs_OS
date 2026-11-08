import { ok, type Result } from "@fresnel/contracts";
import type {
  AttachResult,
  BackupReport,
  DbRestoreReply,
  DesktopIpc,
  EngineState,
  EngineTarget,
  IpcError,
  PreviousRemoved,
  RestartOptions,
  RestoreReport,
  SecretRegisterError,
  ServiceEnsureReply,
  ServiceStatusReply,
  ServiceStopReply,
  StorageUsage,
} from "../../src/transport/ipc.ts";

const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 4242 };

/** 복원이 되돌렸을 때의 보고서. 기본 `dbRestore`가 이것을 stdout으로 돌려준다 */
export const RESTORE_REPORT: RestoreReport = {
  dbPath: "/data/fresnel.db",
  backupDir: "/backups/export-1",
  blobsAdded: 2,
  missingBlobs: ["3f1a"],
  previousDir: "/data/restore-previous/20261104T000000",
  recovered: null,
};

/** 백업이 끝났을 때의 보고서. 기본 `dbExport`가 이것을 stdout으로 돌려준다 */
export const BACKUP_REPORT: BackupReport = {
  destDir: "/backups/fresnel-backup-20261107-000000",
  exportedAt: 1794000000000,
  blobCount: 3,
  missingBlobs: [],
};

/** 저장 공간 사용량. 기본 `dbUsage`가 이것을 stdout으로 돌려준다. 복원 전 사본 하나를 가진다 */
export const STORAGE_USAGE: StorageUsage = {
  dataDir: "/data",
  conversations: 4,
  attachments: 2,
  measurements: 0,
  logs: 12,
  restorePrevious: 1,
  previous: [{ name: "20261104T000000000Z", bytes: 4096 }],
};

/** 서비스 상태의 기본 답: 실행 중이 아니다. 시험이 `serviceStatusResult`로 바꾼다 */
const SERVICE_NOT_RUNNING: ServiceStatusReply = {
  running: false,
  reason: "no registration",
};

/** 복원 전 사본을 지운 결과. 기본 `dbPreviousRemove`가 이것을 stdout으로 돌려준다 */
export const PREVIOUS_REMOVED: PreviousRemoved = {
  removed: "20261104T000000000Z",
  freedBytes: 4096,
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export type FakeIpc = {
  readonly ipc: DesktopIpc;
  /** 엔진 stdout으로 줄 하나를 보낸다 */
  emitLine(value: unknown): void;
  emitBytes(bytes: Uint8Array): void;
  emitState(state: EngineState): void;
  readonly written: { readonly epoch: number; readonly text: string }[];
  readonly acks: { readonly epoch: number; readonly bytes: number }[];
  readonly detached: number[];
  /** `restart` 호출의 옵션, 호출 순서. 옵션이 없으면 `{}`다 */
  readonly restarts: RestartOptions[];
  /** `retarget` 호출 순서 */
  readonly retargeted: EngineTarget[];
  /** `desktop-settings.json`의 가짜 내용. `readSettings`·`writeSettings`가 이 객체를 읽고 쓴다 */
  readonly settingsFile: Record<string, unknown>;
  /** `registerSecret` 호출. 값은 호출 시점의 글자로 남긴다(호출자가 바이트를 덮은 뒤에도 비교할 수 있다) */
  readonly registered: { readonly name: string; readonly action: string; readonly text: string }[];
  /** `dbRestore` 호출에 넘어온 백업 폴더, 호출 순서 */
  readonly restored: string[];
  /** `dbExport` 호출에 넘어온 부모 폴더, 호출 순서 */
  readonly dbExportCalls: string[];
  /** `dbUsage` 호출 횟수 */
  readonly dbUsageCalls: number;
  /** `dbPreviousRemove` 호출에 넘어온 사본 이름, 호출 순서 */
  readonly dbPreviousRemoveCalls: string[];
  /** `openDataDir` 호출 횟수 */
  readonly openDataDirCalls: number;
  /** 서비스 명령 호출 이름(`serviceStatus`·`serviceEnsure`·`serviceStop`), 호출 순서 */
  readonly serviceCalls: string[];
  epoch(): number;
};

export type FakeIpcOptions = {
  readonly state?: EngineState;
  /** n번째 attach(1부터)가 돌려줄 상태. 없으면 state */
  readonly stateForAttach?: (n: number) => EngineState;
  /** write마다 불린다. 엔진 역할을 하는 시험이 응답을 emitLine으로 돌려준다 */
  readonly onWrite?: (message: unknown, fake: FakeIpc) => void;
  readonly writeError?: IpcError;
  /** `registerSecret`이 돌려줄 오류. 없으면 성공 */
  readonly registerError?: SecretRegisterError;
  /** `dbRestore`가 돌려줄 결과. 없으면 종료 코드 0과 `RESTORE_REPORT`다 */
  readonly dbRestoreResult?: Result<DbRestoreReply, IpcError>;
  /** `dbExport`가 돌려줄 결과. 없으면 종료 코드 0과 `BACKUP_REPORT`다 */
  readonly dbExportResult?: Result<DbRestoreReply, IpcError>;
  /** `dbUsage`가 돌려줄 결과. 없으면 종료 코드 0과 `STORAGE_USAGE`다 */
  readonly dbUsageResult?: Result<DbRestoreReply, IpcError>;
  /** `dbPreviousRemove`가 돌려줄 결과. 없으면 종료 코드 0과 `PREVIOUS_REMOVED`다 */
  readonly dbPreviousRemoveResult?: Result<DbRestoreReply, IpcError>;
  /** `openDataDir`가 돌려줄 결과. 없으면 성공(`null`)이다 */
  readonly openDataDirResult?: Result<null, IpcError>;
  /** `serviceStatus`가 돌려줄 결과. 없으면 `SERVICE_NOT_RUNNING`이다 */
  readonly serviceStatusResult?: Result<ServiceStatusReply, IpcError>;
  /** `serviceEnsure`가 돌려줄 결과. 없으면 소켓과 버전을 가진 성공이다 */
  readonly serviceEnsureResult?: Result<ServiceEnsureReply, IpcError>;
  /** `serviceStop`이 돌려줄 결과. 없으면 멈춘 성공이다 */
  readonly serviceStopResult?: Result<ServiceStopReply, IpcError>;
};

function ignore(): void {
  // attach 전에는 받을 곳이 없다
}

export function fakeIpc(options: FakeIpcOptions = {}): FakeIpc {
  let onBytes: (chunk: Uint8Array) => void = ignore;
  let onState: (state: EngineState) => void = ignore;
  let epoch = 0;
  const written: { epoch: number; text: string }[] = [];
  const acks: { epoch: number; bytes: number }[] = [];
  const detached: number[] = [];
  const restarts: RestartOptions[] = [];
  const retargeted: EngineTarget[] = [];
  const settingsFile: Record<string, unknown> = {};
  const registered: { name: string; action: string; text: string }[] = [];
  const restored: string[] = [];
  const dbExportCalls: string[] = [];
  const dbPreviousRemoveCalls: string[] = [];
  const serviceCalls: string[] = [];
  let dbUsageCount = 0;
  let openDataDirCount = 0;
  const fake: FakeIpc = {
    ipc: {
      attach(bytes, state) {
        onBytes = bytes;
        onState = state;
        epoch += 1;
        const result: AttachResult = {
          epoch,
          state: options.stateForAttach?.(epoch) ?? options.state ?? RUNNING,
        };
        return Promise.resolve({ ok: true, value: result });
      },
      write(e, chunk) {
        if (options.writeError !== undefined)
          return Promise.resolve({ ok: false, error: options.writeError });
        const text = dec.decode(chunk);
        written.push({ epoch: e, text });
        const parsed: unknown = JSON.parse(text);
        queueMicrotask(() => options.onWrite?.(parsed, fake));
        return Promise.resolve({ ok: true, value: null });
      },
      ack(e, bytes) {
        acks.push({ epoch: e, bytes });
        return Promise.resolve({ ok: true, value: null });
      },
      restart(options) {
        restarts.push(options ?? {});
        return Promise.resolve({ ok: true, value: null });
      },
      retarget(target) {
        retargeted.push(target);
        return Promise.resolve({ ok: true, value: null });
      },
      readSettings: () => Promise.resolve({ ok: true, value: { ...settingsFile } }),
      writeSettings(key, value) {
        settingsFile[key] = value;
        return Promise.resolve({ ok: true, value: null });
      },
      detach(e) {
        detached.push(e);
        return Promise.resolve({ ok: true, value: null });
      },
      registerSecret(name, action, value) {
        registered.push({ name, action, text: dec.decode(value) });
        return Promise.resolve(
          options.registerError === undefined
            ? { ok: true, value: null }
            : { ok: false, error: options.registerError },
        );
      },
      dbRestore(backupDir) {
        restored.push(backupDir);
        return Promise.resolve(
          options.dbRestoreResult ??
            ok({ exitCode: 0, stdout: JSON.stringify(RESTORE_REPORT), stderr: "" }),
        );
      },
      dbExport(parent) {
        dbExportCalls.push(parent);
        return Promise.resolve(
          options.dbExportResult ??
            ok({ exitCode: 0, stdout: JSON.stringify(BACKUP_REPORT), stderr: "" }),
        );
      },
      dbUsage() {
        dbUsageCount += 1;
        return Promise.resolve(
          options.dbUsageResult ??
            ok({ exitCode: 0, stdout: JSON.stringify(STORAGE_USAGE), stderr: "" }),
        );
      },
      dbPreviousRemove(name) {
        dbPreviousRemoveCalls.push(name);
        return Promise.resolve(
          options.dbPreviousRemoveResult ??
            ok({ exitCode: 0, stdout: JSON.stringify(PREVIOUS_REMOVED), stderr: "" }),
        );
      },
      openDataDir() {
        openDataDirCount += 1;
        return Promise.resolve(options.openDataDirResult ?? ok(null));
      },
      serviceStatus() {
        serviceCalls.push("serviceStatus");
        return Promise.resolve(options.serviceStatusResult ?? ok(SERVICE_NOT_RUNNING));
      },
      serviceEnsure() {
        serviceCalls.push("serviceEnsure");
        return Promise.resolve(
          options.serviceEnsureResult ??
            ok({ socket: "/run/fresnel/service.sock", version: "1.2.3", action: "spawned" }),
        );
      },
      serviceStop() {
        serviceCalls.push("serviceStop");
        return Promise.resolve(options.serviceStopResult ?? ok({ stopped: true }));
      },
    },
    emitLine: (value) => onBytes(enc.encode(`${JSON.stringify(value)}\n`)),
    emitBytes: (bytes) => onBytes(bytes),
    emitState: (state) => onState(state),
    written,
    acks,
    detached,
    restarts,
    retargeted,
    settingsFile,
    registered,
    restored,
    dbExportCalls,
    dbPreviousRemoveCalls,
    get dbUsageCalls() {
      return dbUsageCount;
    },
    get openDataDirCalls() {
      return openDataDirCount;
    },
    serviceCalls,
    epoch: () => epoch,
  };
  return fake;
}

/** 요청 메시지의 id. 시험 엔진이 같은 id로 응답한다 */
export function requestId(message: unknown): string {
  const id: unknown =
    typeof message === "object" && message !== null && "id" in message ? message.id : undefined;
  return typeof id === "string" ? id : "";
}
