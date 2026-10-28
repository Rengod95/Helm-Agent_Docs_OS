import { describe, expect, test } from "bun:test";
import { attemptAsync } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SpawnOrigin } from "@xeon/contracts/services";
import { spawnRecorder } from "../src/testing/index.ts";
import { EXPLORER, openHarness, type Harness } from "./support/harness.ts";

function kinds(h: Harness, threadId?: ThreadId): string[] {
  return h.session.events
    .filter((event) => threadId === undefined || event.threadId === threadId)
    .map((event) => event.kind);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>();
}

describe("spawn", () => {
  test("an unexpected failure inside the child run is not recorded as aborted and releases the slot", async () => {
    const h = openHarness({
      run: () => Promise.reject(new TypeError("loop exploded")),
    });
    const { origin } = h.openToolCall("tc-boom");
    const spawned = await attemptAsync(() =>
      h.service.spawn({ agent: "explorer", task: "look" }, origin),
    );
    expect(spawned.ok).toBe(false);
    if (!spawned.ok) expect(spawned.error.cause).toMatchObject({ message: "loop exploded" });
    expect(kinds(h, h.parentThreadId)).not.toContain("agent.settled");
    expect(h.tasks.limiter("subagents").inUse()).toBe(0);
    expect(h.service.liveCount()).toBe(0);
  });

  test("a foreground spawn creates the child, links it, runs one turn and settles with a guarded report", async () => {
    const h = openHarness();
    const { origin } = h.openToolCall("tc-1");
    const result = await h.service.spawn({ agent: "explorer", task: "look around" }, origin);
    expect(result.status).toBe("completed");
    expect(result.reused).toBe(false);
    expect(result.requestId).toBe("tool:tc-1:spawn:0");
    expect(result.answer).toContain("found it");
    expect(result.answer).toContain(
      `<subagent_report agent="explorer" thread="${result.childThreadId}" status="completed">`,
    );
    expect(result.report?.flags).toEqual([]);
    // 자식 thread.started 뒤 부모 agent.spawned, 그 뒤 agent.settled
    expect(kinds(h, h.parentThreadId).filter((kind) => kind.startsWith("agent."))).toEqual([
      "agent.spawned",
      "agent.settled",
    ]);
    const started = h.session.events.find(
      (event) => event.kind === "thread.started" && event.threadId === result.childThreadId,
    );
    const spawned = h.session.events.find((event) => event.kind === "agent.spawned");
    expect((started?.seq ?? Infinity) < (spawned?.seq ?? 0)).toBe(true);
    // 자식 turn 요청: 정의 prompt, 모델 역할, 호출 주체와 깊이
    const request = h.loop.calls[0];
    expect(request).toMatchObject({
      threadId: result.childThreadId,
      requestId: "tool:tc-1:spawn:0",
      systemPrompt: EXPLORER.prompt,
      model: "subagent",
      input: { kind: "user", content: "look around" },
      tools: {
        caller: "subagent:explorer",
        depth: 1,
        surfaceThreadId: h.parentThreadId,
        interactive: true,
      },
    });
    // 임대와 슬롯은 놓였다
    expect(h.session.released).toEqual([result.childThreadId]);
    expect(h.tasks.limiter("subagents").inUse()).toBe(0);
    expect(h.service.liveCount()).toBe(0);
  });

  test("usage_attributed_once: the child's usage is only in agent.settled", async () => {
    const h = openHarness({
      run: (request, session) =>
        Promise.resolve({
          status: "completed",
          finalItemId: session.seedAssistantItem(request.threadId, "ok"),
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        }),
    });
    const { origin } = h.openToolCall("tc-1");
    const result = await h.service.spawn({ agent: "explorer", task: "t" }, origin);
    expect(result.usage?.totalTokens).toBe(15);
    const settled = h.session.events.find((event) => event.kind === "agent.settled");
    expect(JSON.stringify(settled?.payload)).toContain('"totalTokens":15');
    expect(h.session.events.filter((event) => event.kind === "turn.completed")).toEqual([]);
  });

  test("failures are values: unknown definition, depth, background spawn, parent aborting", async () => {
    const h = openHarness({ maxDepth: 1 });
    const { origin, controller } = h.openToolCall("tc-1");
    const unknown = await h.service.spawn({ agent: "ghost", task: "t" }, origin);
    expect(unknown).toMatchObject({ status: "error", report: null, reused: false });
    expect(unknown.answer).toContain("agents.unknown_definition");
    const deep = await h.service.spawn(
      { agent: "explorer", task: "t" },
      { ...origin, depth: 1, ownerRequestId: "tool:tc-2" },
    );
    expect(deep.answer).toContain("agents.depth_exceeded");
    const background = await h.service.spawn(
      { agent: "explorer", task: "t", background: true },
      origin,
    );
    expect(background.answer).toContain("agents.invalid_request");
    controller.abort();
    const aborting = await h.service.spawn({ agent: "explorer", task: "t" }, origin);
    expect(aborting.answer).toContain("agents.parent_aborting");
    // 어느 경우에도 자식 thread를 만들지 않았다
    expect(h.session.created).toEqual([h.parentThreadId]);
  });

  // spec plan depth_one_rejects_nested_spawn
  test("depth_one_rejects_nested_spawn: maxDepth 2 allows a grandchild", async () => {
    const h = openHarness({ maxDepth: 2 });
    const { origin } = h.openToolCall("tc-1");
    const child = await h.service.spawn({ agent: "explorer", task: "t" }, origin);
    expect(child.status).toBe("completed");
    const nested: SpawnOrigin = {
      parentThreadId: child.childThreadId,
      owner: { kind: "tool", turnId: h.ids.next("trn"), toolCallId: "tc-nested" },
      caller: "subagent:explorer",
      depth: 1,
      ownerRequestId: "tool:tc-nested",
      signal: new AbortController().signal,
    };
    // 손자는 깊이 2로 허용된다. 자식 thread의 부모 연결은 세션이 쓰기 소유한 대화에만 쓴다
    const grandchild = await h.service.spawn({ agent: "explorer", task: "t" }, nested);
    expect(grandchild.status).toBe("completed");
    const tooDeep = await h.service.spawn(
      { agent: "explorer", task: "t" },
      { ...nested, depth: 2, ownerRequestId: "tool:tc-deeper" },
    );
    expect(tooDeep.answer).toContain("agents.depth_exceeded");
  });
});

describe("requestId derivation", () => {
  // spec plan spawn_request_id_derivation
  test("spawn_request_id_derivation: n counts per owner request, explicit ids are kept, long ids are hashed", async () => {
    const h = openHarness();
    const { origin } = h.openToolCall("tc-1");
    const first = await h.service.spawn({ agent: "explorer", task: "t" }, origin);
    const second = await h.service.spawn({ agent: "explorer", task: "t" }, origin);
    expect([first.requestId, second.requestId]).toEqual(["tool:tc-1:spawn:0", "tool:tc-1:spawn:1"]);
    const explicit = await h.service.spawn(
      { agent: "explorer", task: "t", requestId: "helm:inq-1:spawn:0:lens-a" },
      origin,
    );
    expect(explicit.requestId).toBe("helm:inq-1:spawn:0:lens-a");
    const long = await h.service.spawn(
      { agent: "explorer", task: "t", requestId: `helm:${"x".repeat(80)}` },
      origin,
    );
    expect(long.requestId).toMatch(/^spawn:[0-9a-f]{40}$/);
    expect(long.requestId.length).toBeLessThanOrEqual(64);
  });
});

describe("idempotency and resume", () => {
  // spec plan spawn_request_id_idempotent_after_resume
  test("a settled requestId is reused without running again", async () => {
    const h = openHarness();
    const { origin } = h.openToolCall("tc-1");
    const first = await h.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    const again = await h.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    expect(again).toMatchObject({
      childThreadId: first.childThreadId,
      status: "completed",
      reused: true,
    });
    expect(again.answer).toBe(first.answer);
    expect(h.loop.calls).toHaveLength(1);
    expect(kinds(h).filter((kind) => kind === "agent.spawned")).toHaveLength(1);
  });

  test("two concurrent calls with one requestId share one child", async () => {
    const gate = deferred<void>();
    const h = openHarness({
      run: async (request, session) => {
        await gate.promise;
        return {
          status: "completed",
          finalItemId: session.seedAssistantItem(request.threadId, "x"),
        };
      },
    });
    const { origin } = h.openToolCall("tc-1");
    const first = h.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    // 첫 호출이 live 표에 오를 때까지 한 번 기다린다
    await Promise.resolve();
    await Promise.resolve();
    const second = h.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.childThreadId).toBe(b.childThreadId);
    expect(b.reused).toBe(true);
    expect(h.loop.calls).toHaveLength(1);
  });

  test("a child cut off by a restart is resumed on the same conversation, once", async () => {
    const hang = deferred<never>();
    const before = openHarness({ run: () => hang.promise });
    const { origin } = before.openToolCall("tc-1");
    void before.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(kinds(before).filter((kind) => kind === "agent.spawned")).toHaveLength(1);
    const childId = before.session.created.at(-1);
    if (childId === undefined) throw new Error("no child was created");
    // 프로세스가 죽었다: 같은 세션(저장소)에 새 서비스를 올린다
    const after = openHarness({ session: before.session });
    const parentId = before.parentThreadId;
    const sameOrigin: SpawnOrigin = {
      ...origin,
      parentThreadId: parentId,
      signal: new AbortController().signal,
    };
    const resumed = await after.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      sameOrigin,
    );
    expect(resumed).toMatchObject({ childThreadId: childId, status: "completed", reused: true });
    expect(kinds(after).filter((kind) => kind === "agent.spawned")).toHaveLength(1);
    expect(
      after.session.events.filter(
        (event) => event.kind === "thread.started" && event.threadId === childId,
      ),
    ).toHaveLength(1);
    // 자식 임대를 다시 얻어 쓰기로 열었다
    expect(after.session.opened).toContain(childId);
    expect(after.loop.calls).toHaveLength(1);
  });

  test("a crash between the child's creation and the link reuses the child through creationKey", async () => {
    const h = openHarness();
    const { origin } = h.openToolCall("tc-1");
    h.session.failNextCommit({ kind: "busy" });
    const failed = await h.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    expect(failed.answer).toContain("agents.unavailable");
    expect(h.session.created).toHaveLength(2);
    const retry = await h.service.spawn(
      { agent: "explorer", task: "t", requestId: "tool:tc-1:spawn:0" },
      origin,
    );
    expect(retry.status).toBe("completed");
    // 두 번째 시도는 새 자식을 만들지 않았다
    expect(h.session.created).toHaveLength(2);
    expect(String(retry.childThreadId)).toBe(String(h.session.created[1]));
    expect(
      h.session.events.filter(
        (event) => event.kind === "thread.started" && event.threadId === retry.childThreadId,
      ),
    ).toHaveLength(1);
  });
});

describe("cancellation and settling order", () => {
  // spec plan foreground_child_settles_before_parent_end
  test("foreground_child_settles_before_parent_end: aborting the parent turn settles the child first", async () => {
    const started = deferred<void>();
    const h = openHarness({
      run: async (request) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        return { status: "aborted" };
      },
    });
    const { origin, tool } = h.openToolCall("tc-1");
    const turn = tool.parent;
    if (turn === null) throw new Error("no turn node");
    const spawning = h.service.spawn({ agent: "explorer", task: "t" }, origin);
    await started.promise;
    const ticket = await h.tasks.abort(turn, { code: "user", message: null });
    expect(ticket.ok).toBe(true);
    const outcome = await spawning;
    expect(outcome.status).toBe("aborted");
    // 부모 turn 노드의 정착은 자식 노드가 정착한 뒤다
    await turn.settle();
    const settled = h.session.events.find((event) => event.kind === "agent.settled");
    expect(settled).toBeDefined();
    expect(outcome.answer).toContain("[xeon:subagent_aborted]");
  });

  test("cancel aborts a running child and it settles aborted", async () => {
    const started = deferred<void>();
    const h = openHarness({
      run: async (request) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        return { status: "aborted" };
      },
    });
    const { origin } = h.openToolCall("tc-1");
    const spawning = h.service.spawn({ agent: "explorer", task: "t" }, origin);
    await started.promise;
    const childId = h.session.created.at(-1);
    if (childId === undefined) throw new Error("no child");
    expect(h.service.status(h.parentThreadId, "tool:tc-1:spawn:0")).toMatchObject({
      state: "running",
    });
    expect(await h.service.cancel({ childThreadId: childId }, "stop")).toEqual({ cancelled: true });
    expect((await spawning).status).toBe("aborted");
    expect(h.service.status(h.parentThreadId, "tool:tc-1:spawn:0")).toMatchObject({
      state: "settled",
    });
    expect(await h.service.cancel({ childThreadId: childId }, "again")).toEqual({
      cancelled: false,
    });
  });

  test("cancel by owner scope finds nothing when no delegation is live", async () => {
    const h = openHarness({ run: () => Promise.resolve({ status: "completed" }) });
    expect(await h.service.cancel({ ownerScopeId: "learning" }, "group off")).toEqual({
      cancelled: false,
    });
  });

  test("a drive-style origin signal outside the task tree also aborts the child", async () => {
    const started = deferred<void>();
    const h = openHarness({
      run: async (request) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        return { status: "aborted" };
      },
    });
    const { origin, controller } = h.openToolCall("tc-1");
    const spawning = h.service.spawn({ agent: "explorer", task: "t" }, origin);
    await started.promise;
    controller.abort();
    expect((await spawning).status).toBe("aborted");
  });
});

describe("concurrency", () => {
  // spec plan concurrency_cap_queues_extra_spawns
  test("concurrency_cap_queues_extra_spawns: maxConcurrent 2 queues the third until one settles", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let index = 0;
    const h = openHarness({
      maxConcurrent: 2,
      run: async (request, session) => {
        const gate = gates[index];
        index += 1;
        await gate?.promise;
        return {
          status: "completed",
          finalItemId: session.seedAssistantItem(request.threadId, "x"),
        };
      },
    });
    const calls = ["tc-1", "tc-2", "tc-3"].map((id) => h.openToolCall(id));
    const results = calls.map((call) =>
      h.service.spawn({ agent: "explorer", task: "t" }, call.origin),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.loop.calls).toHaveLength(2);
    expect(h.service.status(h.parentThreadId, "tool:tc-3:spawn:0")).toMatchObject({
      state: "queued",
    });
    gates[0]?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.loop.calls).toHaveLength(3);
    gates[1]?.resolve();
    gates[2]?.resolve();
    const done = await Promise.all(results);
    expect(done.map((result) => result.status)).toEqual(["completed", "completed", "completed"]);
  });

  test("the global subagents pool of 1 serializes children in FIFO order", async () => {
    const order: string[] = [];
    const h = openHarness({
      maxConcurrent: 8,
      run: (request, session) => {
        order.push(request.requestId);
        return Promise.resolve({
          status: "completed",
          finalItemId: session.seedAssistantItem(request.threadId, "x"),
        });
      },
    });
    h.tasks.limits.subagents.capacity = 1;
    const calls = ["a", "b", "c"].map((id) => h.openToolCall(id));
    const results = await Promise.all(
      calls.map((call) => h.service.spawn({ agent: "explorer", task: "t" }, call.origin)),
    );
    expect(results.every((result) => result.status === "completed")).toBe(true);
    expect(order).toEqual(["tool:a:spawn:0", "tool:b:spawn:0", "tool:c:spawn:0"]);
  });

  test("a queued child cancelled by its parent never runs and settles aborted (spec §5 case 10)", async () => {
    const hold = deferred<void>();
    const h = openHarness({
      maxConcurrent: 1,
      run: async (request, session) => {
        await hold.promise;
        return {
          status: "completed",
          finalItemId: session.seedAssistantItem(request.threadId, "x"),
        };
      },
    });
    const first = h.openToolCall("tc-1");
    const second = h.openToolCall("tc-2");
    const running = h.service.spawn({ agent: "explorer", task: "t" }, first.origin);
    const queued = h.service.spawn({ agent: "explorer", task: "t" }, second.origin);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.loop.calls).toHaveLength(1);
    second.controller.abort();
    expect((await queued).status).toBe("aborted");
    hold.resolve();
    expect((await running).status).toBe("completed");
    expect(h.loop.calls).toHaveLength(1);
  });
});

describe("spawnRecorder and settleAll", () => {
  test("settleAll resolves once every requestId has an agent.settled and the recorder keeps the seqs", async () => {
    const h = openHarness();
    const recorder = spawnRecorder(h.session);
    const calls = ["l1", "l2"].map((id) => h.openToolCall(id));
    const requestIds = calls.map(
      (call) =>
        `tool:${call.origin.owner.kind === "tool" ? call.origin.owner.toolCallId : ""}:spawn:0`,
    );
    const waiting = recorder.settleAll(h.parentThreadId, requestIds);
    await Promise.all(
      calls.map((call) => h.service.spawn({ agent: "explorer", task: "t" }, call.origin)),
    );
    await waiting;
    for (const requestId of requestIds) {
      const spawnedSeq = recorder.spawnedSeq(h.parentThreadId, requestId);
      const settledSeq = recorder.settledSeq(h.parentThreadId, requestId);
      expect(spawnedSeq).toBeDefined();
      expect((settledSeq ?? 0) > (spawnedSeq ?? Infinity)).toBe(true);
    }
    recorder.dispose();
  });
});
