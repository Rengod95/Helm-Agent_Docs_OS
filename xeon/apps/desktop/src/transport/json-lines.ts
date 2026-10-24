import { attempt, attemptAsync, parseJson, type Logger } from "@xeon/contracts";
import {
  toJsonRpcError,
  wireError,
  WIRE_LIMITS,
  type CloseInfo,
  type JsonRpcMessage,
  type StdioTransportFactory,
  type StdioTransportOptions,
  type Transport,
  type Unsubscribe,
} from "@xeon/contracts/wire";

// WebView용 JSON Lines 전송. F `StdioTransportFactory`의 구현이다(L4.desktop.spec 3.4, 10 미결 3).
// F가 런타임 중립 구현을 제공하면 이 파일은 지운다. @xeon/platform-process의 같은 이름 구현은 Bun/Node 모듈을 끌어오므로
// WebView 번들에서 쓸 수 없고(W7), apps/host의 연결 구현도 DR-10으로 import할 수 없어 같은 동작을 여기에 둔다.
// 동작 기준: L0.process.spec 4.1 (수신 순서 보존, 직렬 송신, EOF는 onClose, 줄바꿈 없는 꼬리는 버림).

// L0.process.spec §4.1, L0.process.plan PR-02. JSON Lines 프레이밍: 줄 하나가 메시지 하나다.
// stdio와 socket 전송이 같은 구현을 쓴다. 바이트를 `\n`(0x0A)에서 먼저 자르고 줄 단위로 디코드한다.
// 다바이트 UTF-8 문자는 0x0A를 포함하지 않으므로 청크 경계에서 깨지지 않는다.

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** 프레임을 받아들이지 못한 이유. 연결은 유지하고 상대에게 오류 응답을 보낸다 */
type FrameProblem = "frame_too_large" | "not_json";

type FrameEvent =
  | { readonly kind: "message"; readonly value: unknown }
  | { readonly kind: "rejected"; readonly problem: FrameProblem };

interface LineFramer {
  /** 바이트 조각 하나를 넣고, 그 조각이 완성한 프레임들을 도착 순서대로 돌려준다 */
  push(chunk: Uint8Array): readonly FrameEvent[];
  /** 스트림 끝(EOF). 줄바꿈 없이 남은 조각은 버리고 그 바이트 수를 돌려준다 */
  finish(): { readonly droppedBytes: number };
}

interface LineFramerOptions {
  /** 기본 `WIRE_LIMITS.maxFrameBytes` */
  readonly maxFrameBytes?: number;
}

interface FramerState {
  parts: Uint8Array[];
  length: number;
  /** 한도를 넘은 줄의 나머지를 버리는 중 */
  discarding: boolean;
  /** 버리는 중인 줄에서 지금까지 센 바이트 수(진단용) */
  discardedBytes: number;
}

function joinParts(parts: readonly Uint8Array[], length: number): Uint8Array {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only !== undefined) return only;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function decodeLine(bytes: Uint8Array, decoder: TextDecoder): FrameEvent | undefined {
  const end =
    bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN
      ? bytes.length - 1
      : bytes.length;
  if (end === 0) return undefined;
  const parsed = parseJson(decoder.decode(bytes.subarray(0, end)));
  if (!parsed.ok) return { kind: "rejected", problem: "not_json" };
  return { kind: "message", value: parsed.value };
}

function createLineFramer(options: LineFramerOptions = {}): LineFramer {
  const maxFrameBytes = options.maxFrameBytes ?? WIRE_LIMITS.maxFrameBytes;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const state: FramerState = { parts: [], length: 0, discarding: false, discardedBytes: 0 };

  function reset(): void {
    state.parts = [];
    state.length = 0;
    state.discarding = false;
    state.discardedBytes = 0;
  }

  return {
    push(chunk): readonly FrameEvent[] {
      const events: FrameEvent[] = [];
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(NEWLINE, start);
        const stop = newline < 0 ? chunk.length : newline;
        const piece = chunk.subarray(start, stop);
        if (state.discarding) {
          state.discardedBytes += piece.length;
        } else if (state.length + piece.length > maxFrameBytes) {
          state.discarding = true;
          state.discardedBytes = state.length + piece.length;
          state.parts = [];
          state.length = 0;
        } else if (piece.length > 0) {
          state.parts.push(piece);
          state.length += piece.length;
        }
        if (newline < 0) break;
        if (state.discarding) {
          events.push({ kind: "rejected", problem: "frame_too_large" });
        } else {
          const event = decodeLine(joinParts(state.parts, state.length), decoder);
          if (event !== undefined) events.push(event);
        }
        reset();
        start = newline + 1;
      }
      return events;
    },
    finish() {
      const droppedBytes = state.discarding ? state.discardedBytes : state.length;
      reset();
      return { droppedBytes };
    },
  };
}

/** 전송이 상대에게 직접 보내는 오류 응답(id null). F.wire-settings.spec §5: 프레임 초과는 -32600 `frameTooLarge`, JSON 오류는 -32700 */
function rejectionFrame(problem: FrameProblem): string {
  const error =
    problem === "frame_too_large"
      ? wireError("jsonrpc.invalidRequest", { details: { issue: "frameTooLarge" } })
      : wireError("jsonrpc.parseError");
  return JSON.stringify({ jsonrpc: "2.0", id: null, error: toJsonRpcError(error) });
}

const encoder = new TextEncoder();

type EncodeError = { readonly kind: "not_serializable" };

/** 메시지 하나를 `\n`으로 끝나는 UTF-8 한 줄로 만든다. 직렬화할 수 없는 값은 오류 값이다 */
function encodeFrame(
  message: unknown,
):
  | { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly error: EncodeError } {
  const text = attempt(() => stringify(message));
  if (!text.ok || text.value === undefined) {
    return { ok: false, error: { kind: "not_serializable" } };
  }
  return { ok: true, value: encoder.encode(`${text.value}\n`) };
}

/** JSON.stringify는 함수·undefined에는 문자열이 아니라 undefined를 돌려준다. 타입 선언에는 그 경우가 빠져 있다 */
function stringify(message: unknown): string | undefined {
  return JSON.stringify(message);
}

function encodeText(text: string): Uint8Array {
  return encoder.encode(`${text}\n`);
}

// L0.process.spec §4.1 stdio, L0.process.plan PR-03. JSON Lines 위의 Transport.
// - 수신 순서를 보존하고 처리기는 읽기 루프에서 동기로 부른다. 처리기가 없을 때 도착한 메시지는 첫 처리기가 붙을 때 비운다.
//   처리기가 없는 채로 EOF가 오면 쌓인 메시지를 먼저 비운 뒤에 닫힘을 알린다(onMessage 없이 onClose만 붙인 구독자는 close()를 부를 때까지 EOF를 받지 못한다).
// - 송신은 직렬화하고 앞 쓰기가 끝난 뒤(백프레셔: writer.ready) 다음을 쓴다.
// - EOF는 onClose({ reason: "eof" }). 끝에 줄바꿈 없이 남은 조각은 버리고 진단에 남긴다.
// - onClose는 한 번만 부른다. 그 뒤 send는 Error("transport closed")로 거부된다.

interface StdioTransportDeps {
  /** 진단(버린 조각, 처리기 실패)을 남긴다 */
  readonly logger?: Logger;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "non_error_thrown";
}

function noop(): void {
  // 쓰기 순서 꼬리를 값으로 잇는 용도다. 실패는 emitClose로 이미 보고했다.
}

function createStdioTransportWith(
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
