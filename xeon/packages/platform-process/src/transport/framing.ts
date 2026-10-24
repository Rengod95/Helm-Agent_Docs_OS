import { attempt, parseJson } from "@xeon/contracts";
import { toJsonRpcError, wireError, WIRE_LIMITS } from "@xeon/contracts/wire";

// L0.process.spec §4.1, L0.process.plan PR-02. JSON Lines 프레이밍: 줄 하나가 메시지 하나다.
// stdio와 socket 전송이 같은 구현을 쓴다. 바이트를 `\n`(0x0A)에서 먼저 자르고 줄 단위로 디코드한다.
// 다바이트 UTF-8 문자는 0x0A를 포함하지 않으므로 청크 경계에서 깨지지 않는다.

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** 프레임을 받아들이지 못한 이유. 연결은 유지하고 상대에게 오류 응답을 보낸다 */
export type FrameProblem = "frame_too_large" | "not_json";

export type FrameEvent =
  | { readonly kind: "message"; readonly value: unknown }
  | { readonly kind: "rejected"; readonly problem: FrameProblem };

export interface LineFramer {
  /** 바이트 조각 하나를 넣고, 그 조각이 완성한 프레임들을 도착 순서대로 돌려준다 */
  push(chunk: Uint8Array): readonly FrameEvent[];
  /** 스트림 끝(EOF). 줄바꿈 없이 남은 조각은 버리고 그 바이트 수를 돌려준다 */
  finish(): { readonly droppedBytes: number };
}

export interface LineFramerOptions {
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

export function createLineFramer(options: LineFramerOptions = {}): LineFramer {
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
export function rejectionFrame(problem: FrameProblem): string {
  const error =
    problem === "frame_too_large"
      ? wireError("jsonrpc.invalidRequest", { details: { issue: "frameTooLarge" } })
      : wireError("jsonrpc.parseError");
  return JSON.stringify({ jsonrpc: "2.0", id: null, error: toJsonRpcError(error) });
}

const encoder = new TextEncoder();

export type EncodeError = { readonly kind: "not_serializable" };

/** 메시지 하나를 `\n`으로 끝나는 UTF-8 한 줄로 만든다. 직렬화할 수 없는 값은 오류 값이다 */
export function encodeFrame(
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

export function encodeText(text: string): Uint8Array {
  return encoder.encode(`${text}\n`);
}
