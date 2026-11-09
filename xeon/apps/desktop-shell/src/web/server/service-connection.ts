// 서비스 Unix 소켓에 거는 기본 연결(`ServiceConnection`의 node:net 구현). 만들자마자 연결을 시작하고, 연결되기 전에 온 쓰기는 기다렸다가 보낸다.
// 연결이 실패하면 `onClose`가 `failed`(오류 코드)로 한 번 알린다. 쓰기 실패와 닫힘은 `Result`로 돌려준다(던지지 않는다).
import { connect } from "node:net";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ServiceCloseCause, ServiceConnection, ServiceWriteError } from "./ports.ts";

type WriteResult = Result<null, ServiceWriteError>;

interface PendingWrite {
  readonly bytes: Uint8Array;
  readonly done: (result: WriteResult) => void;
}

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** `path`의 Unix 소켓에 연결을 시작한다. 연결이 실패하면 `onClose`가 `failed`를 알린다 */
export function connectServiceSocket(path: string): ServiceConnection {
  const socket = connect({ path });
  const state: { connected: boolean; ended: boolean; failure: string | null } = {
    connected: false,
    ended: false,
    failure: null,
  };
  const waiting: PendingWrite[] = [];
  const early: Uint8Array[] = [];
  let dataListener: ((bytes: Uint8Array) => void) | null = null;
  let closeListener: ((cause: ServiceCloseCause) => void) | null = null;
  let closeCause: ServiceCloseCause | null = null;

  function writeNow(pending: PendingWrite): void {
    socket.write(pending.bytes, (caught) => {
      if (caught === null || caught === undefined) pending.done(ok(null));
      else pending.done(err({ kind: "io", code: codeOf(caught) }));
    });
  }

  socket.on("connect", () => {
    state.connected = true;
    for (const pending of waiting.splice(0)) writeNow(pending);
  });
  socket.on("data", (chunk: Buffer) => {
    if (dataListener === null) early.push(chunk);
    else dataListener(chunk);
  });
  socket.on("error", (caught: unknown) => {
    state.failure = codeOf(caught);
  });
  socket.on("close", () => {
    state.ended = true;
    const cause: ServiceCloseCause =
      state.failure === null ? { kind: "ended" } : { kind: "failed", code: state.failure };
    closeCause = cause;
    for (const pending of waiting.splice(0)) pending.done(err({ kind: "closed" }));
    if (closeListener !== null) closeListener(cause);
  });

  return {
    write(bytes) {
      return new Promise<WriteResult>((resolve) => {
        if (state.ended) {
          resolve(err({ kind: "closed" }));
          return;
        }
        const pending: PendingWrite = { bytes, done: resolve };
        if (state.connected) writeNow(pending);
        else waiting.push(pending);
      });
    },

    onData(listener) {
      dataListener = listener;
      for (const chunk of early.splice(0)) listener(chunk);
    },

    onClose(listener) {
      closeListener = listener;
      const ended = closeCause;
      if (ended !== null) queueMicrotask(() => listener(ended));
    },

    pause() {
      socket.pause();
    },

    resume() {
      socket.resume();
    },

    close() {
      socket.destroy();
    },
  };
}
