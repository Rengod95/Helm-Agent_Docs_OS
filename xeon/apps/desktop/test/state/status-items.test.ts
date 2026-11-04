import { describe, expect, test } from "bun:test";
import type { StatusItemRecord } from "@fresnel/contracts/records";
import type { StreamChunkParams, VolatileEventWire } from "@fresnel/contracts/wire";
import { decodeVolatile } from "../../src/state/engine/decode.ts";
import { startLink } from "../../src/state/engine/link.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectStatusItems } from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, STATUS_ITEM_CAP } from "../../src/state/engine/state.ts";
import { fakeConnection } from "./fake-connection.ts";
import { STORE, evt, harness, silent, thr } from "./helpers.ts";

// 상태줄 칸(B-09): `status.list` 스냅숏으로 시작하고 휘발 `dialog.status`가 그 thread의 칸을 통째로 바꾼다.

const T = thr(1);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ITEM_A: StatusItemRecord = { id: "core.turn", text: "작업 중 · 2단계", tone: "busy" };
const ITEM_B: StatusItemRecord = { id: "helm.phase", text: "검토 대기", tone: "warn", order: 10 };

function statusEvent(
  n: number,
  items: readonly StatusItemRecord[],
  payload?: unknown,
): VolatileEventWire {
  return {
    id: evt(80 + n),
    kind: "dialog.status",
    version: 1,
    durable: false,
    threadId: T,
    turnId: null,
    stepId: null,
    recordedAt: "2026-11-04T00:00:00.000Z",
    causationId: null,
    correlationId: "c",
    n,
    afterSeq: 0,
    payload: payload ?? { threadId: T, items },
  };
}

describe("status items in the mirror", () => {
  test("a snapshot seeds the thread and a dialog.status event replaces it whole", () => {
    const seeded = reduceMirror(INITIAL_MIRROR, { type: "status", threadId: T, items: [ITEM_A] });
    expect(seeded.state.statusItems).toEqual({ [T]: [ITEM_A] });
    const replaced = reduceMirror(seeded.state, {
      type: "chunk",
      fact: decodeVolatile(statusEvent(1, [ITEM_B])),
    });
    expect(replaced.state.statusItems).toEqual({ [T]: [ITEM_B] });
  });

  test("an event with an empty list clears the thread's items", () => {
    const seeded = reduceMirror(INITIAL_MIRROR, { type: "status", threadId: T, items: [ITEM_A] });
    const cleared = reduceMirror(seeded.state, {
      type: "chunk",
      fact: decodeVolatile(statusEvent(1, [])),
    });
    expect(cleared.state.statusItems).toEqual({ [T]: [] });
    expect(selectStatusItems(cleared.state, T)).toEqual([]);
  });

  test("a payload that does not parse is ignored", () => {
    const fact = decodeVolatile(statusEvent(1, [], { threadId: T, items: [{ id: "bad id" }] }));
    expect(fact.type).toBe("other");
    const seeded = reduceMirror(INITIAL_MIRROR, { type: "status", threadId: T, items: [ITEM_A] });
    const after = reduceMirror(seeded.state, { type: "chunk", fact });
    expect(after.state.statusItems).toEqual({ [T]: [ITEM_A] });
  });

  test("items past the cap are dropped and the selector orders by order, then arrival", () => {
    const many: StatusItemRecord[] = Array.from({ length: STATUS_ITEM_CAP + 5 }, (_, index) => ({
      id: `core.item-${index}`,
      text: `칸 ${index}`,
    }));
    const capped = reduceMirror(INITIAL_MIRROR, { type: "status", threadId: T, items: many });
    expect(capped.state.statusItems[T]?.length).toBe(STATUS_ITEM_CAP);
    const mixed = reduceMirror(INITIAL_MIRROR, {
      type: "status",
      threadId: T,
      items: [ITEM_A, ITEM_B],
    });
    expect(selectStatusItems(mixed.state, T).map((item) => item.id)).toEqual([
      "helm.phase",
      "core.turn",
    ]);
    expect(selectStatusItems(mixed.state, null)).toEqual([]);
    expect(selectStatusItems(mixed.state, thr(2))).toEqual([]);
  });

  test("resubscribing from head empties the items", () => {
    const seeded = reduceMirror(INITIAL_MIRROR, { type: "status", threadId: T, items: [ITEM_A] });
    const reset = reduceMirror(seeded.state, {
      type: "subscribed",
      sub: "s2",
      storeId: STORE,
      start: 3,
      live: true,
      from: "head",
    });
    expect(reset.state.statusItems).toEqual({});
  });
});

describe("status items through the link", () => {
  const listEmpty = { threads: [], nextCursor: null };
  const transcripts = {
    load: () => Promise.resolve({ ok: true as const, value: { asOfSeq: 5, items: [] } }),
  };

  test("opening a thread reads status.list and puts the snapshot in the mirror", async () => {
    const h = harness();
    const fake = fakeConnection({
      "events.subscribe": () =>
        Promise.resolve({ sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" }),
      "thread.list": () => Promise.resolve(listEmpty),
      "status.list": () => Promise.resolve({ items: [ITEM_A] }),
    });
    const link = startLink({
      connection: fake.connection,
      store: h.store,
      transcripts,
      logger: silent,
      openThreadId: () => null,
    });
    await tick();
    link.openThread(T);
    await tick();
    h.store.flush();
    expect(fake.calls.filter((c) => c.method === "status.list").map((c) => c.params)).toEqual([
      { threadId: T },
    ]);
    expect(h.store.read.getState().statusItems).toEqual({ [T]: [ITEM_A] });
    link.stop();
  });

  test("a dialog.status event that arrives while the snapshot is in flight wins over the snapshot", async () => {
    const h = harness();
    const release: { run: (() => void) | undefined } = { run: undefined };
    const fake = fakeConnection({
      "events.subscribe": () =>
        Promise.resolve({ sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" }),
      "thread.list": () => Promise.resolve(listEmpty),
      "status.list": () =>
        new Promise((resolve) => {
          release.run = () => {
            resolve({ items: [ITEM_A] });
          };
        }),
    });
    const link = startLink({
      connection: fake.connection,
      store: h.store,
      transcripts,
      logger: silent,
      openThreadId: () => null,
    });
    await tick();
    link.openThread(T);
    await tick();
    const params: StreamChunkParams = { event: statusEvent(1, [ITEM_B]) };
    fake.emit("stream.chunk", params);
    release.run?.();
    await tick();
    h.store.flush();
    expect(h.store.read.getState().statusItems).toEqual({ [T]: [ITEM_B] });
    link.stop();
  });

  test("a failing status.list leaves the thread without items and does not break the link", async () => {
    const h = harness();
    const fake = fakeConnection({
      "events.subscribe": () =>
        Promise.resolve({ sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" }),
      "thread.list": () => Promise.resolve(listEmpty),
    });
    const link = startLink({
      connection: fake.connection,
      store: h.store,
      transcripts,
      logger: silent,
      openThreadId: () => null,
    });
    await tick();
    link.openThread(T);
    await tick();
    h.store.flush();
    expect(h.store.read.getState().statusItems).toEqual({});
    expect(h.store.read.getState().link).toEqual({ phase: "live", sub: "s1" });
    link.stop();
  });
});
