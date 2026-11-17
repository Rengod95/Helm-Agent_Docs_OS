// 알림 흐름 제어 장치의 값 시험(isolation/notify-gate.ts). 합치기는 `coalesce` 핸들러에만 걸리고, 나머지는 대기열에 순서대로 쌓인다.
import { expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
import {
  createNotifyGate,
  NOTIFY_INFLIGHT_MAX,
  NOTIFY_QUEUE_MAX,
  notifyKeyOf,
} from "../../src/isolation/notify-gate.ts";
import { recordingLogger } from "./support/fake-process.ts";

function rig() {
  const sent: JsonObject[] = [];
  const events: string[] = [];
  const gate = createNotifyGate({
    send: (params) => {
      sent.push(params);
      return Promise.resolve(true);
    },
    setTimer: () => () => undefined,
    now: () => 0,
    logger: recordingLogger(events),
  });
  return { gate, sent, events };
}

function route(coalesce: boolean) {
  return {
    key: notifyKeyOf("r", "request.stream", 0, "t"),
    handler: "r:request.stream:0",
    point: "request.stream",
    coalesce,
  };
}

function fill(gate: ReturnType<typeof rig>["gate"], coalesce: boolean, from: number, to: number) {
  for (let index = from; index <= to; index += 1) {
    gate.offer(route(coalesce), `k${String(index)}`, { n: index });
  }
}

test("a coalesce route covers notifications past the inflight limit with one slot and reports the covered count", () => {
  const { gate, sent } = rig();
  fill(gate, true, 1, NOTIFY_INFLIGHT_MAX + 5);
  expect(sent).toHaveLength(NOTIFY_INFLIGHT_MAX);
  gate.acknowledge("k1");
  const last = sent.at(-1);
  expect(sent).toHaveLength(NOTIFY_INFLIGHT_MAX + 1);
  expect(last).toEqual({
    n: NOTIFY_INFLIGHT_MAX + 5,
    eventKey: `k${String(NOTIFY_INFLIGHT_MAX + 5)}`,
    dropped: 4,
  });
});

test("an every route queues the same notifications and delivers each one in order with no dropped count", () => {
  const { gate, sent } = rig();
  fill(gate, false, 1, NOTIFY_INFLIGHT_MAX + 3);
  expect(sent).toHaveLength(NOTIFY_INFLIGHT_MAX);
  gate.acknowledge("k1");
  gate.acknowledge("k2");
  gate.acknowledge("k3");
  expect(sent.slice(NOTIFY_INFLIGHT_MAX)).toEqual([
    { n: NOTIFY_INFLIGHT_MAX + 1, eventKey: `k${String(NOTIFY_INFLIGHT_MAX + 1)}` },
    { n: NOTIFY_INFLIGHT_MAX + 2, eventKey: `k${String(NOTIFY_INFLIGHT_MAX + 2)}` },
    { n: NOTIFY_INFLIGHT_MAX + 3, eventKey: `k${String(NOTIFY_INFLIGHT_MAX + 3)}` },
  ]);
});

test("an every route past the queue limit is cut with an error record, and its queued notifications are dropped", () => {
  const { gate, sent, events } = rig();
  fill(gate, false, 1, NOTIFY_INFLIGHT_MAX + NOTIFY_QUEUE_MAX + 1);
  expect(events).toEqual(["plugin_host.notify_overflow"]);
  gate.acknowledge("k1");
  gate.offer(route(false), "late", { n: 0 });
  expect(sent).toHaveLength(NOTIFY_INFLIGHT_MAX);
  // 프로세스가 새로 뜨면 끊김이 풀린다
  gate.reset();
  gate.offer(route(false), "fresh", { n: 0 });
  expect(sent).toHaveLength(NOTIFY_INFLIGHT_MAX + 1);
});
