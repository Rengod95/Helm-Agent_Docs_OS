import type { AttachResult, DesktopIpc, EngineState, IpcError } from "../../src/transport/ipc.ts";

const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 4242 };
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
  epoch(): number;
};

export type FakeIpcOptions = {
  readonly state?: EngineState;
  /** n번째 attach(1부터)가 돌려줄 상태. 없으면 state */
  readonly stateForAttach?: (n: number) => EngineState;
  /** write마다 불린다. 엔진 역할을 하는 시험이 응답을 emitLine으로 돌려준다 */
  readonly onWrite?: (message: unknown, fake: FakeIpc) => void;
  readonly writeError?: IpcError;
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
      detach(e) {
        detached.push(e);
        return Promise.resolve({ ok: true, value: null });
      },
    },
    emitLine: (value) => onBytes(enc.encode(`${JSON.stringify(value)}\n`)),
    emitBytes: (bytes) => onBytes(bytes),
    emitState: (state) => onState(state),
    written,
    acks,
    detached,
    epoch: () => epoch,
  };
  return fake;
}

/** 요청 메시지의 id. 시험 엔진이 같은 id로 응답한다 */
export function requestId(message: unknown): string {
  const id: unknown =
    typeof message === "object" && message !== null ? Reflect.get(message, "id") : undefined;
  return typeof id === "string" ? id : "";
}
