import { ok, type Result } from "@fresnel/contracts";
import type {
  AttachResult,
  DbRestoreReply,
  DesktopIpc,
  EngineState,
  EngineTarget,
  IpcError,
  RestoreReport,
  SecretRegisterError,
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
  /** `retarget` 호출 순서 */
  readonly retargeted: EngineTarget[];
  /** `desktop-settings.json`의 가짜 내용. `readSettings`·`writeSettings`가 이 객체를 읽고 쓴다 */
  readonly settingsFile: Record<string, unknown>;
  /** `registerSecret` 호출. 값은 호출 시점의 글자로 남긴다(호출자가 바이트를 덮은 뒤에도 비교할 수 있다) */
  readonly registered: { readonly name: string; readonly action: string; readonly text: string }[];
  /** `dbRestore` 호출에 넘어온 백업 폴더, 호출 순서 */
  readonly restored: string[];
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
  const retargeted: EngineTarget[] = [];
  const settingsFile: Record<string, unknown> = {};
  const registered: { name: string; action: string; text: string }[] = [];
  const restored: string[] = [];
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
      restart: () => Promise.resolve({ ok: true, value: null }),
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
    },
    emitLine: (value) => onBytes(enc.encode(`${JSON.stringify(value)}\n`)),
    emitBytes: (bytes) => onBytes(bytes),
    emitState: (state) => onState(state),
    written,
    acks,
    detached,
    retargeted,
    settingsFile,
    registered,
    restored,
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
