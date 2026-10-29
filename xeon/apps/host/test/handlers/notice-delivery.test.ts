import { expect, test } from "bun:test";
import type { Notice } from "@xeon/contracts/capabilities";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { flushMicrotasks, settleUntil } from "../fixtures/clock.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import type { ServerNotificationParams } from "@xeon/contracts/wire";

// notify.delivered(F wire §3.3.2, L4.host-service HS-94, D-M3-17). 알림 하나를 준비된(ready) 연결 모두에 한 번씩 보낸다. 종류별 설정
// `l2.dialog.notify.<kind>`가 꺼져 있으면 보내지 않는다. 구독은 호스트 fan-out을 멈추면 뗀다. 실제 엔진 시험은 test/int/notify.int.test.ts다.

const COMPLETED: Notice = {
  kind: "completed",
  title: "작업이 끝났다",
  body: null,
  seq: 7,
  sourceType: "turn.completed",
};

const ERROR: Notice = {
  kind: "error",
  title: "턴이 실패했다",
  body: "model failed",
  seq: 8,
  sourceType: "turn.completed",
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
