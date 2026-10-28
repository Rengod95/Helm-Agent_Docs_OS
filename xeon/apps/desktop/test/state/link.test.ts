import { describe, expect, test } from "bun:test";
import { Bug, repeatAsync, type Result } from "@xeon/contracts";
import type { ItemRecord } from "@xeon/contracts/conversation";
import {
  WireError,
  type EventsBatchParams,
  type EventsEndedParams,
  type StreamChunkParams,
  type WireResult,
} from "@xeon/contracts/wire";
import {
  startLink,
  type SnapshotError,
  type TranscriptPort,
  type TranscriptSnapshot,
} from "../../src/state/engine/link.ts";
import { fakeConnection, type Table } from "./fake-connection.ts";
import {
  STORE,
  approvalRequest,
  evt,
  harness,
  itm,
  prt,
  silent,
  summary,
  thr,
  userItem,
} from "./helpers.ts";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** 프레임 커밋과 마이크로태스크를 번갈아 돌려 컨트롤러와 거울이 안정될 때까지 진행한다 */
async function pump(h: { readonly store: { flush(): void } }, rounds: number = 8): Promise<void> {
  let left = rounds;
  await repeatAsync<undefined>(async () => {
    h.store.flush();
    await tick();
    left -= 1;
    return left <= 0 ? { value: undefined } : undefined;
  });
  h.store.flush();
}
const noTranscripts: TranscriptPort = { load: () => Promise.reject(new Bug("unused")) };
const snap = (
  asOfSeq: number,
  items: ItemRecord[] = [],
): Result<TranscriptSnapshot, SnapshotError> => ({ ok: true, value: { asOfSeq, items } });
const batch = (sub: string, from: number, to: number, caughtUp = true): EventsBatchParams => ({
  sub,
  from,
  to,
  caughtUp,
  events: [],
});
const chunk = (n: number, payload: unknown): StreamChunkParams => ({
  event: {
    id: evt(90 + n),
    kind: "item.updated",
    version: 1,
    durable: false,
    threadId: thr(1),
    turnId: null,
    stepId: null,
    recordedAt: "2026-10-24T00:00:00.000Z",
    causationId: null,
    correlationId: "c",
    n,
    afterSeq: 0,
    payload,
  },
});
const good = (text: string): unknown => ({
  itemId: itm(1),
  update: {
    kind: "part_delta",
    delta: {
      partId: prt(1),
      itemId: itm(1),
      contentIndex: 0,
      kind: "text",
      phase: "delta",
      delta: text,
    },
  },
});
const listEmpty = { threads: [summary(thr(1))], nextCursor: null };

describe("link: resync with a gap", () => {
  test("gap batch -> resubscribe from the cursor -> replay fills the hole -> live", async () => {
    const h = harness();
    const subscribeParams: unknown[] = [];
    const fake = fakeConnection({
      "events.subscribe": (params) => {
        subscribeParams.push(params.from);
        return Promise.resolve(
          subscribeParams.length === 1
            ? { sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" }
            : { sub: "s2", start: 6, headSeq: 10, storeId: STORE, mode: "replaying" },
        );
      },
      "thread.list": () => Promise.resolve(listEmpty),
    });
    const link = startLink({
      connection: fake.connection,
      store: h.store,
      transcripts: noTranscripts,
      logger: silent,
      openThreadId: () => null,
    });
    await tick();
    h.store.flush();
    expect(h.store.read.getState().link).toEqual({ phase: "live", sub: "s1" });

    fake.emit("events.batch", batch("s1", 5, 6));
    fake.emit("events.batch", batch("s1", 9, 10)); // 6..9 구간이 빠졌다
    h.frames.flush();
    expect(h.store.read.getState().link).toEqual({ phase: "resync", reason: "gap", attempt: 1 });
    await tick();
    expect(subscribeParams[1]).toEqual({ storeId: STORE, seq: 6 });

    h.store.flush();
    expect(h.store.read.getState().link).toEqual({ phase: "syncing", sub: "s2" });
    // 이전 구독의 늦은 알림은 버려지고, 새 구독의 알림이 구멍을 메운다
    fake.emit("events.batch", batch("s1", 10, 11));
    fake.emit("events.batch", { ...batch("s2", 6, 10), events: [] });
    h.store.flush();
    const s = h.store.read.getState();
    expect(s.link).toEqual({ phase: "live", sub: "s2" });
    expect(s.cursor).toEqual({ storeId: STORE, seq: 10 });
    expect(h.journal.entries().some((e) => e.kind === "input" && e.note === "foreign")).toBe(true);
    link.stop();
  });

  test("a new subscription closes the previous one; a superseded in-flight response is closed and ignored", async () => {
    const h = harness();
    const resolvers: ((r: WireResult<"events.subscribe">) => void)[] = [];
    const fake = fakeConnection({
      "events.subscribe": () => new Promise((resolve) => void resolvers.push(resolve)),
      "events.unsubscribe": () => Promise.resolve({}),
      "thread.list": () => Promise.resolve(listEmpty),
    });
    const link = startLink({
      connection: fake.connection,
      store: h.store,
      transcripts: noTranscripts,
      logger: silent,
      openThreadId: () => null,
    });
    resolvers[0]?.({ sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" });
    await tick();
    h.store.flush();
    fake.emit("events.batch", batch("s1", 5, 6));
    fake.emit("events.batch", batch("s1", 9, 10)); // 구멍 -> resync -> 두 번째 구독(응답을 아직 보내지 않는다)
    h.frames.flush();
    await tick();
    expect(resolvers).toHaveLength(2);
    h.store.ingest({ type: "out_of_range" }); // 응답 전에 reset이 겹친다 -> 세 번째 구독
    h.frames.flush();
    await tick();
    expect(resolvers).toHaveLength(3);
    resolvers[1]?.({ sub: "s2", start: 6, headSeq: 6, storeId: STORE, mode: "live" }); // 낡은 응답
    resolvers[2]?.({ sub: "s3", start: 6, headSeq: 6, storeId: STORE, mode: "live" });
    await tick();
    h.store.flush();
    await tick();
    expect(h.store.read.getState().link).toEqual({ phase: "live", sub: "s3" });
    const closed = fake.calls.filter((c) => c.method === "events.unsubscribe").map((c) => c.params);
    expect(closed).toContainEqual({ sub: "s2" }); // 낡은 응답의 구독
    expect(closed).toContainEqual({ sub: "s1" }); // 이전 구독
    link.stop();
    await tick();
    expect(
      fake.calls.filter((c) => c.method === "events.unsubscribe").map((c) => c.params),
    ).toContainEqual({ sub: "s3" });
  });

  test("batch notification that overtakes the subscribe response is held and applied afterwards", async () => {
    const h = harness();
    const fake = fakeConnection({
      "events.subscribe": () =>
        Promise.resolve({ sub: "s1", start: 5, headSeq: 6, storeId: STORE, mode: "replaying" }),
      "thread.list": () => Promise.resolve(listEmpty),
    });
    startLink({
      connection: fake.connection,
      store: h.store,
      transcripts: noTranscripts,
      logger: silent,
      openThreadId: () => null,
    });
    fake.emit("events.batch", batch("s1", 5, 6)); // 응답보다 먼저 도착
    await tick();
    h.store.flush();
    expect(h.store.read.getState().cursor).toEqual({ storeId: STORE, seq: 6 });
    expect(h.store.read.getState().link).toEqual({ phase: "live", sub: "s1" });
  });

  test("replay.outOfRange from the cursor subscribe resets to head and reloads threads and the open transcript", async () => {
    const h = harness();
    let subscribes = 0;
    const loads: unknown[] = [];
    const fake = fakeConnection({
      "events.subscribe": (params) => {
        subscribes += 1;
        if (subscribes === 2) {
          expect(params.from).toEqual({ storeId: STORE, seq: 5 });
          return Promise.reject(
            new WireError(-32010, "range", {
              kind: "replay.outOfRange",
              retryable: false,
              details: { reason: "beforeOldest" },
            }),
          );
        }
        return Promise.resolve({
          sub: `s${subscribes}`,
          start: 5,
          headSeq: 5,
          storeId: STORE,
          mode: "live",
        });
      },
      "thread.list": () => Promise.resolve(listEmpty),
    });
    const transcripts: TranscriptPort = {
      load: (threadId) => {
        loads.push(threadId);
        return Promise.resolve(snap(5, [userItem(1)]));
      },
    };
    startLink({
      connection: fake.connection,
      store: h.store,
      transcripts,
      logger: silent,
      openThreadId: () => thr(1),
    });
    await pump(h);
    expect(loads).toEqual([thr(1)]);
    fake.emit("events.ended", { sub: "s1", reason: "replayFailed" } satisfies EventsEndedParams);
    await pump(h);
    const s = h.store.read.getState();
    expect(subscribes).toBe(3); // 처음, cursor 재구독(범위 밖), head 재구독
    expect(s.link.phase).toBe("live");
    expect(s.transcript?.status === "ready" ? s.transcript.itemIds : []).toEqual([itm(1)]);
    expect(loads).toHaveLength(2);
  });

  test("stream.chunk is decoded into a chunk input; an undecodable payload becomes 'other' and only advances n", async () => {
    const h = harness();
    const fake = fakeConnection({
      "events.subscribe": () =>
        Promise.resolve({ sub: "s1", start: 0, headSeq: 0, storeId: STORE, mode: "live" }),
      "thread.list": () => Promise.resolve({ threads: [], nextCursor: null }),
    });
    startLink({
      connection: fake.connection,
      store: h.store,
      transcripts: noTranscripts,
      logger: silent,
      openThreadId: () => null,
    });
    await tick();
    fake.emit("stream.chunk", chunk(0, good("Hel")));
    fake.emit("stream.chunk", chunk(1, { garbage: true }));
    fake.emit("stream.chunk", chunk(2, good("lo")));
    h.store.flush();
    const s = h.store.read.getState();
    expect(s.streaming.items[itm(1)]?.parts[0]?.text).toBe("Hello");
    expect(s.streaming.lastN[`${thr(1)}:`]).toBe(2);
  });

  test("a stale snapshot (asOfSeq older than the cursor at open time) is re-read instead of leaving 'loading' forever", async () => {
    const h = harness();
    const fake = fakeConnection({
      "events.subscribe": () =>
        Promise.resolve({ sub: "s1", start: 10, headSeq: 10, storeId: STORE, mode: "live" }),
      "thread.list": () => Promise.resolve(listEmpty),
    });
    let loads = 0;
    const transcripts: TranscriptPort = {
      load: () => {
        loads += 1;
        return Promise.resolve(loads === 1 ? snap(3) : snap(10, [userItem(1)]));
      },
    };
    const link = startLink({
      connection: fake.connection,
      store: h.store,
      transcripts,
      logger: silent,
      openThreadId: () => null,
    });
    await pump(h);
    link.openThread(thr(1));
    await pump(h);
    const t = h.store.read.getState().transcript;
    expect(loads).toBe(2);
    expect(t?.status).toBe("ready");
  });
});

const subscribeLive = (): Table => ({
  "events.subscribe": () =>
    Promise.resolve({ sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" }),
});
const start = (
  h: ReturnType<typeof harness>,
  fake: ReturnType<typeof fakeConnection>,
  transcripts = noTranscripts,
) =>
  startLink({
    connection: fake.connection,
    store: h.store,
    transcripts,
    logger: silent,
    openThreadId: () => null,
  });

describe("loading, failure and restoration after a reset", () => {
  test("thread.list failing leaves threads in error (not 'empty'); reloadThreads recovers", async () => {
    const h = harness();
    let fail = true;
    const fake = fakeConnection({
      ...subscribeLive(),
      "thread.list": () =>
        fail ? Promise.reject(new Error("not implemented")) : Promise.resolve(listEmpty),
    });
    const link = start(h, fake);
    await pump(h);
    expect(h.store.read.getState().threads.status).toBe("error");
    fail = false;
    link.reloadThreads();
    await pump(h);
    const threads = h.store.read.getState().threads;
    expect(threads.status).toBe("ready");
    expect(threads.ids).toEqual([thr(1)]);
  });

  test("thread.list pages are read until nextCursor is null before the list becomes ready", async () => {
    const h = harness();
    const cursors: unknown[] = [];
    const fake = fakeConnection({
      ...subscribeLive(),
      "thread.list": (params) => {
        cursors.push(params.cursor);
        return Promise.resolve(
          params.cursor === undefined
            ? { threads: [summary(thr(1))], nextCursor: "c2" }
            : { threads: [summary(thr(2))], nextCursor: null },
        );
      },
    });
    start(h, fake);
    await pump(h);
    expect(cursors).toEqual([undefined, "c2"]);
    expect(h.store.read.getState().threads.ids).toEqual([thr(1), thr(2)]);
  });

  test("pending approvals are restored with approval.list for threads that have some", async () => {
    const h = harness();
    const asked: unknown[] = [];
    const fake = fakeConnection({
      ...subscribeLive(),
      "thread.list": () =>
        Promise.resolve({
          threads: [summary(thr(1), { pendingApprovals: 1 }), summary(thr(2))],
          nextCursor: null,
        }),
      "approval.list": (params) => {
        asked.push(params.threadId);
        return Promise.resolve({
          approvals: [{ approvalId: evt(7), seq: 4, request: approvalRequest(thr(1)) }],
          position: { storeId: STORE, seq: 5 },
        });
      },
    });
    start(h, fake);
    await pump(h);
    expect(asked).toEqual([thr(1)]);
    expect(h.store.read.getState().approvals.ids).toEqual([evt(7)]);
  });

  test("approval.list failing only logs: the thread keeps its pending count", async () => {
    const h = harness();
    const fake = fakeConnection({
      ...subscribeLive(),
      "thread.list": () =>
        Promise.resolve({ threads: [summary(thr(1), { pendingApprovals: 2 })], nextCursor: null }),
      "approval.list": () => Promise.reject(new Error("nope")),
    });
    start(h, fake);
    await pump(h);
    const s = h.store.read.getState();
    expect(s.approvals.ids).toEqual([]);
    expect(s.threads.byId[thr(1)]?.pendingApprovals).toBe(2);
  });

  test("a failing snapshot port leaves the transcript in error; opening again recovers", async () => {
    const h = harness();
    let calls = 0;
    const transcripts: TranscriptPort = {
      load: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? { ok: false, error: { kind: "failed" } } : snap(9, [userItem(1)]),
        );
      },
    };
    const fake = fakeConnection({
      ...subscribeLive(),
      "thread.list": () => Promise.resolve(listEmpty),
    });
    const link = start(h, fake, transcripts);
    await pump(h);
    link.openThread(thr(1));
    await pump(h);
    expect(h.store.read.getState().transcript).toEqual({ status: "error", threadId: thr(1) });
    link.openThread(thr(1));
    await pump(h);
    expect(h.store.read.getState().transcript?.status).toBe("ready");
  });

  test("closeThread drops the cached transcript", async () => {
    const h = harness();
    const fake = fakeConnection({
      ...subscribeLive(),
      "thread.list": () => Promise.resolve(listEmpty),
    });
    const link = start(h, fake, { load: () => Promise.resolve(snap(9, [userItem(1)])) });
    await pump(h);
    link.openThread(thr(1));
    await pump(h);
    link.closeThread();
    h.store.flush();
    expect(h.store.read.getState().transcript).toBeNull();
  });
});
