import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  DurableEventEnvelopeSchema,
  ENVELOPE_MAX_BYTES,
  EventEnvelopeSchema,
  VolatileEventEnvelopeSchema,
  checkEnvelopeSize,
  type DurableEventEnvelope,
  type EventEnvelope,
  type VolatileEventEnvelope,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";
import { THREAD, TURN, EVENT, EVENT2, SHA } from "./fixtures/payloads.ts";

const base = {
  id: EVENT,
  kind: "turn.started",
  version: 1,
  threadId: THREAD,
  turnId: TURN,
  stepId: null,
  recordedAt: 1_700_000_000_000,
  causationId: null,
  correlationId: TURN,
  payload: { inputItemIds: [], requestId: null, scopeId: null },
};

const durable = { ...base, durable: true, seq: 1, parentId: null };
const volatile = { ...base, kind: "item.updated", durable: false, n: 0, afterSeq: 0 };

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value };
  Reflect.deleteProperty(copy, key);
  return copy;
}

describe("envelope fixtures", () => {
  test("durable and volatile fixtures pass", () => {
    expect(parse(DurableEventEnvelopeSchema, durable).ok).toBe(true);
    expect(parse(VolatileEventEnvelopeSchema, volatile).ok).toBe(true);
    expect(parse(EventEnvelopeSchema, durable).ok).toBe(true);
    expect(parse(EventEnvelopeSchema, volatile).ok).toBe(true);
  });

  test("dropping any required field, one at a time, fails", () => {
    for (const key of Object.keys(durable)) {
      expect(parse(DurableEventEnvelopeSchema, without(durable, key)).ok).toBe(false);
    }
    for (const key of Object.keys(volatile)) {
      expect(parse(VolatileEventEnvelopeSchema, without(volatile, key)).ok).toBe(false);
    }
  });

  test("optional detached list is allowed on durable only", () => {
    const detached = [
      {
        pointer: "/item/message/content/0/data",
        ref: { type: "blob", sha256: SHA, size: 5, mediaType: null },
      },
    ];
    expect(parse(DurableEventEnvelopeSchema, { ...durable, detached }).ok).toBe(true);
    expect(parse(VolatileEventEnvelopeSchema, { ...volatile, detached }).ok).toBe(false);
  });
});

describe("durable / volatile mutual constraints (acceptance 1)", () => {
  test("durable:false with seq or parentId fails", () => {
    expect(parse(EventEnvelopeSchema, { ...volatile, seq: 1 }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...volatile, parentId: null }).ok).toBe(false);
  });

  test("durable:true with n or without seq fails", () => {
    expect(parse(EventEnvelopeSchema, { ...durable, n: 0 }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, without(durable, "seq")).ok).toBe(false);
  });
});

describe("value ranges", () => {
  test("version 0, seq 0, n -1 and a fractional recordedAt fail", () => {
    expect(parse(EventEnvelopeSchema, { ...durable, version: 0 }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...durable, seq: 0 }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...volatile, n: -1 }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...volatile, afterSeq: -1 }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...durable, recordedAt: 1.5 }).ok).toBe(false);
  });

  test("id, thread and scope id prefixes are enforced", () => {
    expect(parse(EventEnvelopeSchema, { ...durable, id: THREAD }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...durable, threadId: EVENT }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...durable, stepId: rawId("stp", 1) }).ok).toBe(true);
    expect(parse(EventEnvelopeSchema, { ...durable, stepId: TURN }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...durable, causationId: EVENT2 }).ok).toBe(true);
    expect(parse(EventEnvelopeSchema, { ...durable, correlationId: "" }).ok).toBe(false);
  });

  test("kind must have a valid shape (extension kinds pass, junk fails)", () => {
    expect(parse(EventEnvelopeSchema, { ...durable, kind: "x.acme.note.added" }).ok).toBe(true);
    expect(parse(EventEnvelopeSchema, { ...durable, kind: "Bad Kind" }).ok).toBe(false);
    expect(parse(EventEnvelopeSchema, { ...durable, kind: "a.b.c" }).ok).toBe(false);
  });

  test("unknown keys are rejected", () => {
    expect(parse(EventEnvelopeSchema, { ...durable, extra: 1 }).ok).toBe(false);
  });
});

function envelopeWithPayloadSize(targetBytes: number, char: string): DurableEventEnvelope {
  const parsed = parse(DurableEventEnvelopeSchema, durable);
  if (!parsed.ok) throw new Error("fixture");
  const empty: DurableEventEnvelope = { ...parsed.value, payload: { text: "" } };
  const overhead = new TextEncoder().encode(JSON.stringify(empty)).length;
  const charBytes = new TextEncoder().encode(char).length;
  const count = (targetBytes - overhead) / charBytes;
  if (!Number.isInteger(count)) throw new Error("cannot hit the target size with this char");
  return { ...empty, payload: { text: char.repeat(count) } };
}

describe("checkEnvelopeSize (acceptance 6)", () => {
  test("262,144 bytes is ok, 262,145 is too large", () => {
    const exact = checkEnvelopeSize(envelopeWithPayloadSize(ENVELOPE_MAX_BYTES, "a"));
    expect(exact).toEqual({ ok: true, value: ENVELOPE_MAX_BYTES });
    const over = checkEnvelopeSize(envelopeWithPayloadSize(ENVELOPE_MAX_BYTES + 1, "a"));
    expect(over).toEqual({
      ok: false,
      error: { kind: "event_too_large", bytes: ENVELOPE_MAX_BYTES + 1, limit: ENVELOPE_MAX_BYTES },
    });
  });

  test("multi-byte characters are measured in UTF-8 bytes", () => {
    // 한글 한 글자는 3바이트. 글자 수로는 한도 안이지만 바이트로는 넘는 경우를 잡는다.
    const envelope = envelopeWithPayloadSize(ENVELOPE_MAX_BYTES + 1, "한");
    const payload: unknown = envelope.payload;
    const text: unknown =
      typeof payload === "object" && payload !== null && "text" in payload
        ? payload.text
        : undefined;
    expect(typeof text === "string" && text.length < ENVELOPE_MAX_BYTES).toBe(true);
    const result = checkEnvelopeSize(envelope);
    expect(result.ok).toBe(false);
  });

  test("volatile envelopes are measured too", () => {
    const parsed = parse(VolatileEventEnvelopeSchema, volatile);
    if (!parsed.ok) throw new Error("fixture");
    const envelope: VolatileEventEnvelope = parsed.value;
    const asEvent: EventEnvelope = envelope;
    expect(checkEnvelopeSize(asEvent).ok).toBe(true);
  });
});
