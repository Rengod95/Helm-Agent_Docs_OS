import { expect, test } from "bun:test";
import { THREADLESS_NOTICE_SEQ_BASE, type Notice } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { flushMicrotasks, settleUntil } from "../fixtures/clock.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import type { ServerNotificationParams } from "@fresnel/contracts/wire";

// notify.delivered(F wire §3.3.2, L4.host-service HS-94, D-M3-17). 알림 하나를 준비된(ready) 연결 모두에 한 번씩 보낸다. 종류별 설정
// `l2.dialog.notify.<kind>`가 꺼져 있으면 보내지 않는다. 구독은 호스트 fan-out을 멈추면 뗀다. 실제 엔진 시험은 test/int/notify.int.test.ts다.
// 대화에 묶이지 않은 알림(threadId가 null)은 대화 범위 없이 설정을 읽고, 보낼 때 threadId를 null로 싣는다.

/** 가짜 엔진의 시계(RECORDED_AT, 2026-01-05T00:00:00.000Z)와 같은 시각. 알림이 생긴 시각은 보내는 쪽이 정하지 않는다 */
const CREATED_AT = 1_767_571_200_000;

const COMPLETED: Notice = {
  kind: "completed",
  title: "작업이 끝났다",
  body: null,
  seq: 7,
  sourceType: "turn.completed",
  createdAt: CREATED_AT,
};

const ERROR: Notice = {
  kind: "error",
  title: "턴이 실패했다",
  body: "model failed",
  seq: 8,
  sourceType: "turn.completed",
  createdAt: CREATED_AT,
};

/** 대화 없는 실패 알림(예약 실행이 대화를 열기 전에 실패). seq는 기준값 이상이다 */
const THREADLESS: Notice = {
  kind: "error",
  title: "A scheduled run failed",
  body: "start_failed",
  seq: THREADLESS_NOTICE_SEQ_BASE + 3,
  sourceType: "schedule.run_finished",
  createdAt: CREATED_AT,
};

/** 가짜 엔진의 시계(RECORDED_AT, 2026-01-05T00:00:00.000Z)를 쓴 시각 */
const DELIVERED_AT = "2026-01-05T00:00:00.000Z";

interface Seen {
  readonly who: string;
  readonly params: ServerNotificationParams<"notify.delivered">;
}

test("a notice reaches every ready connection once as notify.delivered with the thread, the notice and the engine clock", async () => {
  const host = createFakeHost();
  const first = host.connect().connection;
  const second = host.connect().connection;
  const awaiting = host.connect().connection;
  await first.request("host.hello", HELLO_PARAMS);
  await second.request("host.hello", HELLO_PARAMS);
  const seen: Seen[] = [];
  first.onNotification("notify.delivered", (params) => {
    seen.push({ who: "first", params });
  });
  second.onNotification("notify.delivered", (params) => {
    seen.push({ who: "second", params });
  });
  awaiting.onNotification("notify.delivered", (params) => {
    seen.push({ who: "awaiting", params });
  });
  const thread = host.fake.seedThread();
  host.fake.emitNotice(thread, COMPLETED);
  await settleUntil(() => seen.length >= 2);
  await flushMicrotasks();
  expect(seen).toEqual([
    {
      who: "first",
      params: { threadId: thread, notice: COMPLETED, deliveredAt: DELIVERED_AT },
    },
    {
      who: "second",
      params: { threadId: thread, notice: COMPLETED, deliveredAt: DELIVERED_AT },
    },
  ]);
  await first.close();
  await second.close();
  await awaiting.close();
});

test("a connection that has closed gets no notify.delivered", async () => {
  const host = createFakeHost();
  const live = host.connect().connection;
  const gone = host.connect().connection;
  await live.request("host.hello", HELLO_PARAMS);
  await gone.request("host.hello", HELLO_PARAMS);
  const seen: string[] = [];
  live.onNotification("notify.delivered", () => {
    seen.push("live");
  });
  gone.onNotification("notify.delivered", () => {
    seen.push("gone");
  });
  await gone.close();
  host.fake.emitNotice(host.fake.seedThread(), COMPLETED);
  await settleUntil(() => seen.length >= 1);
  await flushMicrotasks();
  expect(seen).toEqual(["live"]);
  await live.close();
});

test("a kind turned off by its setting is not delivered, and the other kinds still are", async () => {
  const host = createFakeHost({
    layers: [{ scope: "user", values: new Map([["l2.dialog.notify.completed", false]]) }],
  });
  const connection = host.connect().connection;
  await connection.request("host.hello", HELLO_PARAMS);
  const kinds: string[] = [];
  connection.onNotification("notify.delivered", (params) => {
    kinds.push(params.notice.kind);
  });
  const thread = host.fake.seedThread();
  host.fake.emitNotice(thread, COMPLETED);
  host.fake.emitNotice(thread, ERROR);
  await settleUntil(() => kinds.length >= 1);
  await flushMicrotasks();
  expect(kinds).toEqual(["error"]);
  await connection.close();
});

test("stopping the host's fan-out unsubscribes from the notice port, so later notices are not delivered", async () => {
  const host = createFakeHost();
  const connection = host.connect().connection;
  await connection.request("host.hello", HELLO_PARAMS);
  const kinds: string[] = [];
  connection.onNotification("notify.delivered", (params) => {
    kinds.push(params.notice.kind);
  });
  const thread = host.fake.seedThread();
  host.fake.emitNotice(thread, COMPLETED);
  await settleUntil(() => kinds.length >= 1);
  host.hub.dispose();
  host.fake.emitNotice(thread, ERROR);
  await settleUntil(() => false, 20);
  await flushMicrotasks();
  expect(kinds).toEqual(["completed"]);
  await connection.close();
});

test("host.hello lists notify.delivered and notify.list among the features the host implements", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  expect(names).toContain("notify.delivered");
  expect(names).toContain("notify.list");
  await connection.close();
});

test("a thread-less notice reaches every ready connection with a null threadId, and its gate is read without a thread", async () => {
  const asked: (ThreadId | undefined)[] = [];
  const host = createFakeHost({
    overrides: {
      settings: {
        layers: (threadId) => {
          asked.push(threadId);
          return [];
        },
      },
    },
  });
  const first = host.connect().connection;
  const second = host.connect().connection;
  await first.request("host.hello", HELLO_PARAMS);
  await second.request("host.hello", HELLO_PARAMS);
  const seen: Seen[] = [];
  first.onNotification("notify.delivered", (params) => {
    seen.push({ who: "first", params });
  });
  second.onNotification("notify.delivered", (params) => {
    seen.push({ who: "second", params });
  });
  // 연결 준비 중에도 설정을 읽을 수 있으므로 알림이 낸 읽기만 센다
  asked.splice(0, asked.length);
  host.fake.emitNotice(null, THREADLESS);
  await settleUntil(() => seen.length >= 2);
  await flushMicrotasks();
  expect(asked).toEqual([undefined]);
  expect(seen).toEqual([
    {
      who: "first",
      params: { threadId: null, notice: THREADLESS, deliveredAt: DELIVERED_AT },
    },
    {
      who: "second",
      params: { threadId: null, notice: THREADLESS, deliveredAt: DELIVERED_AT },
    },
  ]);
  await first.close();
  await second.close();
});

test("a thread-less notice whose kind is turned off is not pushed, and a thread-less notice of an enabled kind still is", async () => {
  const host = createFakeHost({
    layers: [{ scope: "user", values: new Map([["l2.dialog.notify.error", false]]) }],
  });
  const connection = host.connect().connection;
  await connection.request("host.hello", HELLO_PARAMS);
  const heard: { threadId: ThreadId | null; kind: string }[] = [];
  connection.onNotification("notify.delivered", (params) => {
    heard.push({ threadId: params.threadId, kind: params.notice.kind });
  });
  host.fake.emitNotice(null, THREADLESS);
  host.fake.emitNotice(null, { ...COMPLETED, seq: THREADLESS_NOTICE_SEQ_BASE + 4 });
  await settleUntil(() => heard.length >= 1);
  await flushMicrotasks();
  expect(heard).toEqual([{ threadId: null, kind: "completed" }]);
  await connection.close();
});
