import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import type { DurableEventEnvelope, VolatileEventEnvelope } from "../../src/records/index.ts";
import {
  EventWireSchema,
  EventsBatchParamsSchema,
  StreamChunkParamsSchema,
  VolatileEventWireSchema,
  toEventWire,
  toVolatileEventWire,
} from "../../src/wire-settings/wire/index.ts";
import { must, rawId } from "../helpers/ids.ts";
import {
  DurableEventEnvelopeSchema,
  VolatileEventEnvelopeSchema,
} from "../../src/records/index.ts";

const RECORDED_AT = 1_790_000_000_123;

function durable(overrides: Record<string, unknown> = {}): DurableEventEnvelope {
  return must(DurableEventEnvelopeSchema, {
    id: rawId("evt", 2),
    kind: "item.recorded",
    version: 1,
    threadId: rawId("thr", 1),
    turnId: rawId("trn", 1),
    stepId: null,
    recordedAt: RECORDED_AT,
    causationId: rawId("evt", 1),
    correlationId: "corr",
    payload: { itemId: rawId("itm", 1), message: { token: "abc", list: [{ key: "k" }, 2] } },
    durable: true,
    seq: 7,
    parentId: rawId("evt", 1),
    ...overrides,
  });
}

function volatile(): VolatileEventEnvelope {
  return must(VolatileEventEnvelopeSchema, {
    id: rawId("evt", 3),
    kind: "item.updated",
    version: 1,
    threadId: rawId("thr", 1),
    turnId: rawId("trn", 1),
    stepId: null,
    recordedAt: RECORDED_AT,
    causationId: null,
    correlationId: null,
    payload: { text: "a" },
    durable: false,
    n: 4,
    afterSeq: 7,
  });
}

describe("toEventWire", () => {
  test("toEventWire converts time", () => {
    const wire = toEventWire(durable());
    expect(wire.recordedAt).toBe("2026-09-21T14:13:20.123Z");
    expect(wire.seq).toBe(7);
    expect(String(wire.parentId)).toBe(rawId("evt", 1));
    expect(wire.redactions).toEqual([]);
    expect(wire.durable).toBe(true);
    expect("detached" in wire).toBe(false);
    expect(parse(EventWireSchema, wire).ok).toBe(true);
  });

  test("keeps every other field and the detached list", () => {
    const source = durable({
      detached: [
        {
          pointer: "/message/text",
          ref: { type: "blob", sha256: "a".repeat(64), size: 5, mediaType: null },
        },
      ],
    });
    const wire = toEventWire(source);
    expect(wire.detached).toEqual(source.detached);
    expect({ ...wire, recordedAt: 0, redactions: [] }).toEqual({
      ...source,
      recordedAt: 0,
      redactions: [],
    });
  });

  test("toEventWire redacts pointers", () => {
    const source = durable();
    const before = JSON.stringify(source);
    const wire = toEventWire(source, () => [
      "/message/token",
      "/message/list/0",
      "/message/list/1",
    ]);
    expect(wire.payload).toEqual({
      itemId: rawId("itm", 1),
      message: { list: [null, null] },
    });
    expect(wire.redactions).toEqual(["/message/token", "/message/list/0", "/message/list/1"]);
    // 입력은 바뀌지 않는다
    expect(JSON.stringify(source)).toBe(before);
    expect(parse(EventWireSchema, wire).ok).toBe(true);
  });

  test("a pointer that points nowhere is not recorded", () => {
    const wire = toEventWire(durable(), () => [
      "/missing",
      "/message/token",
      "/message/token",
      "no-slash",
      "/message/list/9",
    ]);
    expect(wire.redactions).toEqual(["/message/token"]);
  });

  test("the root pointer erases the whole payload", () => {
    const wire = toEventWire(durable(), () => [""]);
    expect(wire.payload).toBeNull();
    expect(wire.redactions).toEqual([""]);
  });

  test("pointer escapes are decoded", () => {
    const source = durable({ payload: { "a/b": { "c~d": "secret" } } });
    const wire = toEventWire(source, () => ["/a~1b/c~0d"]);
    expect(wire.payload).toEqual({ "a/b": {} });
    expect(wire.redactions).toEqual(["/a~1b/c~0d"]);
  });
});

describe("toVolatileEventWire", () => {
  test("volatile wire keeps n and afterSeq", () => {
    const wire = toVolatileEventWire(volatile());
    expect(wire.n).toBe(4);
    expect(wire.afterSeq).toBe(7);
    expect(wire.recordedAt).toBe("2026-09-21T14:13:20.123Z");
    expect(wire.durable).toBe(false);
    expect("seq" in wire).toBe(false);
    expect(parse(VolatileEventWireSchema, wire).ok).toBe(true);
  });

  test("stream chunk has no seq", () => {
    const wire = toVolatileEventWire(volatile());
    expect(parse(StreamChunkParamsSchema, { event: wire }).ok).toBe(true);
    expect(parse(StreamChunkParamsSchema, { event: { ...wire, seq: 8 } }).ok).toBe(false);
    expect("seq" in StreamChunkParamsSchema.properties).toBe(false);
    expect("seq" in VolatileEventWireSchema.properties).toBe(false);
  });
});

describe("EventsBatchParams", () => {
  test("accepts an empty interval that only moves the position", () => {
    const params = { sub: "s1", from: 3, to: 9, events: [], caughtUp: false };
    expect(parse(EventsBatchParamsSchema, params).ok).toBe(true);
    expect(parse(EventsBatchParamsSchema, { ...params, events: [toEventWire(durable())] }).ok).toBe(
      true,
    );
    expect(parse(EventsBatchParamsSchema, { ...params, caughtUp: "yes" }).ok).toBe(false);
  });
});
