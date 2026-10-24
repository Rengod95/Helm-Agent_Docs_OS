import { attemptAsync, parseJson } from "@xeon/contracts";
import {
  WIRE_LIMITS,
  type CloseInfo,
  type JsonRpcMessage,
  type StdioTransportFactory,
  type StdioTransportOptions,
  type Transport,
  type Unsubscribe,
} from "@xeon/contracts/wire";

// L4.host-service.spec §3.3.4 "전송 구현" 표, F.wire-settings.spec §5. JSON Lines: 줄 하나가 메시지 하나다.
// - `maxFrameBytes`를 넘는 줄은 끝까지 읽고 버린 뒤 `-32600 frameTooLarge`(id null)를 보낸다.
// - JSON이 아닌 줄은 `-32700`(id null)을 보내고 연결은 유지한다.
// - 읽기 끝(EOF)에서 `onClose({ reason: "eof" })`.

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function failureFrame(code: -32600 | -32700, message: string, issue: string | undefined): string {
  const data =
    issue === undefined
      ? { kind: "jsonrpc.parseError", retryable: false }
      : { kind: "jsonrpc.invalidRequest", retryable: false, details: { issue } };
  return JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message, data } });
}

function concat(parts: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function noop(): void {}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export const createStdioTransport: StdioTransportFactory = (
  options: StdioTransportOptions,
): Transport => {
  const maxFrameBytes = options.maxFrameBytes ?? WIRE_LIMITS.maxFrameBytes;
  const reader = options.readable.getReader();
  const writer = options.writable.getWriter();
  const messageHandlers = new Set<(message: unknown) => void>();
  const closeHandlers = new Set<(info: CloseInfo) => void>();
  const state: { closed: CloseInfo | undefined; started: boolean } = {
    closed: undefined,
    started: false,
  };
  /** 쓰기 순서를 지키는 꼬리. writer.write는 이미 순서를 지키지만 오류를 한 곳에서 모은다 */
  const tail: { current: Promise<void> } = { current: Promise.resolve() };

  function emitClose(info: CloseInfo): void {
    if (state.closed !== undefined) return;
    state.closed = info;
    for (const handler of Array.from(closeHandlers)) handler(info);
  }

  function writeLine(text: string): Promise<void> {
    if (state.closed !== undefined) return Promise.reject(new Error("stdio transport is closed"));
    const bytes = encoder.encode(`${text}\n`);
    const next = tail.current.then(() => writer.write(bytes));
    // 쓰기 실패는 닫힘 알림으로 한 번 보고한다. 순서 꼬리는 실패해도 이어지게 값으로 받는다
    tail.current = next.then(noop, (caught: unknown) => {
      emitClose({ reason: "error", message: messageOf(caught) });
    });
    return next;
  }

  /** 결과를 기다리지 않는 쓰기. 실패는 닫힘 알림으로 모은다(이미 닫혔으면 알림은 한 번뿐이다) */
  function writeDetached(text: string): void {
    writeLine(text).catch((caught: unknown) => {
      emitClose({ reason: "error", message: messageOf(caught) });
    });
  }

  function handleLine(bytes: Uint8Array): void {
    const end =
      bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN
        ? bytes.length - 1
        : bytes.length;
    if (end === 0) return;
    const text = decoder.decode(bytes.subarray(0, end));
    const decoded = parseJson(text);
    if (!decoded.ok) {
      writeDetached(failureFrame(-32700, "Parse error", undefined));
      return;
    }
    for (const handler of Array.from(messageHandlers)) handler(decoded.value);
  }

  /** 줄 하나(또는 버린 줄의 끝)를 처리한다. 청크 경계를 넘는 줄은 reader 상태가 이어받는다 */
  const reading: { parts: Uint8Array[]; length: number; discarding: boolean } = {
    parts: [],
    length: 0,
    discarding: false,
  };

  function consume(value: Uint8Array): void {
    let start = 0;
    while (start < value.length) {
      const newline = value.indexOf(NEWLINE, start);
      const stop = newline < 0 ? value.length : newline;
      const piece = value.subarray(start, stop);
      if (!reading.discarding) {
        if (reading.length + piece.length > maxFrameBytes) {
          reading.discarding = true;
          reading.parts = [];
          reading.length = 0;
        } else if (piece.length > 0) {
          reading.parts.push(piece);
          reading.length += piece.length;
        }
      }
      if (newline < 0) return;
      // 줄 끝
      if (reading.discarding) {
        reading.discarding = false;
        writeDetached(failureFrame(-32600, "Invalid Request", "frameTooLarge"));
      } else {
        const only = reading.parts.length === 1 ? reading.parts[0] : undefined;
        const line = only ?? concat(reading.parts, reading.length);
        reading.parts = [];
        reading.length = 0;
        handleLine(line);
      }
      start = newline + 1;
    }
  }

  /** 읽기를 하나씩 이어 간다. 약속 사슬을 늘리지 않으려고 재귀 대신 then 콜백에서 다음 읽기를 건다 */
  function readNext(): void {
    reader.read().then(
      (chunk) => {
        if (chunk.done) {
          // EOF: 끝나지 않은 마지막 줄은 버린다(완전한 줄만 메시지다)
          emitClose({ reason: "eof" });
          return undefined;
        }
        consume(chunk.value);
        readNext();
        return undefined;
      },
      (caught: unknown) => {
        emitClose({ reason: "error", message: messageOf(caught) });
      },
    );
  }

  /** 핸들러가 붙기 전에 읽은 메시지가 사라지지 않도록, 첫 구독이 생길 때 읽기를 시작한다 */
  function ensureStarted(): void {
    if (state.started) return;
    state.started = true;
    readNext();
  }

  return {
    kind: "stdio",
    send(message: JsonRpcMessage): Promise<void> {
      return writeLine(JSON.stringify(message));
    },
    onMessage(handler): Unsubscribe {
      messageHandlers.add(handler);
      ensureStarted();
      return () => {
        messageHandlers.delete(handler);
      };
    },
    onClose(handler): Unsubscribe {
      ensureStarted();
      if (state.closed !== undefined) {
        const info = state.closed;
        queueMicrotask(() => {
          handler(info);
        });
      } else {
        closeHandlers.add(handler);
      }
      return () => {
        closeHandlers.delete(handler);
      };
    },
    async close(reason) {
      if (state.closed !== undefined) return;
      emitClose({ reason: "local", ...(reason === undefined ? {} : { message: reason }) });
      // 이미 오류로 끝난 스트림의 cancel·close 실패는 위 emitClose로 알렸다. 결과는 값으로 받고 쓰지 않는다
      await attemptAsync(() => reader.cancel());
      await tail.current;
      await attemptAsync(() => writer.close());
    },
  };
};
