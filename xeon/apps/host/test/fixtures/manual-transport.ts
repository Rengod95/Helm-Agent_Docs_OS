import type { CloseInfo, JsonRpcMessage, Transport } from "@xeon/contracts/wire";

// 시험이 직접 메시지를 밀어 넣고 보낸 것을 읽는 전송.

export interface ManualTransport {
  readonly transport: Transport;
  readonly sent: JsonRpcMessage[];
  /** 상대가 보낸 것처럼 메시지를 전달한다 */
  deliver(message: unknown): void;
  /** 상대가 닫은 것처럼 알린다 */
  closeRemote(info?: CloseInfo): void;
  /** 다음 send를 거부하게 한다 */
  failSendsWith(error: Error): void;
}

export function manualTransport(): ManualTransport {
  const messageHandlers = new Set<(message: unknown) => void>();
  const closeHandlers = new Set<(info: CloseInfo) => void>();
  const sent: JsonRpcMessage[] = [];
  const state: { failure: Error | undefined; closed: boolean } = {
    failure: undefined,
    closed: false,
  };
  function emitClose(info: CloseInfo): void {
    if (state.closed) return;
    state.closed = true;
    for (const handler of Array.from(closeHandlers)) handler(info);
  }
  return {
    sent,
    transport: {
      kind: "in-process",
      send(message) {
        if (state.failure !== undefined) return Promise.reject(state.failure);
        sent.push(message);
        return Promise.resolve();
      },
      onMessage(handler) {
        messageHandlers.add(handler);
        return () => {
          messageHandlers.delete(handler);
        };
      },
      onClose(handler) {
        closeHandlers.add(handler);
        return () => {
          closeHandlers.delete(handler);
        };
      },
      close(reason) {
        emitClose({ reason: "local", ...(reason === undefined ? {} : { message: reason }) });
        return Promise.resolve();
      },
    },
    deliver(message) {
      for (const handler of Array.from(messageHandlers)) handler(message);
    },
    closeRemote(info = { reason: "remote" }) {
      emitClose(info);
    },
    failSendsWith(error) {
      state.failure = error;
    },
  };
}
