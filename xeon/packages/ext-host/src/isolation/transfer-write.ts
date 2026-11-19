// 조각 전송의 보내는 쪽(AGE-59). 줄을 한 방향에서 들어온 순서대로(FIFO) 내보내고, 상한을 넘는 줄은 `frame.begin`과 `frame.part`로 나눠 보낸다.
// 쓰기는 한 번에 조각 하나다. 조각을 쓴 뒤 받는 쪽이 비워질 때까지 기다리고, 기다림이 `stallMs`를 넘으면 그 프레임의 전송을 접는다.
// 줄 세운 동안 펌프가 쥐는 것은 지금 보내는 프레임의 줄 글과 조각 하나뿐이다.
import { createHash } from "node:crypto";
import {
  attempt,
  attemptAsync,
  detach,
  eachAsync,
  err,
  ok,
  rethrow,
  repeatAsync,
  type Result,
} from "@fresnel/contracts";
import {
  PLUGIN_HOST_MAX_FRAME_BYTES,
  PLUGIN_HOST_TRANSFER_BEGIN,
  PLUGIN_HOST_TRANSFER_PART,
  PLUGIN_HOST_TRANSFER_PART_CHARS,
  PLUGIN_HOST_TRANSFER_STALL_MS,
  type PluginHostFrame,
  type PluginHostTransferBegin,
  type PluginHostTransferFrameKind,
} from "@fresnel/contracts/extensions";
import type { FrameSink, FrameWriteError, FrameWriterOptions } from "./framing-types.ts";

/** 보낼 줄 하나. `line`은 줄 끝을 뺀 JSON 글이고 `bytes`는 그 UTF-8 바이트 수다 */
interface OutboundLine {
  readonly frame: PluginHostFrame;
  readonly line: string;
  readonly bytes: number;
}

export interface Outbound {
  /** 줄 하나를 보낸다. 바로 쓸 수 있으면 쓰고 그 결과를, 줄 세워야 하면 `ok`를 돌려준다 */
  send(item: OutboundLine): Result<void, FrameWriteError>;
  /** 아직 나가지 않은 프레임 수. 보내는 중인 것을 포함한다 */
  pending(): number;
  /** 쓰기를 닫는다. 줄 세운 것과 보내는 중인 것은 `write_failed`로 알리고, 이후 쓰기는 실패한다 */
  abort(): void;
}

/** 원래 줄 글의 구간. 조각 글은 이 구간을 잘라 그때그때만 만든다 */
interface Span {
  readonly start: number;
  readonly end: number;
}

const ABORTED = "the writer was aborted";
const ABORTED_FAILURE: FrameWriteError = { kind: "write_failed", cause: ABORTED };
const NOTHING_TO_CANCEL = (): void => undefined;

/** 쓰기 펌프를 만든다. `sink`에는 줄을 쓰고, `options`의 조각 설정과 실패 알림을 따른다 */
export function createOutbound(sink: FrameSink, options: FrameWriterOptions): Outbound {
  const stallMs = options.stallMs ?? PLUGIN_HOST_TRANSFER_STALL_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const queue: OutboundLine[] = [];
  /** 펌프가 지금 보내는 줄. `abort`가 알릴 수 있게 든다 */
  let current: OutboundLine | undefined;
  let running = false;
  let closed = false;
  /** 시작 알림마다 올린다. 보내는 쪽 안에서 전송 번호가 겹치지 않는다 */
  let transfers = 0;

  /** 줄 하나를 바로 쓴다. 쓰기가 던지면 `write_failed` 값이다 */
  function writeLine(text: string): FrameWriteError | undefined {
    const written = attempt(() => sink.write(`${text}\n`));
    return written.ok ? undefined : { kind: "write_failed", cause: written.error.cause };
  }

  function send(item: OutboundLine): Result<void, FrameWriteError> {
    if (closed) return err({ kind: "write_failed", cause: ABORTED });
    // 펌프가 쉬고 있고 앞선 줄이 없을 때만 바로 쓴다. 그 밖의 줄은 뒤에 세운다(FIFO)
    if (!running && queue.length === 0 && item.bytes <= PLUGIN_HOST_MAX_FRAME_BYTES) {
      const failure = writeLine(item.line);
      return failure === undefined ? ok(undefined) : err(failure);
    }
    queue.push(item);
    if (!running) {
      running = true;
      detach(pump(), pumpFailed);
    }
    return ok(undefined);
  }

  /** 펌프가 던졌다(호출자의 `onTransferFailed`가 던진 경우다). 상태를 풀고 원인을 그대로 다시 던진다(TY-25) */
  function pumpFailed(cause: unknown): never {
    running = false;
    return rethrow(cause);
  }

  /** 줄 세운 것을 차례로 보낸다. 앞 줄이 끝나야 다음 줄을 꺼낸다. 비면 `running`을 바로 내린다 */
  async function pump(): Promise<void> {
    await repeatAsync<void>(async () => {
      const item = queue.shift();
      if (item === undefined) {
        running = false;
        return { value: undefined };
      }
      const failure = await deliver(item);
      if (failure === undefined || closed) return undefined;
      options.onTransferFailed?.(item.frame, failure);
      // 쓰기가 던졌으면 싱크를 믿지 못한다. 줄 세운 것을 모두 같은 이유로 알리고 펌프를 끝낸다
      if (failure.kind === "write_failed") failQueued(failure);
      return undefined;
    });
  }

  /** 줄 하나를 보낸다. 큰 줄은 조각 전송으로 보낸다. 보내는 중인 줄을 `current`에 둔다 */
  async function deliver(item: OutboundLine): Promise<FrameWriteError | undefined> {
    current = item;
    const failure =
      item.bytes > PLUGIN_HOST_MAX_FRAME_BYTES ? await deliverTransfer(item) : writeLine(item.line);
    current = undefined;
    return failure;
  }

  /** 큰 줄 하나의 전송을 알린다. 시작 알림을 쓰기 전에 `onTransferStart`, 끝나면 `onTransferEnd`를 부른다 */
  async function deliverTransfer(item: OutboundLine): Promise<FrameWriteError | undefined> {
    options.onTransferStart?.(item.frame);
    const failure = await sendTransfer(item);
    options.onTransferEnd?.(item.frame, failure === undefined);
    return failure;
  }

  /** 큰 줄 하나를 시작 알림과 조각들로 보낸다 */
  async function sendTransfer(item: OutboundLine): Promise<FrameWriteError | undefined> {
    const plan = planTransfer(item.line);
    const x = transfers;
    transfers += 1;
    const begun = writeLine(
      JSON.stringify({
        method: PLUGIN_HOST_TRANSFER_BEGIN,
        params: beginOf(item, x, plan.sha256, plan.spans.length),
      }),
    );
    if (begun !== undefined) return begun;
    const sent = await sendParts(item.line, plan.spans, x);
    return sent;
  }

  /** 조각을 하나씩 쓴다. 조각 하나를 쓴 뒤 받는 쪽이 비워지기를 기다린다. 중단되면 그 전송을 접는다 */
  async function sendParts(
    line: string,
    spans: readonly Span[],
    x: number,
  ): Promise<FrameWriteError | undefined> {
    const outcome = await eachAsync(spans.entries(), async ([i, span]) => {
      if (closed) return { value: ABORTED_FAILURE };
      const failure = writeLine(partLine(x, i, line.slice(span.start, span.end)));
      if (failure !== undefined) return { value: failure };
      const stalled = await drainedWithin();
      return stalled === undefined ? undefined : { value: stalled };
    });
    return outcome?.value;
  }

  /**
   * 받는 쪽이 비워질 때까지 기다린다. `stallMs`를 넘으면 `transfer_stalled`다. `drained`가 없는 싱크는 바로 비워진 것으로 본다.
   * 기다림의 시계는 끝나면 취소한다
   */
  function drainedWithin(): Promise<FrameWriteError | undefined> {
    if (sink.drained === undefined) return Promise.resolve(undefined);
    let cancel: () => void = NOTHING_TO_CANCEL;
    const stalled = new Promise<FrameWriteError>((resolve) => {
      const armed = attempt(() => setTimer(stallMs, () => resolve({ kind: "transfer_stalled" })));
      if (armed.ok) cancel = armed.value;
      else resolve({ kind: "write_failed", cause: armed.error.cause });
    });
    const drained = attemptAsync(async () => {
      await sink.drained?.();
    }).then((result): FrameWriteError | undefined =>
      result.ok ? undefined : { kind: "write_failed", cause: result.error.cause },
    );
    return Promise.race([drained, stalled]).finally(cancel);
  }

  /** 쓰기가 던진 뒤 줄 세운 것을 모두 같은 이유로 알리고 비운다 */
  function failQueued(failure: FrameWriteError): void {
    for (const item of queue.splice(0)) options.onTransferFailed?.(item.frame, failure);
  }

  function abort(): void {
    if (closed) return;
    closed = true;
    const inFlight = current === undefined ? [] : [current];
    current = undefined;
    for (const item of [...inFlight, ...queue.splice(0)]) {
      options.onTransferFailed?.(item.frame, { kind: "write_failed", cause: ABORTED });
    }
  }

  return {
    send,
    pending: () => queue.length + (current === undefined ? 0 : 1),
    abort,
  };
}

/** 원래 줄을 조각 구간으로 나누고 전체 해시를 낸다. 글은 한 번 훑으며 조각 하나씩 해시에 넣는다 */
function planTransfer(line: string): { readonly spans: readonly Span[]; readonly sha256: string } {
  const hash = createHash("sha256");
  const spans: Span[] = [];
  let start = 0;
  while (start < line.length) {
    const end = partEnd(line, start);
    hash.update(line.slice(start, end));
    spans.push({ start, end });
    start = end;
  }
  return { spans, sha256: hash.digest("hex") };
}

/** 조각의 끝. 마지막 글자가 서로게이트 쌍의 앞쪽이면 한 글자 앞에서 끊어 쌍을 가르지 않는다 */
function partEnd(line: string, start: number): number {
  const limit = Math.min(start + PLUGIN_HOST_TRANSFER_PART_CHARS, line.length);
  const splitsPair =
    limit < line.length && limit - 1 > start && isHighSurrogate(line.charCodeAt(limit - 1));
  return splitsPair ? limit - 1 : limit;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function beginOf(
  item: OutboundLine,
  x: number,
  sha256: string,
  parts: number,
): PluginHostTransferBegin {
  return {
    x,
    size: item.bytes,
    parts,
    sha256,
    ...tagOf(item.frame),
  };
}

function partLine(x: number, i: number, data: string): string {
  return JSON.stringify({ method: PLUGIN_HOST_TRANSFER_PART, params: { x, i, data } });
}

/** 프레임의 `id`와 요청인지 답인지. 알림(id가 없다)은 빈 표시다 */
function tagOf(frame: PluginHostFrame): {
  readonly frameId?: number;
  readonly frameKind?: PluginHostTransferFrameKind;
} {
  if (!("id" in frame)) return {};
  return { frameId: frame.id, frameKind: "method" in frame ? "request" : "response" };
}

function defaultSetTimer(ms: number, fn: () => void): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}
