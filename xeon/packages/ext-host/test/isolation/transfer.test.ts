import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ok, repeatAsync } from "@fresnel/contracts";
import {
  PLUGIN_HOST_MAX_FRAME_BYTES,
  PLUGIN_HOST_TRANSFER_PART_CHARS,
  type PluginHostFrame,
} from "@fresnel/contracts/extensions";
import {
  createFrameReader,
  createFrameWriter,
  type FrameReader,
  type FrameReaderOptions,
  type FrameReadResult,
  type FrameWriterOptions,
} from "../../src/isolation/framing.ts";
import { memoryInput, type MemoryInput } from "./support/host.ts";

const MAX = PLUGIN_HOST_MAX_FRAME_BYTES;
const MIB = 1024 * 1024;
const encoder = new TextEncoder();

// ── 시험 도구 ─────────────────────────────────────────────────────────────

function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** 조각 구간. 쓰는 쪽과 따로 짠다(와이어 모양과 서로게이트 규칙을 시험이 고정한다) */
function spansOf(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + PLUGIN_HOST_TRANSFER_PART_CHARS, text.length);
    if (end < text.length && end - 1 > start && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    spans.push([start, end]);
    start = end;
  }
  return spans;
}

function beginLine(begin: {
  readonly x: number;
  readonly size: number;
  readonly parts: number;
  readonly sha256: string;
  readonly frameId: number | undefined;
}): string {
  return JSON.stringify({ method: "frame.begin", params: begin });
}

function partLine(x: number, i: number, data: string): string {
  return JSON.stringify({ method: "frame.part", params: { x, i, data } });
}

/** 원래 줄 글을 시작 알림과 조각 줄들로 바꾼다. 줄 끝은 붙이지 않는다 */
function transferLines(text: string, x: number, frameId: number | undefined): string[] {
  const spans = spansOf(text);
  const begin = beginLine({
    x,
    size: utf8Bytes(text),
    parts: spans.length,
    sha256: sha256Of(text),
    frameId,
  });
  return [begin, ...spans.map(([start, end], i) => partLine(x, i, text.slice(start, end)))];
}

/** 읽기 결과를 종류와 핵심 필드만 남긴다. 큰 값은 비교에 들이지 않는다 */
function summaryOf(result: FrameReadResult): unknown {
  if (!result.ok) {
    const error = result.error;
    return error.kind === "transfer_failed"
      ? { error: error.kind, reason: error.reason, frameId: error.frameId }
      : { error: error.kind };
  }
  const frame = result.value;
  if (frame.kind === "request") return { kind: frame.kind, id: frame.id, method: frame.method };
  if (frame.kind === "notification") return { kind: frame.kind, method: frame.method };
  return { kind: frame.kind, id: frame.id };
}

/** 읽기를 끝까지(또는 `limit`개까지) 모은다 */
async function collect(reader: FrameReader, limit?: number): Promise<FrameReadResult[]> {
  const seen: FrameReadResult[] = [];
  await repeatAsync<void>(async () => {
    if (limit !== undefined && seen.length >= limit) return { value: undefined };
    const item = await reader.next();
    if (item === null) return { value: undefined };
    seen.push(item);
    return undefined;
  });
  return seen;
}

/** 줄들을 입력에 넣고 입력을 닫은 뒤 끝까지 읽는다 */
async function readLines(
  lines: readonly string[],
  options: FrameReaderOptions = {},
): Promise<FrameReadResult[]> {
  const input = memoryInput();
  for (const line of lines) input.push(`${line}\n`);
  input.end();
  return collect(createFrameReader(input, options));
}

/**
 * 쓰기와 읽기를 잇는다. 쓴 줄은 바로 입력으로 들어가고, 읽는 쪽이 `count`개 결과를 받을 때까지 기다린다.
 * 쓰기는 펌프가 비동기로 나가므로 결과 개수로 끝을 맞춘다
 */
async function pipe(
  frames: readonly PluginHostFrame[],
  count: number,
  writerOptions: FrameWriterOptions,
  readerOptions: FrameReaderOptions = {},
): Promise<{ lines: string[]; results: FrameReadResult[]; writes: string[] }> {
  const input: MemoryInput = memoryInput();
  const lines: string[] = [];
  const writer = createFrameWriter(
    {
      write: (line) => {
        lines.push(line);
        input.push(line);
      },
    },
    writerOptions,
  );
  const writes = frames.map((frame) => {
    const written = writer.write(frame);
    return written.ok ? "ok" : written.error.kind;
  });
  const results = await collect(createFrameReader(input, readerOptions), count);
  input.end();
  return { lines, results, writes };
}

function bigAscii(chars: number): string {
  return "a".repeat(chars);
}

/** 한 번 열리는 문. `release`를 부르면 `open`이 풀린다 */
function gate(): { readonly open: Promise<void>; readonly release: () => void } {
  let release: (() => void) | undefined;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    open,
    release: () => {
      release?.();
    },
  };
}

// ── 쓰기와 읽기의 왕복 ───────────────────────────────────────────────────

describe("frame transfer round trip", () => {
  test("a 40 MiB ASCII request comes back as one frame", async () => {
    const text = bigAscii(40 * MIB);
    const frame: PluginHostFrame = { id: 1, method: "drive.step", params: { text } };
    const piped = await pipe(
      [frame],
      1,
      { transfer: { maxBytes: 64 * MIB } },
      { maxTransferBytes: 64 * MIB },
    );
    expect(piped.writes).toEqual(["ok"]);
    expect(piped.lines[0]?.startsWith('{"method":"frame.begin"')).toBe(true);
    expect(piped.results).toEqual([
      ok({ kind: "request", id: 1, method: "drive.step", params: { text } }),
    ]);
  });

  test("a 20 MiB Korean and emoji response keeps a surrogate pair that straddles the part boundary", async () => {
    // 줄 글의 P-1번째 글자가 서로게이트 쌍의 앞쪽이 되게 짠다(P는 조각 글자 수). 줄 앞머리 길이만큼 빼서 맞춘다
    const emoji = "\u{1F600}";
    const prefix = JSON.stringify({ id: 2, result: { text: "" } }).length - 3;
    const text =
      bigAscii(PLUGIN_HOST_TRANSFER_PART_CHARS - 1 - prefix) + emoji + "가".repeat(7_000_000);
    const frame: PluginHostFrame = { id: 2, result: { text } };
    const json = JSON.stringify(frame);
    expect(isHighSurrogate(json.charCodeAt(PLUGIN_HOST_TRANSFER_PART_CHARS - 1))).toBe(true);
    const piped = await pipe(
      [frame],
      1,
      { transfer: { maxBytes: 64 * MIB } },
      { maxTransferBytes: 64 * MIB },
    );
    // 쓰는 쪽의 줄 모양은 시험의 조각 구간과 같다(첫 조각은 쌍 앞에서 끊는다)
    const expected = transferLines(json, 0, 2).map((line) => `${line}\n`);
    expect(piped.lines).toEqual(expected);
    expect(piped.results).toEqual([ok({ kind: "response", id: 2, result: { text } })]);
  });

  test("a 30 MiB nested object with many small leaves comes back equal", async () => {
    const items = Array.from({ length: 700_000 }, (_, i) => ({
      n: i,
      s: `leaf-${i}`,
      on: i % 2 === 0,
    }));
    const frame: PluginHostFrame = { id: 3, method: "drive.step", params: { items } };
    const piped = await pipe(
      [frame],
      1,
      { transfer: { maxBytes: 64 * MIB } },
      { maxTransferBytes: 64 * MIB },
    );
    expect(piped.results).toEqual([
      ok({ kind: "request", id: 3, method: "drive.step", params: { items } }),
    ]);
  });

  test("response, notification and failure shapes reassemble as their own kinds", async () => {
    const big = bigAscii(MAX);
    const failureText = `{"id":5,${" ".repeat(MAX)}"error":{"kind":"handler_threw","message":"m"}}`;
    const lines = [
      ...transferLines(JSON.stringify({ id: 4, result: { big } }), 0, 4),
      ...transferLines(JSON.stringify({ method: "event.notify", params: { big } }), 1, undefined),
      ...transferLines(failureText, 2, 5),
    ];
    const results = await readLines(lines, { maxTransferBytes: 64 * MIB });
    expect(results).toEqual([
      ok({ kind: "response", id: 4, result: { big } }),
      ok({ kind: "notification", method: "event.notify", params: { big } }),
      ok({ kind: "failure", id: 5, error: { kind: "handler_threw", message: "m" } }),
    ]);
  });

  test("a line of exactly the cap stays one frame and one more byte becomes a transfer", async () => {
    const base = JSON.stringify({ method: "event.notify", params: { s: "" } }).length;
    const exact: PluginHostFrame = { method: "event.notify", params: { s: bigAscii(MAX - base) } };
    const overParams = { s: bigAscii(MAX - base + 1) };
    const over: PluginHostFrame = { method: "event.notify", params: overParams };
    const single = await pipe(
      [exact],
      1,
      { transfer: { maxBytes: 64 * MIB } },
      { maxTransferBytes: 64 * MIB },
    );
    expect(single.lines).toHaveLength(1);
    expect(single.lines[0]?.startsWith('{"method":"event.notify"')).toBe(true);
    const split = await pipe(
      [over],
      1,
      { transfer: { maxBytes: 64 * MIB } },
      { maxTransferBytes: 64 * MIB },
    );
    expect(split.lines[0]?.startsWith('{"method":"frame.begin"')).toBe(true);
    expect(split.results).toEqual([
      ok({ kind: "notification", method: "event.notify", params: overParams }),
    ]);
  });
});

// ── 쓰는 쪽의 상한과 순서 ────────────────────────────────────────────────

describe("frame transfer writer limits", () => {
  test("without the transfer option a 17 MiB frame is frame_too_large and nothing is written", () => {
    const lines: string[] = [];
    const writer = createFrameWriter({
      write: (line) => {
        lines.push(line);
      },
    });
    const frame: PluginHostFrame = {
      id: 1,
      method: "drive.step",
      params: { text: bigAscii(17 * MIB) },
    };
    expect(writer.write(frame)).toEqual({
      ok: false,
      error: { kind: "frame_too_large", max: MAX },
    });
    expect(lines).toEqual([]);
    expect(writer.pending()).toBe(0);
  });

  test("a frame over the peer's transfer limit is frame_too_large with that limit as max", () => {
    const writer = createFrameWriter(
      { write: () => undefined },
      { transfer: { maxBytes: 16 * MIB + 1024 } },
    );
    const frame: PluginHostFrame = {
      id: 1,
      method: "drive.step",
      params: { text: bigAscii(17 * MIB) },
    };
    expect(writer.write(frame)).toEqual({
      ok: false,
      error: { kind: "frame_too_large", max: 16 * MIB + 1024 },
    });
  });

  test("small frames queued behind a large one keep the write order", async () => {
    const big = bigAscii(17 * MIB);
    const frames: PluginHostFrame[] = [
      { id: 1, method: "drive.step", params: { text: big } },
      { id: 2, method: "tool.execute", params: { small: true } },
      { id: 3, method: "drive.step", params: { text: big } },
      { method: "event.notify", params: { small: true } },
      { id: 5, result: null },
    ];
    const input = memoryInput();
    const writer = createFrameWriter(
      { write: (line) => input.push(line) },
      { transfer: { maxBytes: 64 * MIB } },
    );
    for (const frame of frames) writer.write(frame);
    expect(writer.pending()).toBe(frames.length);
    // 펌프는 비동기로 나간다. 다섯 결과를 다 받은 뒤에 입력을 닫는다
    const results = await collect(
      createFrameReader(input, { maxTransferBytes: 64 * MIB }),
      frames.length,
    );
    input.end();
    expect(results.map(summaryOf)).toEqual([
      { kind: "request", id: 1, method: "drive.step" },
      { kind: "request", id: 2, method: "tool.execute" },
      { kind: "request", id: 3, method: "drive.step" },
      { kind: "notification", method: "event.notify" },
      { kind: "response", id: 5 },
    ]);
  });

  test("each part waits for the sink to drain: no write happens while a drain is outstanding", async () => {
    let waiting = false;
    let drainCalls = 0;
    let writesWhileWaiting = 0;
    const input = memoryInput();
    const sink = {
      write(line: string): void {
        if (waiting) writesWhileWaiting += 1;
        input.push(line);
      },
      drained(): Promise<void> {
        drainCalls += 1;
        waiting = true;
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            waiting = false;
            resolve();
          }, 0);
        });
      },
    };
    const text = bigAscii(40 * MIB);
    const frame: PluginHostFrame = { id: 1, method: "drive.step", params: { text } };
    const writer = createFrameWriter(sink, { transfer: { maxBytes: 64 * MIB } });
    expect(writer.write(frame)).toEqual(ok(undefined));
    const results = await collect(createFrameReader(input, { maxTransferBytes: 64 * MIB }), 1);
    input.end();
    expect(writesWhileWaiting).toBe(0);
    expect(drainCalls).toBe(spansOf(JSON.stringify(frame)).length);
    expect(results.map(summaryOf)).toEqual([{ kind: "request", id: 1, method: "drive.step" }]);
  });

  test("a stalled sink fails only that frame as transfer_stalled and the next small frame still flows", async () => {
    const input = memoryInput();
    const failures: { id: number | undefined; kind: string }[] = [];
    let drainCall = 0;
    const sink = {
      write(line: string): void {
        input.push(line);
      },
      drained(): Promise<void> {
        drainCall += 1;
        // 첫 기다림만 멈춘다
        return drainCall === 1 ? new Promise<void>(() => undefined) : Promise.resolve();
      },
    };
    const writer = createFrameWriter(sink, {
      transfer: { maxBytes: 64 * MIB },
      stallMs: 5,
      setTimer: (ms, fn) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      onTransferFailed: (frame, error) => {
        failures.push({ id: "id" in frame ? frame.id : undefined, kind: error.kind });
      },
    });
    const big: PluginHostFrame = {
      id: 1,
      method: "drive.step",
      params: { text: bigAscii(17 * MIB) },
    };
    const small: PluginHostFrame = { method: "event.notify", params: { small: true } };
    expect(writer.write(big)).toEqual(ok(undefined));
    expect(writer.write(small)).toEqual(ok(undefined));
    const results = await collect(createFrameReader(input, { maxTransferBytes: 64 * MIB }), 2);
    input.end();
    expect(failures).toEqual([{ id: 1, kind: "transfer_stalled" }]);
    // 받는 쪽은 시작과 첫 조각을 받았고, 다음 정상 줄에서 순번 오류로 끝난다
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 1 },
      { kind: "notification", method: "event.notify" },
    ]);
  });

  test("a sink whose write throws fails the in-flight and queued frames and the writer stays usable", async () => {
    const input = memoryInput();
    const failures: { id: number | undefined; kind: string }[] = [];
    const failed = gate();
    const sink = {
      write(line: string): void {
        // 첫 큰 프레임의 둘째 조각에서 싱크가 끊긴다
        if (line.startsWith('{"method":"frame.part","params":{"x":0,"i":1,')) {
          throw new Error("pipe closed");
        }
        input.push(line);
      },
    };
    const writer = createFrameWriter(sink, {
      transfer: { maxBytes: 64 * MIB },
      onTransferFailed: (frame, error) => {
        failures.push({ id: "id" in frame ? frame.id : undefined, kind: error.kind });
        if (failures.length === 3) failed.release();
      },
    });
    const big = (id: number): PluginHostFrame => ({
      id,
      method: "drive.step",
      params: { text: bigAscii(17 * MIB) },
    });
    expect(writer.write(big(1))).toEqual(ok(undefined));
    expect(writer.write({ id: 2, method: "tool.execute", params: {} })).toEqual(ok(undefined));
    expect(writer.write(big(3))).toEqual(ok(undefined));
    await failed.open;
    // 싱크가 끊긴 뒤에도 같은 쓰는 쪽은 다음 프레임을 받는다. 읽는 쪽은 끊긴 전송을 순번 오류로 본다
    expect(writer.write({ id: 4, result: null })).toEqual(ok(undefined));
    const results = await collect(createFrameReader(input, { maxTransferBytes: 64 * MIB }), 2);
    input.end();
    expect(failures).toEqual([
      { id: 1, kind: "write_failed" },
      { id: 2, kind: "write_failed" },
      { id: 3, kind: "write_failed" },
    ]);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 1 },
      { kind: "response", id: 4 },
    ]);
  });

  test("abort fails the frames not yet sent and later writes are refused", () => {
    const failures: { id: number | undefined; kind: string }[] = [];
    const writer = createFrameWriter(
      { write: () => undefined },
      {
        transfer: { maxBytes: 64 * MIB },
        onTransferFailed: (frame, error) => {
          failures.push({ id: "id" in frame ? frame.id : undefined, kind: error.kind });
        },
      },
    );
    // 펌프가 쉬고 있지 않으므로 첫 큰 줄은 바로 나가고 뒤 줄은 줄 세워진다
    writer.write({ id: 1, method: "drive.step", params: { text: bigAscii(17 * MIB) } });
    writer.write({ id: 2, result: null });
    writer.abort();
    expect(failures.map((failure) => failure.kind)).toEqual(["write_failed", "write_failed"]);
    expect(writer.write({ id: 3, result: null }).ok).toBe(false);
  });
});

// ── 읽는 쪽의 실패 규칙 ──────────────────────────────────────────────────

// 조각이 세 개(2.5 MiB)인 응답 한 줄. 뒤따르는 정상 줄은 응답 9번이다
const SAMPLE_TEXT = JSON.stringify({ id: 7, result: { text: bigAscii(2_500_000) } });
const NORMAL = JSON.stringify({ id: 9, result: null });
const SAMPLE_OPTIONS: FrameReaderOptions = { maxTransferBytes: 64 * MIB };
const SAMPLE_SIZE = utf8Bytes(SAMPLE_TEXT);

describe("frame transfer reader rules", () => {
  test("a missing part gives one order failure and the next line still reads", async () => {
    const [begin, p0, , p2] = transferLines(SAMPLE_TEXT, 0, 7);
    const results = await readLines([begin ?? "", p0 ?? "", p2 ?? "", NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a duplicate part gives one order failure", async () => {
    const [begin, p0, p1, p2] = transferLines(SAMPLE_TEXT, 0, 7);
    const results = await readLines(
      [begin ?? "", p0 ?? "", p1 ?? "", p1 ?? "", p2 ?? "", NORMAL],
      SAMPLE_OPTIONS,
    );
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("reordered parts give one order failure", async () => {
    const [begin, p0, p1, p2] = transferLines(SAMPLE_TEXT, 0, 7);
    const results = await readLines(
      [begin ?? "", p0 ?? "", p2 ?? "", p1 ?? "", NORMAL],
      SAMPLE_OPTIONS,
    );
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a part with another transfer number gives one order failure", async () => {
    const [begin, p0] = transferLines(SAMPLE_TEXT, 0, 7);
    const [, other] = transferLines(SAMPLE_TEXT, 1, 7);
    const results = await readLines([begin ?? "", other ?? "", p0 ?? "", NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a part without a begin gives one order failure with no frame id", async () => {
    const [, p0, p1] = transferLines(SAMPLE_TEXT, 0, 7);
    const results = await readLines([p0 ?? "", p1 ?? "", NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: undefined },
      { kind: "response", id: 9 },
    ]);
  });

  test("a normal line in the middle of a transfer ends it with one order failure", async () => {
    const [begin, p0] = transferLines(SAMPLE_TEXT, 0, 7);
    const results = await readLines([begin ?? "", p0 ?? "", NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "order", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a part whose data is changed but keeps its size gives one hash failure", async () => {
    const [begin, p0, p1, p2] = transferLines(SAMPLE_TEXT, 0, 7);
    // 조각 안의 글자 하나를 같은 바이트 수의 다른 글자로 바꾼다. 바뀌었는지 먼저 확인한다
    const changed = (p0 ?? "").replace("aaaa", "baaa");
    expect(changed).not.toBe(p0);
    const results = await readLines(
      [begin ?? "", changed, p1 ?? "", p2 ?? "", NORMAL],
      SAMPLE_OPTIONS,
    );
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "hash", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a begin with a size one byte too large gives one size failure", async () => {
    const spans = spansOf(SAMPLE_TEXT);
    const begin = beginLine({
      x: 0,
      size: SAMPLE_SIZE + 1,
      parts: spans.length,
      sha256: sha256Of(SAMPLE_TEXT),
      frameId: 7,
    });
    const parts = transferLines(SAMPLE_TEXT, 0, 7).slice(1);
    const results = await readLines([begin, ...parts, NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "size", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a begin with a size one byte too small gives one size failure before the end", async () => {
    const spans = spansOf(SAMPLE_TEXT);
    const begin = beginLine({
      x: 0,
      size: SAMPLE_SIZE - 1,
      parts: spans.length,
      sha256: sha256Of(SAMPLE_TEXT),
      frameId: 7,
    });
    const parts = transferLines(SAMPLE_TEXT, 0, 7).slice(1);
    const results = await readLines([begin, ...parts, NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "size", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a begin larger than the reader limit is refused as too_large and its parts are dropped", async () => {
    const results = await readLines([...transferLines(SAMPLE_TEXT, 0, 7), NORMAL], {
      maxTransferBytes: SAMPLE_SIZE - 1,
    });
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "too_large", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a second begin while one is open gives one busy failure for the new frame", async () => {
    const first = transferLines(SAMPLE_TEXT, 0, 7);
    const second = transferLines(SAMPLE_TEXT, 1, 8);
    const results = await readLines([...first.slice(0, 2), ...second, NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "busy", frameId: 8 },
      { kind: "response", id: 9 },
    ]);
  });

  test("a transfer is refused as disabled when the reader has no transfer limit", async () => {
    const results = await readLines([...transferLines(SAMPLE_TEXT, 0, 7), NORMAL]);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "disabled", frameId: 7 },
      { kind: "response", id: 9 },
    ]);
  });

  test("input that ends during a transfer gives one truncated failure", async () => {
    const [begin, p0] = transferLines(SAMPLE_TEXT, 0, 7);
    const results = await readLines([begin ?? "", p0 ?? ""], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "truncated", frameId: 7 },
    ]);
  });

  test("an invalid begin is invalid_frame and the next line still reads", async () => {
    const badBegin = beginLine({ x: 0, size: 10, parts: 1, sha256: "not-a-hash", frameId: 7 });
    const results = await readLines([badBegin, NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "invalid_frame" },
      { kind: "response", id: 9 },
    ]);
  });

  test("a reassembled frame that is itself a transfer frame is invalid_frame", async () => {
    const text = JSON.stringify({ method: "frame.begin", params: {} });
    const results = await readLines([...transferLines(text, 0, undefined), NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "invalid_frame" },
      { kind: "response", id: 9 },
    ]);
  });

  test("a line over the cap is still refused as frame_too_large while transfers are enabled", async () => {
    const oversized = bigAscii(MAX + 1);
    const results = await readLines([oversized, NORMAL], SAMPLE_OPTIONS);
    expect(results.map(summaryOf)).toEqual([
      { error: "frame_too_large" },
      { kind: "response", id: 9 },
    ]);
  });

  test("error values never carry the reassembled text", async () => {
    const marker = "MARKER-XYZ-1234";
    // 해시가 틀린 전송: 값에는 글도 해시도 없어야 한다
    const hashText = JSON.stringify({ id: 7, result: { text: marker } });
    const hashWrong = beginLine({
      x: 0,
      size: utf8Bytes(hashText),
      parts: 1,
      sha256: sha256Of("other"),
      frameId: 7,
    });
    const hashPart = partLine(0, 0, hashText);
    // 파싱이 안 되는 글을 합친 전송
    const brokenText = `{"id":7,"result":"${marker}"`;
    // 모양이 틀린 글을 합친 전송
    const shapeText = JSON.stringify({ id: 7, marker });
    const results = await readLines(
      [
        hashWrong,
        hashPart,
        NORMAL,
        ...transferLines(brokenText, 0, 7),
        NORMAL,
        ...transferLines(shapeText, 0, 7),
        NORMAL,
      ],
      SAMPLE_OPTIONS,
    );
    expect(results.map(summaryOf)).toEqual([
      { error: "transfer_failed", reason: "hash", frameId: 7 },
      { kind: "response", id: 9 },
      { error: "parse_json" },
      { kind: "response", id: 9 },
      { error: "invalid_frame" },
      { kind: "response", id: 9 },
    ]);
    expect(JSON.stringify(results)).not.toContain(marker);
  });
});
