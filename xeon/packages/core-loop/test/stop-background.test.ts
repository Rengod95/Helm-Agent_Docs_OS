import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { LoopSpawnRequest } from "@fresnel/contracts/extensions";
import type {
  ChildTurnRequest,
  SpawnOrigin,
  SpawnRequest,
  SpawnResult,
  TaskScope,
} from "@fresnel/contracts/services";
import { createHarness, type Harness } from "./support/harness.ts";
import { firstOfKind } from "./support/inspect.ts";

// 사용자 중지(interrupt)는 이 대화의 백그라운드 서브에이전트도 멈춘다 [결정: 2026-11-17 사용자].
// 백그라운드 노드는 thread 노드 아래에 `background: true`로 열리고(core-agents parentScopeOf), 자식 turn은 runChildTurn으로 돈다.

type ChildTurn = ReturnType<Harness["loop"]["runChildTurn"]>;

interface BackgroundChild {
  readonly threadId: ThreadId;
  readonly node: TaskScope;
  readonly turn: ChildTurn;
}

/** 마이크로태스크를 비우며 조건이 참이 되기를 기다린다. 횟수에 상한이 있고 시간에 기대지 않는다 */
async function until(h: Harness, done: () => boolean, budget = 200): Promise<void> {
  if (done() || budget === 0) {
    expect(done()).toBe(true);
    return;
  }
  await h.tick();
  return until(h, done, budget - 1);
}

/** thread 노드를 연다. core-agents는 thread 노드가 없으면 백그라운드 노드를 열지 않는다(needsThread) */
async function openThreadNode(h: Harness): Promise<void> {
  await h.loop.whenIdle(h.threadId, () => Promise.resolve());
}

function childRequest(threadId: ThreadId, scope: TaskScope): ChildTurnRequest {
  return {
    threadId,
    input: { kind: "user", content: "watch the build" },
    requestId: "child-req-1",
    systemPrompt: "You are the watcher subagent.",
    model: "subagent",
    tools: {
      caller: "subagent:watcher",
      depth: 1,
      ceiling: { caller: "main", depth: 0, mode: "acceptEdits" },
      surfaceThreadId: threadId,
      interactive: false,
    },
    scope,
    signal: new AbortController().signal,
  };
}

/** thread 아래 background 노드를 열고 그 자식 thread turn을 돌린다(core-agents의 백그라운드 자식과 같은 모양) */
async function backgroundChild(h: Harness, parent: ThreadId): Promise<BackgroundChild> {
  const parentNode = h.tasks.service.find("thread", parent);
  if (parentNode === undefined) throw new Bug("stop-background: the thread node is not open");
  const threadId = h.fake.startThread();
  await h.host.host.openThread(threadId);
  const node = h.tasks.service.openScope(parentNode, {
    kind: "subagent",
    id: threadId,
    background: true,
  });
  const turn = node.track(h.loop.runChildTurn(childRequest(threadId, node)));
  return { threadId, node, turn };
}

function spawnRequest(h: Harness): LoopSpawnRequest {
  return {
    threadId: h.threadId,
    scopeId: "smoke-group",
    leaseId: "lease-1",
    leaseEpoch: 1,
    requestId: "lease-1:0.0",
    spec: { agent: "watcher", task: "watch the build" },
    signal: new AbortController().signal,
  };
}

test("an_interrupt_with_no_turn_stops_the_background_node_of_a_drive_spawn", async () => {
  const opened = Promise.withResolvers<BackgroundChild>();
  const state: { h: Harness | null } = { h: null };
  const h = await createHarness({
    script: [{ kind: "stall" }],
    // core-agents가 drive의 turn 밖 spawn에서 하는 일을 흉내 낸다: thread 아래 background 노드를 열고 자식 turn을 기다린다
    agents: () => ({
      spawn: async (request: SpawnRequest, origin: SpawnOrigin): Promise<SpawnResult> => {
        if (state.h === null) throw new Bug("stop-background: harness is not ready");
        const child = await backgroundChild(state.h, origin.parentThreadId);
        opened.resolve(child);
        const result = await child.turn;
        return {
          childThreadId: child.threadId,
          status: result.ok ? result.value.outcome.status : "error",
          requestId: request.requestId ?? "",
          report: null,
          usage: result.ok ? (result.value.usage ?? null) : null,
          reused: false,
        };
      },
    }),
  });
  state.h = h;
  await openThreadNode(h);
  const spawned = h.loop.spawn(spawnRequest(h));
  const child = await opened.promise;
  await until(h, () => h.models.requests.length > 0);
  expect(h.loop.status(h.threadId)).toBe("idle");

  expect(await h.loop.interrupt(h.threadId)).toBe(true);
  // 취소됐는지 먼저 본다. 취소되지 않았다면 아래 기다림이 끝나지 않는다
  expect(child.node.signal.aborted).toBe(true);
  expect(child.node.abortReason).toEqual({ code: "user", message: null });

  expect(await spawned).toMatchObject({ outcome: { status: "aborted" } });
  await h.settle();
  expect(child.node.state).toBe("settled");
  expect(firstOfKind(h.fake.events(child.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
  });
});

test("an_interrupt_stops_the_running_turn_and_the_background_child_together", async () => {
  const h = await createHarness({ script: [{ kind: "stall" }, { kind: "stall" }] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await until(h, () => h.models.requests.length > 0);
  const child = await backgroundChild(h, h.threadId);
  await until(h, () => h.models.requests.length > 1);
  expect(h.loop.status(h.threadId)).toBe("running");

  expect(await h.loop.interrupt(h.threadId)).toBe(true);
  expect(child.node.signal.aborted).toBe(true);
  expect(child.node.abortReason).toEqual({ code: "user", message: null });

  await h.settle();
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
  });
  expect(firstOfKind(h.fake.events(child.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
  });
  expect(child.node.state).toBe("settled");
});

test("without a background child or a turn an interrupt answers false, and still does after a stop", async () => {
  const h = await createHarness({ script: [{ kind: "stall" }] });
  expect(await h.loop.interrupt(h.threadId)).toBe(false);
  await openThreadNode(h);
  expect(await h.loop.interrupt(h.threadId)).toBe(false);

  const child = await backgroundChild(h, h.threadId);
  await until(h, () => h.models.requests.length > 0);
  expect(await h.loop.interrupt(h.threadId)).toBe(true);
  await h.settle();
  expect(child.node.state).toBe("settled");
  // 정착한 백그라운드 노드는 다시 세지 않는다
  expect(await h.loop.interrupt(h.threadId)).toBe(false);
});

test("an_interrupt_that_closes_a_stale_open_turn_also_stops_the_background_child", async () => {
  // 이전 프로세스가 남긴 열린 turn: 재시작하면 turn은 이 프로세스에서 돌지 않고 열린 채 남는다
  const h = await createHarness({ script: [{ kind: "stall" }] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await until(h, () => h.models.requests.length > 0);

  const h2 = await h.restart({ script: [{ kind: "stall" }] });
  await openThreadNode(h2);
  const child = await backgroundChild(h2, h2.threadId);
  await until(h2, () => h2.models.requests.length > 0);
  expect(h2.loop.status(h2.threadId)).toBe("idle");

  expect(await h2.loop.interrupt(h2.threadId)).toBe(true);
  expect(child.node.signal.aborted).toBe(true);
  expect(child.node.abortReason).toEqual({ code: "user", message: null });

  await h2.settle();
  expect(child.node.state).toBe("settled");
});
