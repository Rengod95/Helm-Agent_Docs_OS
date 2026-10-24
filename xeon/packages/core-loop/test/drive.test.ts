import { expect, test } from "bun:test";
import type { LoopTurnRequest } from "@xeon/contracts/extensions";
import { LoopRejection } from "../src/index.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, firstOfKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const answer = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

function request(h: Harness, overrides: Partial<LoopTurnRequest> = {}): LoopTurnRequest {
  return {
    threadId: h.threadId,
    scopeId: "smoke-group",
    leaseId: "lease-1",
    leaseEpoch: 1,
    requestId: "lease-1:0.0",
    input: { kind: "user", content: "drive this" },
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function rejectionOf(work: Promise<unknown>): Promise<LoopRejection | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof LoopRejection ? error : undefined;
  }
}

test("drive_turn_same_request_id_replays", async () => {
  const h = await createHarness({ script: [answer("first")] });
  const first = await h.loop.runTurn(request(h));
  expect(first.replayed).toBe(false);
  expect(first.outcome.status).toBe("completed");
  expect(first.usage?.totalTokens).toBe(10);

  const second = await h.loop.runTurn(request(h));
  expect(second.replayed).toBe(true);
  expect(second.outcome.turnId).toBe(first.outcome.turnId);
  expect(second.outcome.status).toBe("completed");
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(1);
  expect(h.models.requests).toHaveLength(1);
  // turn.started는 임대 scope와 requestId를 싣는다(멱등 키 (scopeId, requestId))
  expect(firstOfKind(h.fake.events(h.threadId), "turn.started")?.payload).toMatchObject({
    scopeId: "smoke-group",
    requestId: "lease-1:0.0",
  });
  // 입력 지점은 거치지 않고 큐도 쓰지 않는다
  expect(countKind(h.fake.events(h.threadId), "input.queued")).toBe(0);
});

test("a_drive_turn_with_a_stale_lease_epoch_is_rejected_without_opening_a_turn", async () => {
  const h = await createHarness({ script: [answer("never")] });
  h.fake.setLeaseEpoch(h.threadId, "smoke-group", 5);
  const rejection = await rejectionOf(h.loop.runTurn(request(h, { leaseEpoch: 3 })));
  expect(rejection?.loopError).toEqual({
    kind: "stale_lease",
    scopeId: "smoke-group",
    leaseEpoch: 3,
  });
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(0);
  expect(h.models.requests).toHaveLength(0);
});

test("a_cut_after_turn_started_continues_the_same_turn_on_the_second_call", async () => {
  const h = await createHarness({ script: [answer("lost")] });
  h.fake.crashAfter((key) => /^turn:.*:start$/.test(key));
  let thrown: unknown;
  try {
    await h.loop.runTurn(request(h));
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(1);

  const h2 = await h.restart({ script: [answer("recovered")] });
  const second = await h2.loop.runTurn(request(h2));
  expect(second.replayed).toBe(true);
  expect(second.outcome.status).toBe("completed");
  const events = h2.fake.events(h2.threadId);
  expect(countKind(events, "turn.started")).toBe(1);
  expect(countKind(events, "turn.completed")).toBe(1);
});

test("the_drive_signal_ends_the_turn_at_the_next_step_boundary", async () => {
  const controller = new AbortController();
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: () => {
          controller.abort();
          return Promise.resolve({ text: "A" });
        },
      },
    ],
    script: [
      {
        kind: "message",
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
        stopReason: "toolUse",
      },
      answer("never reached"),
    ],
  });
  const result = await h.loop.runTurn(request(h, { signal: controller.signal }));
  // 실행 중인 단계는 끝까지 가고 다음 요청은 나가지 않는다
  expect(h.models.requests).toHaveLength(1);
  expect(result.outcome.status).toBe("aborted");
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "aborted",
    stepCount: 1,
  });
});

test("a_drive_turn_is_not_interactive_and_user_input_still_starts_turns", async () => {
  const h = await createHarness({ script: [answer("drive"), answer("user")] });
  await h.loop.runTurn(request(h));
  const admitted = await h.loop.admit({
    threadId: h.threadId,
    content: "hello",
    via: "interactive",
  });
  expect(admitted.ok && admitted.value.status).toBe("started");
  await h.settle();
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(2);
});

test("spawn_and_runChildTurn_are_not_available_before_m2", async () => {
  const h = await createHarness();
  const spawn = await rejectionOf(
    h.loop.spawn({
      threadId: h.threadId,
      scopeId: "smoke-group",
      leaseId: "lease-1",
      leaseEpoch: 1,
      requestId: "r",
      spec: { agent: "x", task: "y" },
      signal: new AbortController().signal,
    }),
  );
  expect(spawn?.kind).toBe("input_invalid");
  const child = await h.loop.runChildTurn({
    threadId: h.threadId,
    input: { kind: "user", content: "x" },
    requestId: "r",
    systemPrompt: "p",
    model: "main",
    tools: {
      caller: "main",
      depth: 0,
      ceiling: { caller: "main", depth: 0, mode: "default" },
      surfaceThreadId: h.threadId,
      interactive: false,
    },
    scope:
      h.loop.threadStatus(h.threadId).runningTurnId === null
        ? h.tasks.service.root
        : h.tasks.service.root,
    signal: new AbortController().signal,
  });
  expect(child.ok).toBe(false);
});
