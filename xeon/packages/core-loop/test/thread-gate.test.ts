import { expect, test } from "bun:test";
import type { LoopTurnRequest } from "@xeon/contracts/extensions";
import { createThreadGate } from "../src/thread-gate.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, payloadField } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// L1.loop.spec §2 "thread 구동기": 우선순위 0(큐 입력)이 1(drive turn)보다 먼저 들어간다. 같은 우선순위는 도착 순서다.

/** 잠금을 쥔 채 `order`에 이름을 남기는 작업을 줄 세운다. 호출 순서가 도착 순서다 */
function enqueue(
  gate: ReturnType<typeof createThreadGate>,
  priority: 0 | 1,
  name: string,
  order: string[],
): Promise<void> {
  return gate.run(priority, () => {
    order.push(name);
    return Promise.resolve();
  });
}

test("a_priority_0_waiter_runs_before_a_priority_1_waiter_that_arrived_earlier", async () => {
  const gate = createThreadGate();
  const order: string[] = [];
  const release = Promise.withResolvers<void>();
  const holder = gate.run(0, async () => {
    await release.promise;
    order.push("holder");
  });
  const late = enqueue(gate, 1, "priority-1", order);
  const early = enqueue(gate, 0, "priority-0", order);
  expect(gate.held()).toBe(true);
  expect(gate.waiting()).toBe(2);
  release.resolve();
  await Promise.all([holder, late, early]);
  expect(order).toEqual(["holder", "priority-0", "priority-1"]);
  expect(gate.held()).toBe(false);
  expect(gate.waiting()).toBe(0);
});

test("waiters_of_the_same_priority_run_in_arrival_order", async () => {
  const gate = createThreadGate();
  const order: string[] = [];
  const release = Promise.withResolvers<void>();
  const holder = gate.run(1, async () => {
    await release.promise;
  });
  const waiters = [
    enqueue(gate, 1, "a1", order),
    enqueue(gate, 0, "b0", order),
    enqueue(gate, 1, "c1", order),
    enqueue(gate, 0, "d0", order),
  ];
  release.resolve();
  await Promise.all([holder, ...waiters]);
  // 우선순위 0이 앞, 각 우선순위 안에서는 도착 순서(a1 c1은 1끼리, b0 d0은 0끼리)
  expect(order).toEqual(["b0", "d0", "a1", "c1"]);
});

test("a_rejected_holder_still_releases_the_gate_to_the_next_waiter", async () => {
  const gate = createThreadGate();
  const order: string[] = [];
  const failing = gate.run(0, () => Promise.reject(new Error("holder failed")));
  const next = enqueue(gate, 1, "after-failure", order);
  const settled = await Promise.allSettled([failing, next]);
  expect(settled.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
  expect(order).toEqual(["after-failure"]);
  expect(gate.held()).toBe(false);
});

// 서비스 수준: 실행 중인 turn 안에서 drive `runTurn`을 먼저 걸고 큐 입력(`admit`)을 나중에 건다.
// 큐 입력의 turn이 drive turn보다 먼저 시작해야 한다(priority 0이 1보다 먼저).

const answer = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

const callRead = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
});

function driveRequest(h: Harness): LoopTurnRequest {
  return {
    threadId: h.threadId,
    scopeId: "smoke-group",
    leaseId: "lease-1",
    leaseEpoch: 1,
    requestId: "lease-1:0.0",
    input: { kind: "user", content: "drive this" },
    signal: new AbortController().signal,
  };
}

test("a_queued_input_turn_starts_before_a_drive_turn_requested_earlier_while_a_turn_runs", async () => {
  const pending: { drive: Promise<unknown> | null } = { drive: null };
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: async () => {
          // 이 turn이 도는 동안 drive 요청이 먼저, 큐 입력이 나중에 들어온다
          pending.drive = h.loop.runTurn(driveRequest(h));
          await h.loop.admit({ threadId: h.threadId, content: "queued", via: "interactive" });
          return { text: "A" };
        },
      },
    ],
    script: [callRead("c1"), answer("first done"), answer("queued done"), answer("drive done")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  await pending.drive;
  await h.settle();

  const events = h.fake.events(h.threadId);
  // 시작 순서: 처음 입력(null), 큐 입력(null), drive turn("smoke-group"). drive가 먼저 나오면 순서가 어긋난다
  const starts = events.filter((event) => event.kind === "turn.started");
  expect(starts.map((event) => payloadField(event, "scopeId"))).toEqual([
    null,
    null,
    "smoke-group",
  ]);
  expect(countKind(events, "turn.completed")).toBe(3);
  // 둘째 모델 요청(큐 turn의 첫 요청)은 큐 입력으로 끝난다
  expect(h.models.requests[2]?.messages.at(-1)).toMatchObject({ role: "user", content: "queued" });
});
