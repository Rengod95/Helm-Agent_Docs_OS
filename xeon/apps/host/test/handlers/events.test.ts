import { expect, test } from "bun:test";
import {
  findBatchIssue,
  WireError,
  type EventsBatchParams,
  type StoreId,
  type StreamChunkParams,
  type Transport,
} from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { FAKE_STORE_ID, type FakeEngine } from "../fixtures/fake-engine.ts";
import { rawClient } from "../fixtures/raw-client.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { flushMicrotasks, settleUntil } from "../fixtures/clock.ts";
import { sequentially } from "../../src/util.ts";

const OTHER_STORE: StoreId = "sto_00000000000000000000000000";

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

function seedThread(host: FakeHost): ThreadId {
  const threadId = host.fake.ids.next("thr");
  host.fake.commit([{ kind: "thread.started", threadId }]);
  return threadId;
}

function seedEvents(fake: FakeEngine, threadId: ThreadId, count: number): void {
  for (let index = 0; index < count; index += 1) {
    fake.commit([{ kind: "item.recorded", threadId }]);
  }
}

/** 켜 두면 보내는 메시지를 붙잡아 두는 전송. 송신 큐가 비지 않는 상황을 만든다 */
function gated(): {
  readonly wrap: (server: Transport) => Transport;
  hold(): void;
  release(): void;
} {
  const state: { held: boolean; waiters: (() => void)[] } = { held: false, waiters: [] };
  return {
    wrap: (server) => ({
      ...server,
      async send(message) {
        if (state.held) await new Promise<void>((resolve) => state.waiters.push(resolve));
        await server.send(message);
      },
    }),
    hold() {
      state.held = true;
    },
    release() {
      state.held = false;
      for (const resolve of state.waiters.splice(0)) resolve();
    },
  };
}

function batchesOf(raw: ReturnType<typeof rawClient>): EventsBatchParams[] {
  const out: EventsBatchParams[] = [];
  for (const { message } of raw.received) {
    if (
      typeof message === "object" &&
      message !== null &&
      "method" in message &&
      message.method === "events.batch" &&
      "params" in message
    ) {
      // 시험 안에서만 쓰는 좁힘: 서버가 보낸 events.batch의 params다
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 서버가 보낸 알림을 시험이 읽는다 (eng.typescript.guide TY-06)
      out.push(message.params as EventsBatchParams);
    }
  }
  return out;
}

function chunksOf(raw: ReturnType<typeof rawClient>): StreamChunkParams[] {
  const out: StreamChunkParams[] = [];
  for (const { message } of raw.received) {
    if (
      typeof message === "object" &&
      message !== null &&
      "method" in message &&
      message.method === "stream.chunk" &&
      "params" in message
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 서버가 보낸 알림을 시험이 읽는다 (eng.typescript.guide TY-06)
      out.push(message.params as StreamChunkParams);
    }
  }
  return out;
}

test("subscribe-replay-no-dup: commits during a replay arrive once, in order, and only the last batch is caughtUp", async () => {
  const state: { host: FakeHost | undefined; thread: ThreadId | undefined } = {
    host: undefined,
    thread: undefined,
  };
  const host = createFakeHost({
    limits: { replayBatchMaxEvents: 2, sendLowWaterBytes: 1 },
    onRead(call) {
      // 첫 읽기 직전에 커밋 두 번, 둘째 읽기 직전에 한 번 더 끼워 넣는다
      const thread = state.thread;
      if (thread === undefined || state.host === undefined) return;
      if (call === 0) {
        state.host.fake.commit([{ kind: "item.recorded", threadId: thread }]);
        state.host.fake.commit([
          { kind: "item.recorded", threadId: thread },
          { kind: "item.recorded", threadId: thread },
        ]);
      }
      if (call === 1) state.host.fake.commit([{ kind: "item.recorded", threadId: thread }]);
    },
  });
  state.host = host;
  const thread = seedThread(host);
  state.thread = thread;
  seedEvents(host.fake, thread, 6);
  const head = host.fake.events.length; // 7

  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  const subscribed = await connection.request("events.subscribe", {
    from: { storeId: FAKE_STORE_ID, seq: 1 },
  });
  expect(subscribed.mode).toBe("replaying");
  expect(subscribed.start).toBe(1);
  expect(subscribed.headSeq).toBe(head);

  // 마지막 caughtUp까지 기다린다
  await settleUntil(() => batchesOf(raw).some((batch) => batch.caughtUp));
  const batches = batchesOf(raw);
  const seqs = batches.flatMap((batch) => batch.events.map((event) => event.seq));
  const finalHead = host.fake.events.length;
  expect(finalHead).toBe(head + 4);
  expect(seqs).toEqual(Array.from({ length: finalHead - 1 }, (_, index) => index + 2));
  expect(findBatchIssue(1, batches)).toBeUndefined();
  expect(batches.map((batch) => batch.caughtUp)).toEqual(
    batches.map((_, index) => index === batches.length - 1),
  );
  // 응답이 그 구독의 첫 알림보다 먼저다
  const responseIndex = raw.received.findIndex(
    (entry) =>
      typeof entry.message === "object" && entry.message !== null && "result" in entry.message,
  );
  const firstBatchIndex = raw.received.findIndex(
    (entry) =>
      typeof entry.message === "object" && entry.message !== null && "method" in entry.message,
  );
  expect(responseIndex).toBeGreaterThan(-1);
  expect(responseIndex).toBeLessThan(firstBatchIndex);

  // 이어서 실시간으로 커밋하면 caughtUp 알림이 하나씩 온다
  host.fake.commit([{ kind: "item.recorded", threadId: thread }]);
  await flushMicrotasks();
  const live = batchesOf(raw).at(-1);
  expect(live?.from).toBe(finalHead);
  expect(live?.to).toBe(finalHead + 1);
  expect(live?.caughtUp).toBe(true);
  await connection.close();
});

test("replay-out-of-range-reasons: each failure is 2001 with the bounds in details", async () => {
  const host = createFakeHost({ oldestReplayable: 3, limits: { maxReplayEvents: 1000 } });
  const thread = seedThread(host);
  seedEvents(host.fake, thread, 9); // head 10
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const expectReason = async (
    from: { storeId: StoreId; seq: number },
    reason: string,
  ): Promise<void> => {
    const error = await wireErrorOf(connection.request("events.subscribe", { from }));
    expect(error.code).toBe(2001);
    expect(error.data.details).toEqual({
      reason,
      storeId: FAKE_STORE_ID,
      headSeq: 10,
      oldestReplayableSeq: 3,
    });
  };
  await expectReason({ storeId: OTHER_STORE, seq: 5 }, "storeMismatch");
  await expectReason({ storeId: FAKE_STORE_ID, seq: 11 }, "aheadOfHead");
  await expectReason({ storeId: FAKE_STORE_ID, seq: 2 }, "beforeOldest");
  await connection.close();
});

test("replay-out-of-range-reasons: a gap larger than maxReplayEvents is tooFar", async () => {
  const host = createFakeHost({ limits: { maxReplayEvents: 3 } });
  const thread = seedThread(host);
  seedEvents(host.fake, thread, 9); // head 10
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(
    connection.request("events.subscribe", { from: { storeId: FAKE_STORE_ID, seq: 2 } }),
  );
  expect(error.code).toBe(2001);
  expect(error.data.details).toMatchObject({ reason: "tooFar", headSeq: 10 });
  // 한도 안이면 받는다
  const ok = await connection.request("events.subscribe", {
    from: { storeId: FAKE_STORE_ID, seq: 7 },
  });
  expect(ok.start).toBe(7);
  await connection.close();
});

test("subscription-limit: the 17th subscription is 2003 with the limit", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  await sequentially(Array.from({ length: 16 }), () =>
    connection.request("events.subscribe", { from: "head" }).then(() => undefined),
  );
  const error = await wireErrorOf(connection.request("events.subscribe", { from: "head" }));
  expect(error.code).toBe(2003);
  expect(error.data.details).toEqual({ max: 16 });
  await connection.close();
});

test("events.filterInvalid: a prefix both included and excluded is 2004", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(
    connection.request("events.subscribe", {
      from: "head",
      filter: { kindPrefixes: ["item."], excludeKindPrefixes: ["item."] },
    }),
  );
  expect(error.code).toBe(2004);
  await connection.close();
});

test("a filter delivers only matching events and an empty batch moves the position for the rest (HS-14)", async () => {
  const host = createFakeHost();
  const thread = seedThread(host);
  const other = seedThread(host);
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  const subscribed = await connection.request("events.subscribe", {
    from: "head",
    filter: { threadIds: [thread], kindPrefixes: ["item."] },
  });
  expect(subscribed.mode).toBe("live");
  const start = subscribed.start;

  // 한 JS 턴에 맞지 않는 커밋이 둘: 빈 알림 하나로 합쳐진다
  host.fake.commit([{ kind: "item.recorded", threadId: other }]);
  host.fake.commit([{ kind: "turn.started", threadId: thread }]);
  expect(batchesOf(raw)).toHaveLength(0);
  await flushMicrotasks();
  const empty = batchesOf(raw);
  expect(empty).toHaveLength(1);
  expect(empty[0]).toMatchObject({ from: start, to: start + 2, events: [], caughtUp: true });

  host.fake.commit([
    { kind: "item.recorded", threadId: other },
    { kind: "item.recorded", threadId: thread },
  ]);
  await flushMicrotasks();
  const matched = batchesOf(raw).at(-1);
  expect(matched?.from).toBe(start + 2);
  expect(matched?.to).toBe(start + 4);
  expect(matched?.events.map((event) => event.seq)).toEqual([start + 4]);
  expect(findBatchIssue(start, batchesOf(raw))).toBeUndefined();
  await connection.close();
});

test("stream-chunk-not-replayed: chunks go only to connections that opened the thread, are never replayed, and are dropped under backpressure", async () => {
  const host = createFakeHost({ limits: { sendLowWaterBytes: 1 } });
  const gate = gated();
  const owner = host.connect(gate.wrap);
  const rawOwner = rawClient(owner.client);
  const bystander = host.connect();
  const rawBystander = rawClient(bystander.client);
  await owner.connection.request("host.hello", HELLO_PARAMS);
  await bystander.connection.request("host.hello", HELLO_PARAMS);
  const created = await owner.connection.request("thread.create", {});
  const turn = host.fake.ids.next("trn");

  host.fake.emitVolatile({ threadId: created.threadId, turnId: turn, n: 0, afterSeq: 1 });
  await flushMicrotasks();
  host.fake.emitVolatile({ threadId: created.threadId, turnId: turn, n: 1, afterSeq: 1 });
  await flushMicrotasks();
  expect(chunksOf(rawOwner).map((chunk) => chunk.event.n)).toEqual([0, 1]);
  expect(chunksOf(rawBystander)).toHaveLength(0);

  // 재구독한 연결에 이전 조각이 다시 오지 않는다
  const resubscribed = await owner.connection.request("events.subscribe", { from: "head" });
  expect(resubscribed.mode).toBe("live");
  expect(chunksOf(rawOwner).map((chunk) => chunk.event.n)).toEqual([0, 1]);

  // 송신 큐가 저수위를 넘으면 버린다
  gate.hold();
  host.fake.emitVolatile({ threadId: created.threadId, turnId: turn, n: 2, afterSeq: 1 });
  host.fake.emitVolatile({ threadId: created.threadId, turnId: turn, n: 3, afterSeq: 1 });
  gate.release();
  await flushMicrotasks();
  host.fake.emitVolatile({ threadId: created.threadId, turnId: turn, n: 4, afterSeq: 1 });
  await flushMicrotasks();
  const delivered = chunksOf(rawOwner).map((chunk) => chunk.event.n);
  expect(delivered).not.toContain(3);
  expect(delivered).toContain(4);
  await owner.connection.close();
  await bystander.connection.close();
});

test("a subscribe cancelled while its response waits for the send queue is 5001 and leaves no subscription", async () => {
  const host = createFakeHost({ limits: { sendLowWaterBytes: 1 } });
  const gate = gated();
  const { client, connection, served } = host.connect(gate.wrap);
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  // 앞선 응답이 송신 큐에 남도록 붙잡는다
  gate.hold();
  const stuck = connection.request("settings.get", {});
  await flushMicrotasks();
  const controller = new AbortController();
  const pending = wireErrorOf(
    connection.request("events.subscribe", { from: "head" }, { signal: controller.signal }),
  );
  await flushMicrotasks();
  expect(host.hub.state(served.id)?.subs.size).toBe(1);
  controller.abort();
  await flushMicrotasks();
  gate.release();
  await stuck;
  const error = await pending;
  expect(error.code).toBe(5001);
  expect(host.hub.state(served.id)?.subs.size).toBe(0);
  // 응답 뒤의 취소는 무시된다
  const ok = await connection.request("events.subscribe", { from: "head" });
  await raw.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r4" } });
  await flushMicrotasks();
  expect(host.hub.state(served.id)?.subs.has(ok.sub)).toBe(true);
  await connection.close();
});

test("closing a connection removes its subscriptions", async () => {
  const host = createFakeHost();
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });
  const state = host.hub.state(served.id);
  expect(state?.subs.size).toBe(1);
  await connection.close();
  expect(host.hub.state(served.id)).toBeUndefined();
});
