import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { LifecycleError } from "@xeon/contracts/records";
import { WireError } from "@xeon/contracts/wire";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { ThreadReadFailure } from "../../src/types.ts";
import { FAKE_STORE_ID } from "../fixtures/fake-engine.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.2: thread.list, thread.read, thread.close, thread.fork, thread.revert, thread.delete, turn.interrupt, events.unsubscribe,
// host.status. 가짜 엔진 위의 실제 처리기·연결 허브다. 실제 저장소 위의 시험은 test/int/lifecycle.int.test.ts다.

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

const POSITION = { storeId: FAKE_STORE_ID, seq: 3 };
const ids = fixedIdFactory(900);
const OTHER_THREAD = ids.next("thr");
const RUNNING_TURN = ids.next("trn");

test("thread.list is forwarded to the thread port", async () => {
  const host = createFakeHost({
    overrides: { threads: { list: () => Promise.resolve({ threads: [], nextCursor: "c1" }) } },
  });
  const { connection } = await open(host);
  expect(await connection.request("thread.list", { limit: 5 })).toEqual({
    threads: [],
    nextCursor: "c1",
  });
  await connection.close();
});

test("thread.read maps the port's failures to wire errors and never takes ownership", async () => {
  const failures: readonly [ThreadReadFailure, number][] = [
    [{ kind: "invalid_target", reason: "not_on_branch" }, 3005],
    [{ kind: "thread_not_found", threadId: OTHER_THREAD }, 3001],
    [{ kind: "busy" }, 5003],
  ];
  await Promise.all(
    failures.map(async ([failure, code]) => {
      const host = createFakeHost({
        overrides: { threads: { read: () => Promise.resolve(err(failure)) } },
      });
      const threadId = host.fake.seedThread();
      const { connection } = await open(host);
      const error = await wireErrorOf(connection.request("thread.read", { threadId }));
      expect(error.code).toBe(code);
      expect(host.fake.acquisitions).toEqual([]);
      await connection.close();
    }),
  );
});

test("thread.read returns what the port read", async () => {
  const host = createFakeHost({
    overrides: {
      threads: {
        read: (params) =>
          Promise.resolve(
            ok({ threadId: params.threadId, items: [], position: POSITION, hasMore: false }),
          ),
      },
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = await open(host);
  expect(await connection.request("thread.read", { threadId })).toEqual({
    threadId,
    items: [],
    position: POSITION,
    hasMore: false,
  });
  await connection.close();
});

test("thread.close drops this connection's open records, and is thread.notFound for an unknown thread", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const { connection, served } = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  const state = host.hub.state(served.id);
  expect(state?.writeThreads.has(threadId)).toBe(true);
  expect(await connection.request("thread.close", { threadId })).toEqual({});
  expect(state?.openThreads.has(threadId)).toBe(false);
  expect(state?.writeThreads.has(threadId)).toBe(false);
  // 한 번 더 닫아도 오류가 아니다
  expect(await connection.request("thread.close", { threadId })).toEqual({});
  const unknown = host.fake.ids.next("thr");
  expect((await wireErrorOf(connection.request("thread.close", { threadId: unknown }))).code).toBe(
    3001,
  );
  await connection.close();
});

test("thread.close in service mode releases the lock when no other connection writes the thread (HS-27)", async () => {
  const host = createFakeHost({ mode: "service" });
  const threadId = host.fake.seedThread();
  const first = await open(host);
  const second = await open(host);
  await first.connection.request("thread.open", { threadId, mode: "write" });
  await second.connection.request("thread.open", { threadId, mode: "write" });
  await first.connection.request("thread.close", { threadId });
  expect(host.fake.released).toEqual([]);
  await second.connection.request("thread.close", { threadId });
  expect(host.fake.released).toEqual([threadId]);
  await first.connection.close();
  await second.connection.close();
});

test("thread.fork creates the new thread and gives this connection its write ownership", async () => {
  const forkedId: ThreadId = ids.next("thr");
  const calls: { threadId: ThreadId; at: string | undefined }[] = [];
  const host = createFakeHost({
    overrides: {
      threads: {
        fork: (threadId, at) => {
          calls.push({ threadId, at });
          return Promise.resolve(ok({ threadId: forkedId, position: POSITION }));
        },
      },
    },
  });
  const source = host.fake.seedThread();
  const { connection, served } = await open(host);
  const forked = await connection.request("thread.fork", { threadId: source });
  expect(forked.threadId).toBe(forkedId);
  expect(calls).toEqual([{ threadId: source, at: undefined }]);
  // 원본은 쥐지 않고 새 thread의 소유만 얻는다(원본이 잠겨 있을 때의 대안이 fork다)
  expect(host.fake.acquisitions.map((entry) => entry.threadId)).toEqual([forkedId]);
  expect(host.hub.state(served.id)?.writeThreads.has(forkedId)).toBe(true);
  await connection.close();
});

test("thread.fork reports lifecycle failures as wire errors", async () => {
  const cases: readonly [LifecycleError, number][] = [
    [{ kind: "invalid_target", reason: "item_not_found" }, 3005],
    [{ kind: "cancelled_by_extension", point: "session_before_fork", reason: null }, 3006],
    [{ kind: "thread_not_found", threadId: OTHER_THREAD }, 3001],
  ];
  await Promise.all(
    cases.map(async ([failure, code]) => {
      const host = createFakeHost({
        overrides: { threads: { fork: () => Promise.resolve(err(failure)) } },
      });
      const source = host.fake.seedThread();
      const { connection } = await open(host);
      expect(
        (await wireErrorOf(connection.request("thread.fork", { threadId: source }))).code,
      ).toBe(code);
      expect(host.fake.acquisitions).toEqual([]);
      await connection.close();
    }),
  );
});

test("thread.revert needs the write ownership and does not take it implicitly (HS-28)", async () => {
  const reverted: string[] = [];
  const host = createFakeHost({
    overrides: {
      threads: {
        revert: (threadId, to) => {
          reverted.push(`${threadId}:${to}`);
          return Promise.resolve(ok({ position: POSITION }));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const to = host.fake.ids.next("itm");
  const { connection } = await open(host);
  const refused = await wireErrorOf(connection.request("thread.revert", { threadId, to }));
  expect(refused.code).toBe(3002);
  expect(host.fake.acquisitions).toEqual([]);
  expect(reverted).toEqual([]);
  await connection.request("thread.open", { threadId, mode: "write" });
  expect(await connection.request("thread.revert", { threadId, to })).toEqual({
    position: POSITION,
  });
  expect(reverted).toEqual([`${threadId}:${to}`]);
  await connection.close();
});

test("thread.revert while a turn runs is turn.busy and a bad target is thread.invalidTarget", async () => {
  const outcomes: LifecycleError[] = [
    { kind: "turn_running", turnId: RUNNING_TURN },
    { kind: "invalid_target", reason: "inside_turn" },
  ];
  const host = createFakeHost({
    overrides: {
      threads: {
        revert: () => {
          const next = outcomes.shift();
          return Promise.resolve(next === undefined ? ok({ position: POSITION }) : err(next));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const to = host.fake.ids.next("itm");
  const { connection } = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  const busy = await wireErrorOf(connection.request("thread.revert", { threadId, to }));
  expect(busy.code).toBe(3003);
  expect(busy.data.details).toEqual({ turnId: RUNNING_TURN });
  const target = await wireErrorOf(connection.request("thread.revert", { threadId, to }));
  expect(target.code).toBe(3005);
  expect(target.data.details).toEqual({ reason: "inside_turn" });
  await connection.close();
});

test("thread.delete takes the ownership when it has none, removes, and clears every connection's records", async () => {
  const removed: ThreadId[] = [];
  const host = createFakeHost({
    overrides: {
      threads: {
        remove: (threadId) => {
          removed.push(threadId);
          return Promise.resolve(ok(undefined));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const watcher = await open(host);
  await watcher.connection.request("thread.open", { threadId, mode: "observe" });
  const { connection } = await open(host);
  expect(await connection.request("thread.delete", { threadId })).toEqual({});
  expect(host.fake.acquisitions).toEqual([{ threadId, kind: "cli" }]);
  expect(removed).toEqual([threadId]);
  expect(host.hub.state(watcher.served.id)?.observedThreads.has(threadId)).toBe(false);
  await watcher.connection.close();
  await connection.close();
});

test("thread.delete refused by another owner is thread.locked; a refused removal gives back the lock it took", async () => {
  const locked = createFakeHost({ lockedBy: "app" });
  const lockedThread = locked.fake.seedThread();
  const first = await open(locked);
  const denied = await wireErrorOf(
    first.connection.request("thread.delete", { threadId: lockedThread }),
  );
  expect(denied.code).toBe(3002);
  expect(denied.data.details).toMatchObject({ ownerKind: "app" });
  await first.connection.close();

  const host = createFakeHost({
    overrides: {
      threads: {
        remove: () => Promise.resolve(err({ kind: "has_forks", forks: [OTHER_THREAD] })),
      },
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = await open(host);
  const error = await wireErrorOf(connection.request("thread.delete", { threadId }));
  expect(error.code).toBe(3004);
  expect(error.data.details).toEqual({ forks: [OTHER_THREAD] });
  expect(host.fake.released).toEqual([threadId]);
  await connection.close();
});

test("thread.delete keeps a lock that a connection already held", async () => {
  const host = createFakeHost({
    overrides: {
      threads: { remove: () => Promise.resolve(err({ kind: "has_forks", forks: [] })) },
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  await wireErrorOf(connection.request("thread.delete", { threadId }));
  expect(host.fake.released).toEqual([]);
  expect(host.fake.held.has(threadId)).toBe(true);
  await connection.close();
});

test("turn.interrupt needs the ownership and reports whether a turn was stopped", async () => {
  const seen: (string | undefined)[] = [];
  const host = createFakeHost({
    overrides: {
      turns: {
        interrupt: (_threadId, turnId) => {
          seen.push(turnId);
          return Promise.resolve(true);
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const { connection } = await open(host);
  expect((await wireErrorOf(connection.request("turn.interrupt", { threadId }))).code).toBe(3002);
  await connection.request("thread.open", { threadId, mode: "write" });
  expect(await connection.request("turn.interrupt", { threadId })).toEqual({ interrupted: true });
  expect(seen).toEqual([undefined]);
  const unknown = host.fake.ids.next("thr");
  expect(
    (await wireErrorOf(connection.request("turn.interrupt", { threadId: unknown }))).code,
  ).toBe(3001);
  await connection.close();
});

test("events.unsubscribe removes the subscription; a second call is events.subscriptionNotFound", async () => {
  const host = createFakeHost();
  const { connection, served } = await open(host);
  const subscribed = await connection.request("events.subscribe", { from: "head" });
  expect(host.hub.state(served.id)?.subs.size).toBe(1);
  expect(await connection.request("events.unsubscribe", { sub: subscribed.sub })).toEqual({});
  expect(host.hub.state(served.id)?.subs.size).toBe(0);
  const again = await wireErrorOf(
    connection.request("events.unsubscribe", { sub: subscribed.sub }),
  );
  expect(again.code).toBe(2002);
  expect(again.data.details).toEqual({ sub: subscribed.sub });
  await connection.close();
});

test("events.unsubscribe stops delivery of later commits to that subscription", async () => {
  const host = createFakeHost();
  const { connection } = await open(host);
  const batches: number[] = [];
  connection.onNotification("events.batch", (params) => {
    batches.push(params.events.length);
  });
  const subscribed = await connection.request("events.subscribe", { from: "head" });
  host.fake.seedThread();
  await connection.request("events.unsubscribe", { sub: subscribed.sub });
  const before = batches.length;
  host.fake.seedThread();
  await connection.request("host.status", {});
  expect(batches.length).toBe(before);
  await connection.close();
});

test("host.status reports the mode, pid, start time, connections and live turns", async () => {
  const host = createFakeHost({ mode: "stdio" });
  const first = await open(host);
  const second = await open(host);
  const status = await first.connection.request("host.status", {});
  expect(status).toEqual({
    mode: "stdio",
    pid: 1,
    startedAt: new Date(host.fake.engine.startedAt).toISOString(),
    connections: 2,
    liveTurns: 0,
    idleShutdownAt: null,
  });
  await first.connection.close();
  await second.connection.close();
});
