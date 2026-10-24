import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  DurableEventEnvelopeSchema,
  upcastEvent,
  type ChunkMigration,
  type DurableEventEnvelope,
  type SqlRow,
  type SqlTx,
  type SqlValue,
  type UpcasterRegistry,
} from "../../src/records/index.ts";
import { EVENT, THREAD } from "./fixtures/payloads.ts";

function event(version: number, payload: unknown): DurableEventEnvelope {
  const parsed = parse(DurableEventEnvelopeSchema, {
    id: EVENT,
    kind: "x.acme.note.added",
    version,
    threadId: THREAD,
    turnId: null,
    stepId: null,
    recordedAt: 1,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq: 1,
    parentId: null,
  });
  if (!parsed.ok) throw new Error("fixture");
  return parsed.value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...value } : {};
}

const registry: UpcasterRegistry = new Map([
  [
    "x.acme.note.added",
    {
      current: 3,
      upcasters: [
        (payload) => ({ ...asRecord(payload), v2: true }),
        (payload) => ({ ...asRecord(payload), v3: true }),
      ],
    },
  ],
]);

describe("upcastEvent", () => {
  test("applies the chain v1 to v3 in order and leaves the original untouched (acceptance 3)", () => {
    const original = event(1, { text: "a" });
    const snapshot = JSON.stringify(original);
    const out = upcastEvent(original, registry);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.version).toBe(3);
      expect(out.value.payload).toEqual({ text: "a", v2: true, v3: true });
      expect(out.value).not.toBe(original);
    }
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  test("starting at v2 only applies the second upcaster", () => {
    const out = upcastEvent(event(2, { text: "a" }), registry);
    expect(out.ok && out.value.payload).toEqual({ text: "a", v3: true });
  });

  test("the current version returns a same-content copy", () => {
    const original = event(3, { text: "a" });
    const out = upcastEvent(original, registry);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toEqual(original);
      expect(out.value).not.toBe(original);
    }
  });

  test("unknown kind, future version and a missing upcaster are errors (acceptance 2)", () => {
    expect(upcastEvent(event(1, {}), new Map())).toEqual({
      ok: false,
      error: { kind: "unknown_kind", eventKind: "x.acme.note.added" },
    });
    expect(upcastEvent(event(4, {}), registry)).toEqual({
      ok: false,
      error: { kind: "future_version", eventKind: "x.acme.note.added", version: 4, current: 3 },
    });
    const short: UpcasterRegistry = new Map([
      ["x.acme.note.added", { current: 3, upcasters: [(payload) => payload] }],
    ]);
    expect(upcastEvent(event(1, {}), short)).toEqual({
      ok: false,
      error: { kind: "missing_upcaster", eventKind: "x.acme.note.added", from: 2 },
    });
  });
});

function fakeTx(rows: number[]): SqlTx {
  return {
    run(_sql: string, params?: readonly SqlValue[]) {
      const first = params?.[0];
      if (typeof first === "number") rows.push(first);
      return { changes: 1 };
    },
    get(): SqlRow | undefined {
      return undefined;
    },
    all(): readonly SqlRow[] {
      return [];
    },
  };
}

describe("ChunkMigration contract (fake SqlTx)", () => {
  const migration: ChunkMigration<number> = {
    id: "0001_demo",
    initialCursor: 0,
    runChunk(tx, cursor, budget) {
      const end = Math.min(cursor + budget.maxRows, 5);
      for (let i = cursor; i < end; i += 1) tx.run("insert", [i]);
      return { next: end >= 5 ? null : end, processed: end - cursor };
    },
  };

  test("runChunk is synchronous and returns the next cursor", () => {
    const rows: number[] = [];
    const first = migration.runChunk(fakeTx(rows), migration.initialCursor, { maxRows: 3 });
    expect(first).toEqual({ next: 3, processed: 3 });
    const second = migration.runChunk(fakeTx(rows), 3, { maxRows: 3 });
    expect(second).toEqual({ next: null, processed: 2 });
    expect(rows).toEqual([0, 1, 2, 3, 4]);
  });
});
