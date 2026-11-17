import { describe, expect, test } from "bun:test";
import { repeatAsync } from "@fresnel/contracts";
import {
  PLUGIN_HOST_ERROR_DETAIL_MAX_BYTES,
  PLUGIN_HOST_MAX_FRAME_BYTES,
} from "@fresnel/contracts/extensions";
import {
  createFrameReader,
  createFrameWriter,
  type FrameReadResult,
  type FrameReader,
} from "../../src/isolation/framing.ts";
import { memoryInput } from "./support/host.ts";

/** 읽기 결과를 종류와 핵심 필드만 남겨 비교하기 쉽게 만든다 */
function summaryOf(result: FrameReadResult): unknown {
  if (!result.ok) return { error: result.error.kind };
  const frame = result.value;
  if (frame.kind === "request") return { kind: frame.kind, id: frame.id, method: frame.method };
  if (frame.kind === "notification") return { kind: frame.kind, method: frame.method };
  return { kind: frame.kind, id: frame.id };
}

async function readAllFrom(reader: FrameReader): Promise<unknown[]> {
  const seen: unknown[] = [];
  await repeatAsync<void>(async () => {
    const item = await reader.next();
    if (item === null) return { value: undefined };
    seen.push(summaryOf(item));
    return undefined;
  });
  return seen;
}

describe("createFrameReader", () => {
  test("splits lines across chunk boundaries and classifies each frame", async () => {
    const input = memoryInput();
    const reader = createFrameReader(input);
    input.push('{"id":1,"method":"host.init","params":{}}\n{"method":"event.not');
    input.push('ify","params":{}}\n{"id":1,"result":null}\n');
    input.end();
    expect(await readAllFrom(reader)).toEqual([
      { kind: "request", id: 1, method: "host.init" },
      { kind: "notification", method: "event.notify" },
      { kind: "response", id: 1 },
    ]);
  });

  test("a line over the cap is refused as frame_too_large and the next line still reads", async () => {
    const input = memoryInput();
    const reader = createFrameReader(input);
    const oversized = "a".repeat(PLUGIN_HOST_MAX_FRAME_BYTES + 1);
    input.push(oversized.slice(0, 1024));
    input.push(`${oversized.slice(1024)}\n{"id":2,"method":"hook.invoke","params":{}}\n`);
    input.end();
    expect(await readAllFrom(reader)).toEqual([
      { error: "frame_too_large" },
      { kind: "request", id: 2, method: "hook.invoke" },
    ]);
  });

  test("malformed JSON and a non-frame object are value errors and reading continues", async () => {
    const input = memoryInput();
    const reader = createFrameReader(input);
    input.push('not json\n{"foo":1}\n{"id":3,"result":true}\n');
    input.end();
    expect(await readAllFrom(reader)).toEqual([
      { error: "parse_json" },
      { error: "invalid_frame" },
      { kind: "response", id: 3 },
    ]);
  });

  test("a final line without a trailing newline is still read", async () => {
    const input = memoryInput();
    const reader = createFrameReader(input);
    input.push('{"id":4,"method":"scope.dispose","params":{"registration":"demo"}}');
    input.end();
    expect(await readAllFrom(reader)).toEqual([
      { kind: "request", id: 4, method: "scope.dispose" },
    ]);
  });
});

/** 읽기 결과의 값을 그대로 모은다. 값 오류는 종류만 남긴다 */
async function valuesFrom(reader: FrameReader): Promise<unknown[]> {
  const seen: unknown[] = [];
  await repeatAsync<void>(async () => {
    const item = await reader.next();
    if (item === null) return { value: undefined };
    seen.push(item.ok ? item.value : { error: item.error.kind });
    return undefined;
  });
  return seen;
}

/** 오류 응답 한 줄. origin만 다르게 해 시험한다 */
function errorFrame(id: number, origin: object): string {
  return `${JSON.stringify({ id, error: { kind: "engine_call_failed", message: "m", origin } })}\n`;
}

describe("error origin in a frame", () => {
  const capabilityData = {
    capability: "demo.echo",
    method: "echo",
    code: "unavailable",
    message: "every provider failed",
    retryable: true,
  };

  test("an error frame with a primitive or a capability origin is read with that origin", async () => {
    const input = memoryInput();
    const reader = createFrameReader(input);
    input.push(
      `${JSON.stringify({
        id: 3,
        error: {
          kind: "engine_call_failed",
          message: "state_conflict: x",
          origin: { kind: "primitive", code: "state_conflict", scopeId: "demo" },
        },
      })}\n`,
    );
    input.push(
      `${JSON.stringify({
        id: 4,
        error: {
          kind: "engine_call_failed",
          message: "unavailable: y",
          origin: { kind: "capability", data: capabilityData },
        },
      })}\n`,
    );
    input.end();
    expect(await valuesFrom(reader)).toEqual([
      {
        kind: "failure",
        id: 3,
        error: {
          kind: "engine_call_failed",
          message: "state_conflict: x",
          origin: { kind: "primitive", code: "state_conflict", scopeId: "demo" },
        },
      },
      {
        kind: "failure",
        id: 4,
        error: {
          kind: "engine_call_failed",
          message: "unavailable: y",
          origin: { kind: "capability", data: capabilityData },
        },
      },
    ]);
  });

  test("an origin of the wrong shape, or a detail over the limit, makes the frame invalid_frame and reading continues", async () => {
    const input = memoryInput();
    const reader = createFrameReader(input);
    input.push(errorFrame(5, { kind: "primitive", code: "Not A Code" }));
    input.push(errorFrame(6, { kind: "other", code: "state_conflict" }));
    input.push(errorFrame(7, { kind: "primitive", code: "state_conflict", extra: true }));
    input.push(errorFrame(8, { kind: "capability", data: { capability: "demo.echo" } }));
    input.push(
      errorFrame(9, {
        kind: "capability",
        data: { ...capabilityData, detail: "x".repeat(PLUGIN_HOST_ERROR_DETAIL_MAX_BYTES) },
      }),
    );
    input.push(
      errorFrame(10, { kind: "capability", data: { ...capabilityData, detail: { tried: 2 } } }),
    );
    input.end();
    expect(await readAllFrom(reader)).toEqual([
      { error: "invalid_frame" },
      { error: "invalid_frame" },
      { error: "invalid_frame" },
      { error: "invalid_frame" },
      { error: "invalid_frame" },
      { kind: "failure", id: 10 },
    ]);
  });
});

describe("createFrameWriter", () => {
  test("writes one JSON line per frame with a trailing newline", () => {
    const lines: string[] = [];
    const writer = createFrameWriter({ write: (line) => lines.push(line) });
    const sent = writer.write({ id: 1, result: { ok: true } });
    expect(sent).toEqual({ ok: true, value: undefined });
    expect(lines).toEqual(['{"id":1,"result":{"ok":true}}\n']);
  });

  test("refuses a frame over the cap with frame_too_large and writes nothing", () => {
    const lines: string[] = [];
    const writer = createFrameWriter({ write: (line) => lines.push(line) });
    const sent = writer.write({ id: 2, result: "x".repeat(PLUGIN_HOST_MAX_FRAME_BYTES) });
    expect(sent).toEqual({
      ok: false,
      error: { kind: "frame_too_large", max: PLUGIN_HOST_MAX_FRAME_BYTES },
    });
    expect(lines).toEqual([]);
  });

  test("a sink that throws becomes a write_failed value", () => {
    const writer = createFrameWriter({
      write: () => {
        throw new Error("pipe closed");
      },
    });
    const sent = writer.write({ id: 3, result: null });
    expect(sent.ok).toBe(false);
    if (sent.ok) return;
    expect(sent.error.kind).toBe("write_failed");
  });
});
