import type {
  CloseInfo,
  InProcessTransportFactory,
  JsonRpcMessage,
  Transport,
  Unsubscribe,
} from "@xeon/contracts/wire";

// L4.host-service.spec §3.3.4 "전송 구현" 표. 메모리 큐 쌍이고 전달은 queueMicrotask로 보낸 순서대로 한다.
// devChecks이면 메시지마다 JSON 왕복을 거친다: JSON으로 표현되지 않는 값(undefined 필드, 함수, Date)이 다른 전송에서
// 깨지기 전에 이 전송에서 드러나게 한다(AH-01).

export interface InProcessTransportOptions {
  /** 참이면 `JSON.parse(JSON.stringify(m))` 사본을 전달한다. 개발 빌드만 true */
  readonly devChecks?: boolean;
}

interface Endpoint {
  readonly transport: Transport;
  /** 상대가 보낸 메시지를 받는다 */
  deliver(message: unknown): void;
  /** 상대가 닫혔다 */
  peerClosed(info: CloseInfo): void;
}

function jsonRoundTrip(message: JsonRpcMessage): unknown {
  return JSON.parse(JSON.stringify(message));
}

function createEndpoint(
  options: InProcessTransportOptions,
  peer: () => Endpoint | undefined,
  afterLocalClose: () => void,
): Endpoint {
  const messageHandlers = new Set<(message: unknown) => void>();
  const closeHandlers = new Set<(info: CloseInfo) => void>();
  /** 핸들러가 붙기 전에 도착한 메시지. 첫 핸들러가 붙을 때 순서대로 넘긴다 */
  const early: unknown[] = [];
  const state: { closed: CloseInfo | undefined; flushScheduled: boolean } = {
    closed: undefined,
    flushScheduled: false,
  };

  function emitClose(info: CloseInfo): void {
    if (state.closed !== undefined) return;
    state.closed = info;
    for (const handler of Array.from(closeHandlers)) handler(info);
  }

  function flushEarly(): void {
    state.flushScheduled = false;
    if (messageHandlers.size === 0) return;
    const queued = early.splice(0);
    for (const message of queued) {
      for (const handler of Array.from(messageHandlers)) handler(message);
    }
  }

  const transport: Transport = {
    kind: "in-process",
    send(message) {
      if (state.closed !== undefined) {
        return Promise.reject(new Error("in-process transport is closed"));
      }
      const target = peer();
      if (target === undefined) return Promise.reject(new Error("in-process peer is missing"));
      const copy = options.devChecks === true ? jsonRoundTrip(message) : message;
      queueMicrotask(() => {
        target.deliver(copy);
      });
      return Promise.resolve();
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      if (early.length > 0 && !state.flushScheduled) {
        state.flushScheduled = true;
        queueMicrotask(flushEarly);
      }
      const off: Unsubscribe = () => {
        messageHandlers.delete(handler);
      };
      return off;
    },
    onClose(handler) {
      if (state.closed !== undefined) {
        const info = state.closed;
        queueMicrotask(() => {
          handler(info);
        });
      } else {
        closeHandlers.add(handler);
      }
      const off: Unsubscribe = () => {
        closeHandlers.delete(handler);
      };
      return off;
    },
    close(reason) {
      if (state.closed !== undefined) return Promise.resolve();
      emitClose({ reason: "local", ...(reason === undefined ? {} : { message: reason }) });
      afterLocalClose();
      return Promise.resolve();
    },
  };

  return {
    transport,
    deliver(message) {
      if (state.closed !== undefined) return;
      if (messageHandlers.size === 0) {
        early.push(message);
        return;
      }
      for (const handler of Array.from(messageHandlers)) handler(message);
    },
    peerClosed(info) {
      emitClose(info);
    },
  };
}

/**
 * in-process 전송 쌍을 만드는 팩토리. 한쪽이 닫히면 이미 보낸 메시지가 모두 전달된 뒤 상대가
 * `{ reason: "remote" }`로 닫힌다.
 */
export function createInProcessTransportFactory(
  options: InProcessTransportOptions = {},
): InProcessTransportFactory {
  return () => {
    const ends: { client: Endpoint | undefined; server: Endpoint | undefined } = {
      client: undefined,
      server: undefined,
    };
    const closePeer = (from: "client" | "server"): void => {
      const target = from === "client" ? ends.server : ends.client;
      // 이미 보낸 메시지의 전달 마이크로태스크가 먼저 큐에 있으므로 순서가 지켜진다
      queueMicrotask(() => {
        target?.peerClosed({ reason: "remote" });
      });
    };
    ends.client = createEndpoint(
      options,
      () => ends.server,
      () => closePeer("client"),
    );
    ends.server = createEndpoint(
      options,
      () => ends.client,
      () => closePeer("server"),
    );
    return { client: ends.client.transport, server: ends.server.transport };
  };
}
