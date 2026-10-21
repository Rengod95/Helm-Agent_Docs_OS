import type { CloseInfo, JsonRpcMessage, Transport } from "@xeon/contracts/wire";

// 시험용 메모리 전송 쌍. 전달은 queueMicrotask로 보낸 순서대로 한다.

interface End {
  readonly transport: Transport;
  deliver(message: unknown): void;
  peerClosed(info: CloseInfo): void;
}

function createEnd(peer: () => End | undefined, onLocalClose: () => void): End {
  const handlers = new Set<(message: unknown) => void>();
  const closeHandlers = new Set<(info: CloseInfo) => void>();
  const early: unknown[] = [];
  const state: { closed: CloseInfo | undefined } = { closed: undefined };
  const emitClose = (info: CloseInfo): void => {
    if (state.closed !== undefined) return;
    state.closed = info;
    for (const handler of Array.from(closeHandlers)) handler(info);
  };
  const transport: Transport = {
    kind: "in-process",
    send(message: JsonRpcMessage) {
      if (state.closed !== undefined) return Promise.reject(new Error("closed"));
      const target = peer();
      queueMicrotask(() => {
        target?.deliver(message);
      });
      return Promise.resolve();
    },
    onMessage(handler) {
      handlers.add(handler);
      if (early.length > 0) {
        const queued = early.splice(0);
        queueMicrotask(() => {
          for (const message of queued) handler(message);
        });
      }
      return () => {
        handlers.delete(handler);
      };
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    close() {
      if (state.closed === undefined) {
        emitClose({ reason: "local" });
        onLocalClose();
      }
      return Promise.resolve();
    },
  };
  return {
    transport,
    deliver(message) {
      if (state.closed !== undefined) return;
      if (handlers.size === 0) {
        early.push(message);
        return;
      }
      for (const handler of Array.from(handlers)) handler(message);
    },
    peerClosed: emitClose,
  };
}

export function createTransportPair(): { readonly client: Transport; readonly server: Transport } {
  const ends: { client: End | undefined; server: End | undefined } = {
    client: undefined,
    server: undefined,
  };
  ends.client = createEnd(
    () => ends.server,
    () => {
      queueMicrotask(() => {
        ends.server?.peerClosed({ reason: "remote" });
      });
    },
  );
  ends.server = createEnd(
    () => ends.client,
    () => {
      queueMicrotask(() => {
        ends.client?.peerClosed({ reason: "remote" });
      });
    },
  );
  return { client: ends.client.transport, server: ends.server.transport };
}
