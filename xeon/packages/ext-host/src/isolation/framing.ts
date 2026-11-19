// 플러그인 호스트 프로토콜의 줄 단위 프레이밍. 엔진과 자식이 같이 쓴다(isolation-protocol.ts).
// 읽기는 바이트 스트림을 줄로 나누고 줄마다 JSON, 프레임 모양, 종류를 본다. 조각 알림(frame.begin, frame.part)은 모아서 원래 프레임 하나로 낸다.
// 쓰기는 프레임 하나를 줄 하나로 내고, 조각 옵션을 주면 상한을 넘는 줄을 조각으로 낸다(transfer-write.ts).
// 둘 다 던지지 않는다. 줄 하나가 틀리거나 상한을 넘으면 그 줄만 값으로 실패하고 다음 줄을 계속 읽는다.
import { attempt, attemptAsync, err, repeatAsync, type Result } from "@fresnel/contracts";
import { PLUGIN_HOST_MAX_FRAME_BYTES, type PluginHostFrame } from "@fresnel/contracts/extensions";
import { stringUtf8Sizes } from "@fresnel/contracts/records";
import { frameOfLine } from "./frame-line.ts";
import type {
  FrameReadResult,
  FrameSink,
  FrameWriteError,
  FrameWriterOptions,
} from "./framing-types.ts";
import { createTransferAssembler } from "./transfer-read.ts";
import { createOutbound } from "./transfer-write.ts";

export type {
  FrameReadError,
  FrameReadResult,
  FrameSink,
  FrameWriteError,
  FrameWriterOptions,
} from "./framing-types.ts";

const NEWLINE = 10;

/** 프레임을 하나씩 꺼내는 읽기. `next()`는 다음 결과를, 입력이 끝났으면 null을 돌려준다 */
export interface FrameReader {
  next(): Promise<FrameReadResult | null>;
}

export interface FrameReaderOptions {
  /**
   * 받을 수 있는 원래 줄의 최대 UTF-8 바이트 수. 없으면 조각 전송을 받지 않는다(시작 알림마다 `transfer_failed` `disabled`).
   * 줄 하나의 상한(`PLUGIN_HOST_MAX_FRAME_BYTES`)은 이와 상관없이 줄 분할이 지킨다
   */
  readonly maxTransferBytes?: number;
}

/** 바이트 덩어리를 줄 결과로 나누는 상태. 조각 알림도 줄 결과로 나오고, 읽는 쪽(transfer-read.ts)이 소비한다 */
interface LineSplitter {
  push(chunk: Uint8Array): readonly FrameReadResult[];
  finish(): readonly FrameReadResult[];
}

/** 바이트 덩어리를 줄로 나눈다. 줄 하나가 상한을 넘으면 `frame_too_large`를 한 번 내고 그 줄의 나머지를 버린다. 상한은 줄 끝을 뺀 바이트 수다 */
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

function joinParts(parts: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

/**
 * 바이트 스트림을 프레임 읽기 결과로 하나씩 꺼내게 한다. 입력이 끝나면 남은 줄을 내고 `null`을 돌려준다.
 * 조각 알림은 모아 원래 프레임 하나로 낸다(실패하면 `transfer_failed` 하나). 스트림 읽기 실패는 `read_failed` 값 하나로 내고 끝낸다
 * (TY-25: 받은 값을 `cause`에 담는다)
 */
export function createFrameReader(
  input: AsyncIterable<Uint8Array>,
  options: FrameReaderOptions = {},
): FrameReader {
  const splitter = lineSplitter();
  const assembler = createTransferAssembler(options.maxTransferBytes);
  const iterator = input[Symbol.asyncIterator]();
  const queue: FrameReadResult[] = [];
  let ended = false;

  function assembled(items: readonly FrameReadResult[]): readonly FrameReadResult[] {
    return items.flatMap((item) => assembler.accept(item));
  }

  // 순차 읽기가 목적이라 repeatAsync를 쓴다(no-await-in-loop 예외는 그 함수 한 곳이다, TY-22)
  function next(): Promise<FrameReadResult | null> {
    return repeatAsync<FrameReadResult | null>(async () => {
      const queued = queue.shift();
      if (queued !== undefined) return { value: queued };
      if (ended) return { value: null };
      const step = await attemptAsync(() => iterator.next());
      if (!step.ok) {
        ended = true;
        queue.push(err({ kind: "read_failed", cause: step.error.cause }), ...assembler.finish());
        return undefined;
      }
      if (step.value.done === true) {
        ended = true;
        queue.push(...assembled(splitter.finish()), ...assembler.finish());
        return undefined;
      }
      queue.push(...assembled(splitter.push(step.value.value)));
      return undefined;
    });
  }

  return { next };
}

/**
 * 자식이 받을 수 있는 원래 줄의 최대 UTF-8 바이트 수(조각 전송의 자식 쪽 상한). 자식은 `host.init` 응답의 `transfer`로 이것을 알리고,
 * 자식의 입력 읽기도 이 값을 상한으로 쓴다. 엔진은 자기 값과 이것 가운데 작은 값을 쓴다(supervisor.ts)
 */
/**
 * 자식의 조각 상한(바이트). 측정(AGE-59, 맥, bun 1.4.3): 자식의 최고 RSS는 받는 쪽 약 2.6배, 보내는 쪽 약 6배의 줄 크기다.
 * 256 MiB에서 최고 RSS가 1.3~1.8 GiB, 512 MiB에서 2.6~3.6 GiB라 1.5 GiB 기준을 넘는다. 128 MiB는 최고 0.7~0.95 GiB다.
 * 그래서 128 MiB로 둔다(docs/xeon/X/loading-trust/spec.md §4.9.3의 측정 표)
 */
export const PLUGIN_HOST_CHILD_TRANSFER_MAX_BYTES: number = 128 * 1024 * 1024;

/** 프레임 쓰기. `write`는 동기다. 줄 세워 나중에 나가는 프레임도 `ok`를 받는다 */
export interface FrameWriter {
  write(frame: PluginHostFrame): Result<void, FrameWriteError>;
  /**
   * 조각 전송의 상한을 바꾼다(`undefined`는 끄기). 협상이 끝나기 전에는 끄고 두며, 이후 `write`가 보는 상한만 바뀐다.
   * 이미 보내는 중인 전송은 그대로 끝낸다
   */
  setTransfer(maxBytes: number | undefined): void;
  /** 아직 나가지 않은 프레임 수. 보내는 중인 것을 포함한다 */
  pending(): number;
  /** 쓰기를 닫는다. 나가지 않은 프레임은 `onTransferFailed`로 알린다(프로세스가 죽었을 때) */
  abort(): void;
}

/**
 * 프레임 하나를 JSON 한 줄로 쓴다. 조각 전송이 꺼져 있으면 상한을 넘는 프레임은 보내지 않고 `frame_too_large`를 값으로 돌려준다.
 * 켜져 있으면 `transfer.maxBytes` 안의 큰 줄은 조각으로 나눠 FIFO로 보낸다. 쓰기 실패도 값이다
 */
export function createFrameWriter(sink: FrameSink, options: FrameWriterOptions = {}): FrameWriter {
  const outbound = createOutbound(sink, options);
  let transfer = options.transfer;
  return {
    write(frame) {
      const encoded = attempt(() => JSON.stringify(frame));
      if (!encoded.ok) return err({ kind: "encode_failed", cause: encoded.error.cause });
      const bytes = stringUtf8Sizes(encoded.value).utf8;
      if (
        bytes > PLUGIN_HOST_MAX_FRAME_BYTES &&
        (transfer === undefined || bytes > transfer.maxBytes)
      ) {
        return err({
          kind: "frame_too_large",
          max: transfer?.maxBytes ?? PLUGIN_HOST_MAX_FRAME_BYTES,
        });
      }
      return outbound.send({ frame, line: encoded.value, bytes });
    },
    setTransfer(maxBytes) {
      transfer = maxBytes === undefined ? undefined : { maxBytes };
    },
    pending: () => outbound.pending(),
    abort: () => outbound.abort(),
  };
}
