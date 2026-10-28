import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ChildTurnRequest, TaskScope } from "@xeon/contracts/services";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, firstOfKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// L1A.6 (LP15): 자식 thread turn `runChildTurn`(L1.loop.spec §4.13)

const answer = (value: string, totalTokens = 10): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
  totalTokens,
});
const read = (id: string, totalTokens = 10): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
  totalTokens,
});

interface Child {
  readonly threadId: ThreadId;
  readonly scope: TaskScope;
}

/** 자식 thread 하나와 그 subagent 노드를 만든다(core-agents와 호스트가 spawn에서 하는 일) */
async function newChild(h: Harness): Promise<Child> {
  const threadId = h.fake.startThread();
  await h.host.host.openThread(threadId);
  const scope = h.tasks.service.openScope(h.tasks.service.root, {
    kind: "subagent",
    id: threadId,
  });
  return { threadId, scope };
}

function request(child: Child, overrides: Partial<ChildTurnRequest> = {}): ChildTurnRequest {
  return {
    threadId: child.threadId,
    input: { kind: "user", content: "do the task" },
    requestId: "child-req-1",
    systemPrompt: "You are the reviewer subagent.",
    model: "subagent",
    tools: {
      caller: "subagent:reviewer",
      depth: 1,
      ceiling: { caller: "main", depth: 0, mode: "acceptEdits" },
      surfaceThreadId: child.threadId,
      interactive: false,
      allow: ["read", "ls"],
    },
    scope: child.scope,
    signal: new AbortController().signal,
    ...overrides,
  };
}

test("child_turn_uses_request_prompt_model_and_tool_context", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), answer("child done")],
  });
  const child = await newChild(h);
  const result = await h.loop.runChildTurn(request(child));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.replayed).toBe(false);
  expect(result.value.outcome.status).toBe("completed");
  expect(result.value.usage?.totalTokens).toBe(20);

  // 시스템 프롬프트와 모델 역할은 요청의 것이다
  const prefix = h.models.requests[0]?.messages[0];
  expect(prefix).toMatchObject({ role: "system", content: "You are the reviewer subagent." });
  expect(h.models.resolves[0]).toEqual({ role: "subagent", overrides: {} });

  // 도구 광고와 실행 맥락은 요청의 값이다
  const advertised = h.tools.advertiseInputs[0];
  expect(advertised?.run).toMatchObject({
    threadId: child.threadId,
    caller: "subagent:reviewer",
    depth: 1,
    ceiling: { caller: "main", depth: 0, mode: "acceptEdits" },
  });
  expect(advertised?.allow).toEqual(["read", "ls"]);
  expect(h.tools.runs[0]).toMatchObject({
    threadId: child.threadId,
    caller: "subagent:reviewer",
    depth: 1,
    interactive: false,
    surfaceThreadId: child.threadId,
    ceiling: { caller: "main", depth: 0, mode: "acceptEdits" },
  });
});

test("a model that is not a role name is a model reference override of the main role", async () => {
  const h = await createHarness({ script: [answer("ok")] });
  const child = await newChild(h);
  await h.loop.runChildTurn(request(child, { model: "anthropic/claude-x:low" }));
  expect(h.models.resolves[0]).toEqual({
    role: "main",
    overrides: { ref: "anthropic/claude-x:low" },
  });
});

test("child_turn_same_request_id_replays: the second call returns the recorded result without a new turn", async () => {
  const h = await createHarness({ script: [answer("once")] });
  const child = await newChild(h);
  const first = await h.loop.runChildTurn(request(child));
  const second = await h.loop.runChildTurn(request(child));
  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(second.value.replayed).toBe(true);
  expect(second.value.outcome.turnId).toBe(first.value.outcome.turnId);
  expect(second.value.outcome.status).toBe("completed");
  expect(countKind(h.fake.events(child.threadId), "turn.started")).toBe(1);
  expect(h.models.requests).toHaveLength(1);
  // turn.started는 자식 requestId를 싣고 범위(scopeId)는 없다
  expect(firstOfKind(h.fake.events(child.threadId), "turn.started")?.payload).toMatchObject({
    requestId: "child-req-1",
    scopeId: null,
  });
  // 입력 지점은 거치지 않고 큐도 쓰지 않는다
  expect(countKind(h.fake.events(child.threadId), "input.queued")).toBe(0);
});

test("a cut after turn.started continues the same child turn on the second call with the request's prompt and tools", async () => {
  const h = await createHarness({ script: [answer("lost")] });
  const child = await newChild(h);
  h.fake.crashAfter((key) => /^turn:.*:start$/.test(key));
  let thrown: unknown;
  try {
    await h.loop.runChildTurn(request(child));
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(countKind(h.fake.events(child.threadId), "turn.started")).toBe(1);

  const h2 = await h.restart({ script: [answer("recovered")] });
  await h2.host.host.openThread(child.threadId);
  const childAgain: Child = {
    threadId: child.threadId,
    scope: h2.tasks.service.openScope(h2.tasks.service.root, {
      kind: "subagent",
      id: child.threadId,
    }),
  };
  const second = await h2.loop.runChildTurn(request(childAgain));
  expect(second.ok && second.value.replayed).toBe(true);
  expect(second.ok && second.value.outcome.status).toBe("completed");
  expect(countKind(h2.fake.events(child.threadId), "turn.started")).toBe(1);
  expect(countKind(h2.fake.events(child.threadId), "turn.completed")).toBe(1);
  // 이어 끝낸 turn도 요청의 시스템 프롬프트와 모델 역할로 돈다
  expect(h2.models.requests[0]?.messages[0]).toMatchObject({
    content: "You are the reviewer subagent.",
  });
  expect(h2.models.resolves.every((entry) => entry.role === "subagent")).toBe(true);
});

test("the child turn node hangs under the request's subagent node", async () => {
  const seen: string[] = [];
  const state: { child: Child | null } = { child: null };
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: () => {
          // 도구가 도는 동안 subagent 노드 아래에 turn 노드가 있다
          seen.push(...(state.child?.scope.children().map((node) => node.kind) ?? []));
          return Promise.resolve({ text: "A" });
        },
      },
    ],
    script: [read("c1"), answer("ok")],
  });
  const child = await newChild(h);
  state.child = child;
  const result = await h.loop.runChildTurn(request(child));
  expect(result.ok).toBe(true);
  expect(seen).toContain("turn");
});

test("child_limit: maxSteps ends the turn as interrupted with child_limit", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), read("c2"), read("c3"), answer("never")],
  });
  const child = await newChild(h);
  const result = await h.loop.runChildTurn(request(child, { limits: { maxSteps: 2 } }));
  expect(result.ok && result.value.outcome.status).toBe("aborted");
  expect(h.models.requests).toHaveLength(2);
  expect(firstOfKind(h.fake.events(child.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "child_limit",
    stepCount: 2,
  });
});

test("child_limit: maxInputTokens ends the turn after the step that reaches it", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1", 400), read("c2", 400), answer("never")],
  });
  const child = await newChild(h);
  const result = await h.loop.runChildTurn(request(child, { limits: { maxInputTokens: 700 } }));
  expect(result.ok && result.value.outcome.status).toBe("aborted");
  // 첫 단계 400, 둘째 단계 뒤 800 >= 700
  expect(h.models.requests).toHaveLength(2);
  expect(firstOfKind(h.fake.events(child.threadId), "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "child_limit",
  });
});

test("a configured step cap smaller than the child limit keeps the plain step_limit reason", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), read("c2"), answer("never")],
    maxSteps: 1,
  });
  const child = await newChild(h);
  await h.loop.runChildTurn(request(child, { limits: { maxSteps: 5 } }));
  expect(firstOfKind(h.fake.events(child.threadId), "turn.completed")?.payload).toMatchObject({
    error: "step_limit",
  });
});

test("the request signal cancels the child turn", async () => {
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
    script: [read("c1"), answer("never")],
  });
  const child = await newChild(h);
  const result = await h.loop.runChildTurn(request(child, { signal: controller.signal }));
  expect(result.ok && result.value.outcome.status).toBe("aborted");
  expect(h.models.requests).toHaveLength(1);
});
