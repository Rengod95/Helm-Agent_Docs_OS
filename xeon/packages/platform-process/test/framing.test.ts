import { describe, expect, test } from "bun:test";
import { WIRE_LIMITS } from "@xeon/contracts/wire";
import { createLineFramer, encodeFrame, rejectionFrame, type FrameEvent } from "../src/index.ts";
import { bytes } from "./support/streams.ts";

function messages(events: readonly FrameEvent[]): unknown[] {
  return events.flatMap((event) => (event.kind === "message" ? [event.value] : []));
}

const FRAMES = [
  { jsonrpc: "2.0", id: "r1", method: "a.b", params: { text: "가나다 🙂" } },
  { jsonrpc: "2.0", id: "r2", method: "a.c", params: {} },
  { jsonrpc: "2.0", method: "n.x", params: { n: 1 } },
];

describe("line framer", () => {
  test("frames split across chunks are joined", () => {
    const wire = bytes(FRAMES.map((frame) => `${JSON.stringify(frame)}\n`).join(""));
    const framer = createLineFramer();
    // 한 바이트씩 넣어도 다바이트 문자가 깨지지 않는다
    const byByte = [...wire].flatMap((byte) => messages(framer.push(Uint8Array.of(byte))));
    expect(byByte).toEqual(FRAMES);
    // 한 청크에 세 메시지
    expect(messages(createLineFramer().push(wire))).toEqual(FRAMES);
  });

  test("a chunk boundary inside a multibyte character keeps the text intact", () => {
    const wire = bytes(`${JSON.stringify(FRAMES[0])}\n`);
    const cut = wire.indexOf(0xea); // '가'의 첫 바이트
    const framer = createLineFramer();
    expect(framer.push(wire.subarray(0, cut + 1))).toEqual([]);
    expect(messages(framer.push(wire.subarray(cut + 1)))).toEqual([FRAMES[0]]);
  });

  test("oversized frame is dropped and the next frame still works", () => {
    const framer = createLineFramer({ maxFrameBytes: 64 });
    const big = bytes(`${JSON.stringify({ pad: "x".repeat(200) })}\n`);
    const events = [
      ...framer.push(big.subarray(0, 100)),
      ...framer.push(big.subarray(100)),
      ...framer.push(bytes(`${JSON.stringify(FRAMES[1])}\n`)),
    ];
    expect(events).toEqual([
      { kind: "rejected", problem: "frame_too_large" },
      { kind: "message", value: FRAMES[1] },
    ]);
  });

  test("a frame of exactly maxFrameBytes is accepted and one byte more is not", () => {
    const body = JSON.stringify({ a: "x".repeat(10) });
    const exact = createLineFramer({ maxFrameBytes: body.length });
    expect(messages(exact.push(bytes(`${body}\n`)))).toHaveLength(1);
    const over = createLineFramer({ maxFrameBytes: body.length - 1 });
    expect(over.push(bytes(`${body}\n`))).toEqual([
      { kind: "rejected", problem: "frame_too_large" },
    ]);
  });

  test("the default limit is the wire frame limit", () => {
    const framer = createLineFramer();
    const events = framer.push(bytes(`${"x".repeat(WIRE_LIMITS.maxFrameBytes + 1)}\n`));
    expect(events).toEqual([{ kind: "rejected", problem: "frame_too_large" }]);
  });

  test("invalid json is reported and the next line is processed", () => {
    const framer = createLineFramer();
    const events = framer.push(bytes(`{not json\n${JSON.stringify(FRAMES[1])}\n`));
    expect(events).toEqual([
      { kind: "rejected", problem: "not_json" },
      { kind: "message", value: FRAMES[1] },
    ]);
  });

  test("CRLF is accepted and blank lines are ignored", () => {
    const framer = createLineFramer();
    const events = framer.push(bytes(`\n\r\n${JSON.stringify(FRAMES[1])}\r\n\n`));
    expect(events).toEqual([{ kind: "message", value: FRAMES[1] }]);
  });

  test("an unterminated tail is dropped at EOF and counted", () => {
    const framer = createLineFramer();
    expect(framer.push(bytes('{"jsonrpc":"2.0"'))).toEqual([]);
    expect(framer.finish()).toEqual({ droppedBytes: 16 });
    expect(framer.finish()).toEqual({ droppedBytes: 0 });
  });
});

describe("frame encoding", () => {
  test("a message becomes one UTF-8 line", () => {
    const encoded = encodeFrame(FRAMES[0]);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const text = new TextDecoder().decode(encoded.value);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(JSON.parse(text)).toEqual(FRAMES[0]);
  });

  test("values JSON cannot carry are an error value", () => {
    expect(encodeFrame(undefined)).toEqual({ ok: false, error: { kind: "not_serializable" } });
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(encodeFrame(cyclic)).toEqual({ ok: false, error: { kind: "not_serializable" } });
  });

  test("rejection frames carry a null id and the wire error kinds", () => {
    const tooLarge: unknown = JSON.parse(rejectionFrame("frame_too_large"));
    expect(tooLarge).toMatchObject({
      id: null,
      error: {
        code: -32600,
        data: { kind: "jsonrpc.invalidRequest", details: { issue: "frameTooLarge" } },
      },
    });
    const notJson: unknown = JSON.parse(rejectionFrame("not_json"));
    expect(notJson).toMatchObject({ id: null, error: { code: -32700 } });
  });
});
