// 플러그인 호스트 프로토콜의 줄 단위 프레이밍. 엔진과 자식이 같이 쓴다(isolation-protocol.ts).
// 읽기는 바이트 스트림을 줄로 나누고 줄마다 JSON, 프레임 모양, 종류를 본다. 쓰기는 프레임 하나를 줄 하나로 낸다.
// 둘 다 던지지 않는다. 줄 하나가 틀리거나 상한을 넘으면 그 줄만 값으로 실패하고 다음 줄을 계속 읽는다.
import {
  attempt,
  attemptAsync,
  err,
  ok,
  parse,
  parseJson,
  repeatAsync,
  type JsonParseError,
  type Result,
} from "@fresnel/contracts";
import {
  classifyFrame,
  PLUGIN_HOST_MAX_FRAME_BYTES,
  RawPluginHostFrameSchema,
  type ClassifiedFrame,
  type PluginHostFrame,
} from "@fresnel/contracts/extensions";

/** 프레임 읽기 실패. 값이다. `frame_too_large`는 상한을 넘은 줄을 버렸다는 뜻이다 */
export type FrameReadError =
  | { readonly kind: "frame_too_large"; readonly max: number }
  | JsonParseError
  | { readonly kind: "invalid_frame"; readonly cause: unknown }
  | { readonly kind: "read_failed"; readonly cause: unknown };

export type FrameReadResult = Result<ClassifiedFrame, FrameReadError>;

/** 줄을 받는 쪽. 줄 끝 `\n`은 쓰는 쪽(createFrameWriter)이 붙인다 */
export interface FrameSink {
  write(line: string): void;
}

export type FrameWriteError =
  | { readonly kind: "frame_too_large"; readonly max: number }
  | { readonly kind: "encode_failed"; readonly cause: unknown }
  | { readonly kind: "write_failed"; readonly cause: unknown };

export interface FrameWriter {
  write(frame: PluginHostFrame): Result<void, FrameWriteError>;
}

const NEWLINE = 10;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** 줄 하나(줄 끝 제외)의 바이트를 프레임으로 본다. 빈 줄은 프레임이 아니다 */
function frameOfLine(bytes: Uint8Array): FrameReadResult | undefined {
  if (bytes.byteLength === 0) return undefined;
  const json = parseJson(decoder.decode(bytes));
  if (!json.ok) return err(json.error);
  const raw = parse(RawPluginHostFrameSchema, json.value);
  if (!raw.ok) return err({ kind: "invalid_frame", cause: raw.error });
  const classified = classifyFrame(raw.value);
  if (!classified.ok) return err({ kind: "invalid_frame", cause: classified.error });
  return ok(classified.value);
}

function joinParts(parts: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

interface LineSplitter {
  push(chunk: Uint8Array): readonly FrameReadResult[];
  finish(): readonly FrameReadResult[];
}

/**
 * 바이트 덩어리를 줄로 나눈다. 줄 하나가 상한을 넘으면 `frame_too_large`를 한 번 내고 그 줄의 나머지를 버린다.
 * 상한은 줄 끝을 뺀 바이트 수다(`PLUGIN_HOST_MAX_FRAME_BYTES`)
 */
function lineSplitter(): LineSplitter {
  const max = PLUGIN_HOST_MAX_FRAME_BYTES;
  let parts: Uint8Array[] = [];
  let size = 0;
  // 상한을 넘은 줄을 버리는 중. 줄 끝이 오면 해제한다
  let discarding = false;

  function take(last: Uint8Array): FrameReadResult | undefined {
    const bytes = joinParts([...parts, last], size + last.byteLength);
    parts = [];
    size = 0;
    return frameOfLine(bytes);
  }

  function push(chunk: Uint8Array): readonly FrameReadResult[] {
    const out: FrameReadResult[] = [];
    let start = 0;
    let newline = chunk.indexOf(NEWLINE, start);
    while (newline !== -1) {
      const segment = chunk.subarray(start, newline);
      if (discarding) {
        discarding = false;
      } else if (size + segment.byteLength > max) {
        out.push(err({ kind: "frame_too_large", max }));
        parts = [];
        size = 0;
      } else {
        const frame = take(segment);
        if (frame !== undefined) out.push(frame);
      }
      start = newline + 1;
      newline = chunk.indexOf(NEWLINE, start);
    }
    const rest = chunk.subarray(start);
    if (discarding || rest.byteLength === 0) return out;
    if (size + rest.byteLength > max) {
      out.push(err({ kind: "frame_too_large", max }));
      parts = [];
      size = 0;
      discarding = true;
      return out;
    }
    parts.push(rest.slice());
    size += rest.byteLength;
    return out;
  }

  function finish(): readonly FrameReadResult[] {
    if (discarding) {
      discarding = false;
      return [];
    }
    if (size === 0) return [];
    const frame = take(new Uint8Array(0));
    return frame === undefined ? [] : [frame];
  }

  return { push, finish };
}

/** 프레임을 하나씩 꺼내는 읽기. `next()`는 다음 결과를, 입력이 끝났으면 null을 돌려준다 */
export interface FrameReader {
  next(): Promise<FrameReadResult | null>;
}

/**
 * 바이트 스트림을 프레임 읽기 결과로 하나씩 꺼내게 한다. 입력이 끝나면 남은 줄을 내고 `null`을 돌려준다.
 * 스트림 읽기 실패는 `read_failed` 값 하나로 내고 끝낸다(TY-25: 받은 값을 `cause`에 담는다)
 */
export function createFrameReader(input: AsyncIterable<Uint8Array>): FrameReader {
  const splitter = lineSplitter();
  const iterator = input[Symbol.asyncIterator]();
  const queue: FrameReadResult[] = [];
  let ended = false;

  // 순차 읽기가 목적이라 repeatAsync를 쓴다(no-await-in-loop 예외는 그 함수 한 곳이다, TY-22)
  function next(): Promise<FrameReadResult | null> {
    return repeatAsync<FrameReadResult | null>(async () => {
      const queued = queue.shift();
      if (queued !== undefined) return { value: queued };
      if (ended) return { value: null };
      const step = await attemptAsync(() => iterator.next());
      if (!step.ok) {
        ended = true;
        return { value: err({ kind: "read_failed", cause: step.error.cause }) };
      }
      if (step.value.done === true) {
        ended = true;
        queue.push(...splitter.finish());
        return undefined;
      }
      queue.push(...splitter.push(step.value.value));
      return undefined;
    });
  }

  return { next };
}

/**
 * 프레임 하나를 JSON 한 줄로 쓴다. 상한을 넘는 프레임은 보내지 않고 `frame_too_large`를 값으로 돌려준다
 * (나눠 보내기와 참조 넘기기는 하지 않는다). 쓰기 실패도 값이다
 */
export function createFrameWriter(sink: FrameSink): FrameWriter {
  return {
    write(frame) {
      const encoded = attempt(() => JSON.stringify(frame));
      if (!encoded.ok) return err({ kind: "encode_failed", cause: encoded.error.cause });
      if (encoder.encode(encoded.value).byteLength > PLUGIN_HOST_MAX_FRAME_BYTES) {
        return err({ kind: "frame_too_large", max: PLUGIN_HOST_MAX_FRAME_BYTES });
      }
      const written = attempt(() => sink.write(`${encoded.value}\n`));
      return written.ok ? ok(undefined) : err({ kind: "write_failed", cause: written.error.cause });
    },
  };
}
