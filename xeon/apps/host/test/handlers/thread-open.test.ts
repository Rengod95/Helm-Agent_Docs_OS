import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { WireError } from "@xeon/contracts/wire";
import { OBSERVE_POLL_MS } from "../../src/handlers/observe.ts";
import { flushMicrotasks, settleUntil } from "../fixtures/clock.ts";
import { FAKE_STORE_ID } from "../fixtures/fake-engine.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.1: thread.open(HS-23~HS-28), 관찰 폴링(HS-16), 잠금 해제 조건(HS-27). 가짜 엔진 위의 실제 처리기·연결 허브다.
// 실제 OS 잠금과 sys_leases 위의 시험은 test/int/thread-locked.int.test.ts다.

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

async function open(host: FakeHost) {
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return { connection, served };
}

test("thread.open is implemented, so the hello features list it", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("thread.open");
  await connection.close();
});

test("thread.open write takes the ownership, returns role owner and the position, and opens the thread for chunks", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const { connection, served } = await open(host);
  const opened = await connection.request("thread.open", { threadId, mode: "write" });
  expect(opened).toEqual({
    threadId,
    role: "owner",
    position: { storeId: FAKE_STORE_ID, seq: 1 },
  });
  expect(host.fake.acquisitions).toEqual([{ threadId, kind: "cli" }]);
  const state = host.hub.state(served.id);
  expect(state?.openThreads.has(threadId)).toBe(true);
  expect(state?.writeThreads.has(threadId)).toBe(true);
  expect(state?.observedThreads.has(threadId)).toBe(false);
  await connection.close();
});

test("a second connection to the same host opens the thread as owner too, without a second acquisition (HS-23)", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const first = await open(host);
  const second = await open(host);
  await first.connection.request("thread.open", { threadId, mode: "write" });
  const again = await second.connection.request("thread.open", { threadId, mode: "write" });
  expect(again.role).toBe("owner");
  expect(host.fake.acquisitions).toHaveLength(1);
  await first.connection.close();
  await second.connection.close();
});

test("thread.open on an unknown thread is thread.notFound in both modes", async () => {
  const host = createFakeHost();
  const { connection } = await open(host);
  const threadId = host.fake.ids.next("thr");
  const errors = await Promise.all(
    (["write", "observe"] as const).map((mode) =>
      wireErrorOf(connection.request("thread.open", { threadId, mode })),
    ),
  );
  for (const error of errors) {
    expect(error.code).toBe(3001);
    expect(error.data.details).toEqual({ threadId });
  }
  expect(host.fake.acquisitions).toEqual([]);
  await connection.close();
});

test("thread.open write on a thread another process owns is 3002 with the owner kind and the alternatives, and records nothing", async () => {
  const host = createFakeHost({ lockedBy: "service" });
  const threadId = host.fake.seedThread();
  const { connection, served } = await open(host);
  const error = await wireErrorOf(connection.request("thread.open", { threadId, mode: "write" }));
  expect(error.code).toBe(3002);
  expect(error.data.retryable).toBe(true);
  expect(error.data.details).toEqual({ ownerKind: "service", options: ["observe", "fork"] });
  expect(host.hub.state(served.id)?.openThreads.has(threadId)).toBe(false);
  expect(host.hub.state(served.id)?.writeThreads.has(threadId)).toBe(false);
  await connection.close();
});

test("thread.open observe takes no lock, returns role observer and opens the thread for chunks", async () => {
  const host = createFakeHost({ lockedBy: "app" });
  const threadId = host.fake.seedThread();
  const { connection, served } = await open(host);
  const opened = await connection.request("thread.open", { threadId, mode: "observe" });
  expect(opened.role).toBe("observer");
  expect(opened.position.seq).toBe(1);
  expect(host.fake.acquisitions).toEqual([]);
  const state = host.hub.state(served.id);
  expect(state?.openThreads.has(threadId)).toBe(true);
  expect(state?.observedThreads.has(threadId)).toBe(true);
  expect(state?.writeThreads.has(threadId)).toBe(false);
  await connection.close();
});

test("observe-poll: commits of another process reach an observer within one poll, once and in order; the poll stops with the observer", async () => {
  const host = createFakeHost({ lockedBy: "app" });
  const threadId = host.fake.seedThread();
  const { connection } = await open(host);
  const collected = collectEvents(connection);
  // 관찰하는 연결이 없으면 폴링하지 않는다
  expect(host.fake.scheduler.pending).toBe(0);
  await connection.request("thread.open", { threadId, mode: "observe" });
  const subscribed = await connection.request("events.subscribe", {
    from: "head",
    filter: { threadIds: [threadId] },
  });
  expect(subscribed.headSeq).toBe(1);
  expect(host.fake.scheduler.pending).toBe(1);

  // 다른 프로세스의 커밋은 이 프로세스의 커밋 알림으로 오지 않는다
  host.fake.commitForeign([
    { kind: "turn.started", threadId },
    { kind: "item.recorded", threadId },
  ]);
  await flushMicrotasks();
  expect(collected.events).toEqual([]);
  host.fake.scheduler.advance(OBSERVE_POLL_MS);
  await settleUntil(() => collected.events.length === 2);
  expect(collected.events.map((event) => event.seq)).toEqual([2, 3]);

  // 다음 폴링은 새 커밋만 전한다
  host.fake.commitForeign([{ kind: "item.recorded", threadId }]);
  host.fake.scheduler.advance(OBSERVE_POLL_MS);
  await settleUntil(() => collected.events.length === 3);
  host.fake.scheduler.advance(OBSERVE_POLL_MS);
  await flushMicrotasks();
  expect(collected.events.map((event) => event.seq)).toEqual([2, 3, 4]);

  // 관찰하는 연결이 닫히면 다음 폴링에서 멈춘다
  await connection.close();
  host.fake.scheduler.advance(OBSERVE_POLL_MS);
  expect(host.fake.scheduler.pending).toBe(0);
});

test("observe-poll: this process's own commit and a foreign commit before it are each delivered once, with no gap (HS-16)", async () => {
  const host = createFakeHost({ lockedBy: "app" });
  const threadId = host.fake.seedThread();
  const mine = host.fake.seedThread();
  const { connection } = await open(host);
  const collected = collectEvents(connection);
  await connection.request("thread.open", { threadId, mode: "observe" });
  await connection.request("events.subscribe", { from: "head" });

  host.fake.commitForeign([
    { kind: "turn.started", threadId },
    { kind: "item.recorded", threadId },
  ]);
  // 폴링이 오기 전에 이 프로세스가 커밋한다: 사이의 구간(seq 3, 4)이 먼저 메워져야 한다
  host.fake.commit([{ kind: "item.recorded", threadId: mine }]);
  await settleUntil(() => collected.events.length === 3);
  expect(collected.events.map((event) => event.seq)).toEqual([3, 4, 5]);

  host.fake.scheduler.advance(OBSERVE_POLL_MS);
  await flushMicrotasks();
  expect(collected.events.map((event) => event.seq)).toEqual([3, 4, 5]);
  await connection.close();
});

test("a thread this process owns is not polled: its commits come from the commit notice", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const owner = await open(host);
  const watcher = await open(host);
  await owner.connection.request("thread.open", { threadId, mode: "write" });
  await watcher.connection.request("thread.open", { threadId, mode: "observe" });
  expect(host.fake.scheduler.pending).toBe(0);
  await owner.connection.close();
  await watcher.connection.close();
});

test("a connection that closes while it waits for the lock leaves nothing recorded, and a service host gives the lock back", async () => {
  const gate = Promise.withResolvers<void>();
  const host = createFakeHost({ mode: "service", acquireGate: gate.promise });
  const threadId = host.fake.seedThread();
  const { connection, served } = await open(host);
  const pending = rejectionOf(connection.request("thread.open", { threadId, mode: "write" }));
  await settleUntil(() => host.fake.acquisitions.length === 1);
  await served.close();
  gate.resolve();
  await pending;
  await settleUntil(() => host.fake.released.length > 0);
  expect(host.fake.released).toEqual([threadId]);
  expect(host.hub.state(served.id)).toBeUndefined();
});

function releaseFixture(mode: "service" | "in-process") {
  const host = createFakeHost({ mode });
  const threadId: ThreadId = host.fake.seedThread();
  return { host, threadId };
}

test("service mode gives the lock back when the last connection that opened the thread for writing leaves (HS-27)", async () => {
  const { host, threadId } = releaseFixture("service");
  const first = await open(host);
  const second = await open(host);
  await first.connection.request("thread.open", { threadId, mode: "write" });
  await second.connection.request("thread.open", { threadId, mode: "write" });
  await first.connection.close();
  await flushMicrotasks();
  expect(host.fake.released).toEqual([]);
  await second.connection.close();
  await settleUntil(() => host.fake.released.length > 0);
  expect(host.fake.released).toEqual([threadId]);
  expect(host.fake.held.has(threadId)).toBe(false);
});

test("service mode keeps the lock while a turn is live, and an observer does not hold it", async () => {
  const { host, threadId } = releaseFixture("service");
  const writer = await open(host);
  const watcher = await open(host);
  await writer.connection.request("thread.open", { threadId, mode: "write" });
  await watcher.connection.request("thread.open", { threadId, mode: "observe" });
  host.fake.setRunningTurn(host.fake.ids.next("trn"));
  await writer.connection.close();
  await flushMicrotasks();
  expect(host.fake.released).toEqual([]);
  await watcher.connection.close();
});

test("in-process and stdio keep the lock until the process ends", async () => {
  const { host, threadId } = releaseFixture("in-process");
  const { connection } = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  await connection.close();
  await flushMicrotasks();
  expect(host.fake.released).toEqual([]);
  expect(host.fake.held.has(threadId)).toBe(true);
});
