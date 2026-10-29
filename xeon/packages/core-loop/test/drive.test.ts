import { expect, test } from "bun:test";
import type { LoopSpawnRequest, LoopTurnRequest } from "@xeon/contracts/extensions";
import type { SpawnOrigin, SpawnRequest } from "@xeon/contracts/services";
import type { Usage } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { LoopRejection } from "../src/index.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, firstOfKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const CHILD_THREAD = fixedIdFactory(5).next("thr");
const CHILD_USAGE: Usage = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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

test("spawn_is_not_available_before_core_agents", async () => {
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
});

function spawnRequest(h: Harness, overrides: Partial<LoopSpawnRequest> = {}): LoopSpawnRequest {
  return {
    threadId: h.threadId,
    scopeId: "smoke-group",
    leaseId: "lease-1",
    leaseEpoch: 1,
    requestId: "lease-1:0.0",
    spec: { agent: "explorer", task: "find it" },
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("spawn_delegates_to_agents_with_the_drive_owner_and_maps_the_result", async () => {
  const calls: { request: SpawnRequest; origin: SpawnOrigin }[] = [];
  const h = await createHarness({
    agents: () => ({
      spawn: (request, origin) => {
        calls.push({ request, origin });
        return Promise.resolve({
          childThreadId: CHILD_THREAD,
          status: "completed",
          answer: "found",
          requestId: request.requestId ?? "",
          report: null,
          usage: CHILD_USAGE,
          reused: calls.length > 1,
        });
      },
    }),
  });
  const request = spawnRequest(h);
  const first = await h.loop.spawn(request);
  expect(first).toEqual({
    outcome: { childThreadId: CHILD_THREAD, status: "completed", answer: "found" },
    replayed: false,
    usage: CHILD_USAGE,
  });
  const second = await h.loop.spawn(request);
  expect(second.replayed).toBe(true);
  expect(calls[0]?.request).toEqual({
    agent: "explorer",
    task: "find it",
    requestId: "lease-1:0.0",
  });
  expect(calls[0]?.origin).toMatchObject({
    parentThreadId: h.threadId,
    owner: { kind: "drive", turnId: null, scopeId: "smoke-group", leaseId: "lease-1" },
    caller: "main",
    depth: 0,
    ownerRequestId: "lease-1:0.0",
  });
});

test("spawn_rejects_a_background_request", async () => {
  const h = await createHarness({
    agents: () => ({ spawn: () => Promise.reject(new Error("must not be called")) }),
  });
  const rejection = await rejectionOf(
    h.loop.spawn(spawnRequest(h, { spec: { agent: "x", task: "y", background: true } })),
  );
  expect(rejection?.loopError.kind).toBe("input_invalid");
});

test("spawn_with_a_stale_lease_epoch_is_fenced_before_any_child_is_created", async () => {
  const spawned: string[] = [];
  const h = await createHarness({
    agents: () => ({
      spawn: (request) => {
        spawned.push(request.requestId ?? "");
        return Promise.reject(new Error("must not be called"));
      },
    }),
  });
  // 저장된 scope 임대 차수(5)가 요청 차수(3)보다 높다: 늦게 도착한 spawn이다(§4.8 펜싱)
  h.fake.setLeaseEpoch(h.threadId, "smoke-group", 5);
  const rejection = await rejectionOf(h.loop.spawn(spawnRequest(h, { leaseEpoch: 3 })));
  expect(rejection?.loopError).toEqual({
    kind: "stale_lease",
    scopeId: "smoke-group",
    leaseEpoch: 3,
  });
  expect(spawned).toEqual([]);
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(0);
});

test("spawn_with_the_current_lease_epoch_passes_the_fence_and_calls_agents", async () => {
  const spawned: string[] = [];
  const h = await createHarness({
    agents: () => ({
      spawn: (request) => {
        spawned.push(request.requestId ?? "");
        return Promise.resolve({
          childThreadId: CHILD_THREAD,
          status: "completed",
          answer: "found",
          requestId: request.requestId ?? "",
          report: null,
          usage: CHILD_USAGE,
          reused: false,
        });
      },
    }),
  });
  h.fake.setLeaseEpoch(h.threadId, "smoke-group", 5);
  const result = await h.loop.spawn(spawnRequest(h, { leaseEpoch: 5 }));
  expect(result.outcome.status).toBe("completed");
  expect(spawned).toEqual(["lease-1:0.0"]);
});
