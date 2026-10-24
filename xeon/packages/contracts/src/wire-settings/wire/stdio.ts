import { attemptAsync, type Logger } from "../../base/index.ts";
import type { JsonRpcMessage } from "./jsonrpc.ts";
import type {
  CloseInfo,
  StdioTransportFactory,
  StdioTransportOptions,
  Transport,
  Unsubscribe,
} from "./transport.ts";
import { createLineFramer, encodeFrame, encodeText, rejectionFrame } from "./framing.ts";

// L0.process.spec §4.1 stdio, L0.process.plan PR-03. JSON Lines 위의 Transport.
// - 수신 순서를 보존하고 처리기는 읽기 루프에서 동기로 부른다. 처리기가 없을 때 도착한 메시지는 첫 처리기가 붙을 때 비운다.
//   처리기가 없는 채로 EOF가 오면 쌓인 메시지를 먼저 비운 뒤에 닫힘을 알린다(onMessage 없이 onClose만 붙인 구독자는 close()를 부를 때까지 EOF를 받지 못한다).
// - 송신은 직렬화하고 앞 쓰기가 끝난 뒤(백프레셔: writer.ready) 다음을 쓴다.
// - EOF는 onClose({ reason: "eof" }). 끝에 줄바꿈 없이 남은 조각은 버리고 진단에 남긴다.
// - onClose는 한 번만 부른다. 그 뒤 send는 Error("transport closed")로 거부된다.

export interface StdioTransportDeps {
  /** 진단(버린 조각, 처리기 실패)을 남긴다 */
  readonly logger?: Logger;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "non_error_thrown";
}

function noop(): void {
  // 쓰기 순서 꼬리를 값으로 잇는 용도다. 실패는 emitClose로 이미 보고했다.
}

export function createStdioTransportWith(
  options: StdioTransportOptions,
  deps: StdioTransportDeps = {},
): Transport {
  const framer = createLineFramer(
    options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes },
  );
  const reader = options.readable.getReader();
  const writer = options.writable.getWriter();
  const messageHandlers = new Set<(message: unknown) => void>();
  const closeHandlers = new Set<(info: CloseInfo) => void>();
  const backlog: unknown[] = [];
  const state: {
    closeInfo: CloseInfo | undefined;
    /** 쌓인 메시지를 비우기 전에 EOF가 와서 미룬 닫힘 */
    heldClose: CloseInfo | undefined;
    started: boolean;
  } = {
    closeInfo: undefined,
    heldClose: undefined,
    started: false,
  };
  const write: { tail: Promise<void> } = { tail: Promise.resolve() };

  function emitClose(info: CloseInfo): void {
    if (state.closeInfo !== undefined) return;
    if (info.reason === "eof" && backlog.length > 0 && messageHandlers.size === 0) {
      // 마지막 응답을 쓰고 바로 끝난 상대의 메시지를 잃지 않도록, 첫 처리기가 비울 때까지 닫힘을 미룬다
      state.heldClose = info;
      return;
    }
    state.closeInfo = info;
    state.heldClose = undefined;
    backlog.length = 0;
    const handlers = Array.from(closeHandlers);
    closeHandlers.clear();
    messageHandlers.clear();
    for (const handler of handlers) deliverSafely(() => handler(info), "close");
  }

  /** 처리기 예외는 전송을 오류로 닫는다. 읽기 루프를 죽이지 않고, 원인은 진단에 남긴다 */
  function deliverSafely(call: () => void, where: string): void {
    try {
      call();
    } catch (caught) {
      deps.logger?.error("stdio.handler_failed", { where, error: messageOf(caught) });
      emitClose({ reason: "error", message: `${where}_handler_failed` });
    }
  }

  function deliver(message: unknown): void {
    if (messageHandlers.size === 0) {
      backlog.push(message);
      return;
    }
    for (const handler of Array.from(messageHandlers))
      deliverSafely(() => handler(message), "message");
  }

  /** 미뤄 둔 EOF 닫힘이 있으면 지금 알린다 */
  function releaseHeldClose(): void {
    const held = state.heldClose;
    if (held === undefined) return;
    state.heldClose = undefined;
    emitClose(held);
  }

  function enqueue(bytes: Uint8Array): Promise<void> {
    if (state.closeInfo !== undefined) return Promise.reject(new Error("transport closed"));
    const next = write.tail.then(async () => {
      await writer.ready;
      await writer.write(bytes);
      return undefined;
    });
    write.tail = next.then(noop, (caught: unknown) => {
      emitClose({ reason: "error", message: messageOf(caught) });
    });
    return next;
  }

  /** 응답을 기다리지 않는 쓰기(전송이 직접 보내는 오류 응답). 실패는 닫힘으로 알린다 */
  function enqueueDetached(bytes: Uint8Array): void {
    enqueue(bytes).catch((caught: unknown) => {
      emitClose({ reason: "error", message: messageOf(caught) });
    });
  }

  function handleChunk(chunk: Uint8Array): void {
    for (const event of framer.push(chunk)) {
      if (event.kind === "message") deliver(event.value);
      else {
        deps.logger?.warn("stdio.frame_rejected", { problem: event.problem });
        enqueueDetached(encodeText(rejectionFrame(event.problem)));
      }
    }
  }

  function readNext(): void {
    reader.read().then(
      (chunk) => {
        if (chunk.done) {
          const { droppedBytes } = framer.finish();
          if (droppedBytes > 0) deps.logger?.warn("stdio.partial_frame_dropped", { droppedBytes });
          emitClose({ reason: "eof" });
          return undefined;
        }
        handleChunk(chunk.value);
        if (state.closeInfo === undefined) readNext();
        return undefined;
      },
      (caught: unknown) => {
        emitClose({ reason: "error", message: messageOf(caught) });
      },
    );
  }

  /** 첫 구독이 생길 때 읽기를 시작한다. 구독 없이 읽으면 메시지가 쌓이기만 한다 */
  function ensureStarted(): void {
    if (state.started) return;
    state.started = true;
    readNext();
  }

  return {
    kind: "stdio",
    send(message: JsonRpcMessage): Promise<void> {
      const encoded = encodeFrame(message);
      if (!encoded.ok) return Promise.reject(new Error("message is not JSON-serializable"));
      return enqueue(encoded.value);
    },
    onMessage(handler): Unsubscribe {
      messageHandlers.add(handler);
      if (backlog.length > 0) {
        const pending = backlog.splice(0);
        queueMicrotask(() => {
          for (const message of pending) deliver(message);
          releaseHeldClose();
        });
      }
      ensureStarted();
      return () => {
        messageHandlers.delete(handler);
      };
    },
    onClose(handler): Unsubscribe {
      const info = state.closeInfo;
      if (info !== undefined) {
        queueMicrotask(() => {
          handler(info);
        });
        return noopUnsubscribe;
      }
      closeHandlers.add(handler);
      ensureStarted();
      return () => {
        closeHandlers.delete(handler);
      };
    },
    async close(reason) {
      if (state.closeInfo !== undefined) return;
      emitClose(reason === undefined ? { reason: "local" } : { reason: "local", message: reason });
      // 취소·닫기 실패는 이미 끝난 스트림의 뒷정리다. 전송은 이미 닫혔으므로 진단으로만 남긴다
      const cancelled = await attemptAsync(() => reader.cancel());
      if (!cancelled.ok) {
        deps.logger?.debug("stdio.reader_cancel_failed", {
          error: messageOf(cancelled.error.cause),
        });
      }
      await write.tail;
      const closed = await attemptAsync(() => writer.close());
      if (!closed.ok) {
        deps.logger?.debug("stdio.writer_close_failed", { error: messageOf(closed.error.cause) });
      }
    },
  };
}

function noopUnsubscribe(): void {
  // 이미 닫힌 전송에서 받은 구독 해제. 할 일이 없다
}

/** F `StdioTransportFactory` 구현 */
export const createStdioTransport: StdioTransportFactory = (options) =>
  createStdioTransportWith(options);
