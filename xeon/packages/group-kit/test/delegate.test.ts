import { expect, test } from "bun:test";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { AgentService } from "@xeon/contracts/services";
import { createTestHost } from "@xeon/ext-host/testing";
import type { DelegateSpec } from "../src/index.ts";
import { fakeAgents } from "../src/testing/index.ts";
import type { GroupCallContext } from "../src/wrap.ts";
import { groupManifestOf } from "./support/manifests.ts";
import { installInjected } from "./support/injected-group.ts";

function specOf(ids: IdFactory): DelegateSpec {
  return {
    agent: "learning-review",
    task: "review the thread",
    requestId: "learning:review:3",
    toolPolicy: { allow: ["read", "learning_propose"], denyHint: "use learning_propose" },
    limits: { maxSteps: 16 },
    model: "fast",
    fork: { at: "item", itemId: ids.next("itm") },
  };
}

function context(kind: "on" | "drive", thread: ThreadId): GroupCallContext {
  return { kind, threadId: thread, signal: new AbortController().signal };
}

async function rig(ctx?: (thread: ThreadId) => GroupCallContext | undefined) {
  const t = await createTestHost();
  const thread = t.newThread();
  const agents = fakeAgents({ ids: t.ids });
  const g = await installInjected(t, groupManifestOf({ name: "delegator" }), () => ({
    agents: () => agents,
    callContext: () => ctx?.(thread),
  }));
  return { t, thread, agents, g, spec: specOf(t.ids) };
}

test("delegate.calls-l1-with-the-scope-owner-and-the-callers-request-id", async () => {
  const { thread, agents, g, spec } = await rig((thread) => context("on", thread));
  const first = await g.delegate(spec);
  expect(first).toMatchObject({
    ok: true,
    receipt: { requestId: "learning:review:3", status: "accepted" },
  });
  expect(agents.delegated).toHaveLength(1);
  const [call] = agents.delegated;
  expect(call?.request).toEqual({
    agent: "learning-review",
    task: "review the thread",
    requestId: "learning:review:3",
    tools: { allow: ["read", "learning_propose"], denyHint: "use learning_propose" },
    limits: { maxSteps: 16 },
    model: "fast",
    ...(spec.fork === undefined ? {} : { fork: spec.fork }),
  });
  expect(call?.origin).toMatchObject({
    parentThreadId: thread,
    owner: { kind: "scope", scopeId: "delegator" },
    caller: "main",
    depth: 0,
    ownerRequestId: "learning:review:3",
  });
  expect(g.metrics.snapshot().delegates).toBe(1);
});

test("delegate.a-command-handler-passes-its-thread-and-signal-explicitly", async () => {
  const { thread, agents, g, spec } = await rig();
  const abort = new AbortController();
  const result = await g.delegate(spec, { threadId: thread, signal: abort.signal });
  expect(result).toMatchObject({ ok: true, receipt: { status: "accepted" } });
  expect(agents.delegated[0]?.origin.parentThreadId).toBe(thread);
  expect(agents.delegated[0]?.origin.signal).toBe(abort.signal);
  expect(g.delegateStatus(spec.requestId, { threadId: thread })).toMatchObject({
    ok: true,
    status: { state: "running" },
  });
  // 다른 thread에서 같은 키로 물으면 그 thread에는 위임이 없다
  const other = await rig();
  expect(other.g.delegateStatus(spec.requestId, { threadId: thread })).toEqual({
    ok: true,
    status: undefined,
  });
});

test("delegate.second-call-with-the-same-request-id-is-a-duplicate-and-creates-nothing", async () => {
  const { agents, g, spec } = await rig((thread) => context("on", thread));
  const first = await g.delegate(spec);
  const second = await g.delegate(spec);
  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(second.receipt).toEqual({ ...first.receipt, status: "duplicate" });
  expect(agents.delegated).toHaveLength(1);
  expect(g.metrics.snapshot().delegates).toBe(1);
});

test("delegate.report-is-optional-and-passed-through-when-present", async () => {
  const { agents, g } = await rig((thread) => context("drive", thread));
  await g.delegate({ agent: "a", task: "t", requestId: "r1" });
  await g.delegate({
    agent: "a",
    task: "t",
    requestId: "r2",
    report: { customType: "grp.delegator.review.done", display: true, when: "next" },
  });
  expect(agents.delegated.map((d) => d.request.report)).toEqual([
    undefined,
    { customType: "grp.delegator.review.done", display: true, when: "next" },
  ]);
});

test("delegate.rejects-fork-at-event-before-calling-l1", async () => {
  const { t, agents, g } = await rig((thread) => context("on", thread));
  const result = await g.delegate({
    agent: "a",
    task: "t",
    requestId: "r1",
    fork: { at: "event", eventId: t.ids.next("evt") },
  });
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "group.delegateInvalid", field: "fork" },
  });
  expect(agents.delegated).toEqual([]);
});

test("delegate.is-unavailable-without-the-service-or-a-call-context", async () => {
  const noContext = await rig();
  const { spec } = noContext;
  expect(await noContext.g.delegate(spec)).toEqual({
    ok: false,
    error: { kind: "group.delegateUnavailable" },
  });
  expect(noContext.agents.delegated).toEqual([]);
  const t = await createTestHost();
  const g = await installInjected(t, groupManifestOf({ name: "no-agents" }), () => ({
    agents: () => undefined,
    callContext: () => context("on", t.newThread()),
  }));
  expect(await g.delegate(specOf(t.ids))).toEqual({
    ok: false,
    error: { kind: "group.delegateUnavailable" },
  });
});

test("delegate.maps-l1-errors-to-group-errors", async () => {
  const t = await createTestHost();
  const stub: AgentService = {
    ...fakeAgents({ ids: t.ids }),
    delegate: () =>
      Promise.resolve({
        ok: false,
        error: { kind: "agents.unknown_definition", message: "no such agent" },
      }),
  };
  const thread = t.newThread();
  const g = await installInjected(t, groupManifestOf({ name: "mapped" }), () => ({
    agents: () => stub,
    callContext: () => context("on", thread),
  }));
  const spec = specOf(t.ids);
  expect(await g.delegate(spec)).toEqual({
    ok: false,
    error: { kind: "group.delegateFailed", message: "agents.unknown_definition: no such agent" },
  });
  const unavailable = fakeAgents({ ids: t.ids, unavailable: true });
  const g2 = await installInjected(t, groupManifestOf({ name: "stubbed" }), () => ({
    agents: () => unavailable,
    callContext: () => context("on", thread),
  }));
  expect(await g2.delegate(spec)).toEqual({
    ok: false,
    error: { kind: "group.delegateUnavailable" },
  });
});

test("delegate.a-throwing-service-becomes-delegate-failed", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const stub: AgentService = {
    ...fakeAgents({ ids: t.ids }),
    delegate: () => Promise.reject(new Error("db down")),
  };
  const g = await installInjected(t, groupManifestOf({ name: "throws" }), () => ({
    agents: () => stub,
    callContext: () => context("on", thread),
  }));
  expect(await g.delegate(specOf(t.ids))).toEqual({
    ok: false,
    error: { kind: "group.delegateFailed", message: "db down" },
  });
});

test("delegate.a-group-being-disabled-gets-group-disabling", async () => {
  const { t, thread, agents, g, spec } = await rig((th) => context("on", th));
  await t.host.openThread(thread);
  t.host.scope("delegator")?.disable();
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(await g.delegate(spec)).toEqual({
    ok: false,
    error: { kind: "group.disabling", id: "delegator" },
  });
  expect(agents.delegated).toEqual([]);
});

test("delegate-status.reads-the-child-state-from-a-drive-and-is-denied-in-on-handlers", async () => {
  let kind: "on" | "drive" = "on";
  const { thread, agents, g, spec } = await rig((th) => context(kind, th));
  const started = await g.delegate(spec);
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const child = started.receipt.childThreadId;
  expect(g.delegateStatus(spec.requestId)).toEqual({
    ok: false,
    error: { kind: "group.effectNotAllowed", effect: "g.delegateStatus", context: "on" },
  });
  kind = "drive";
  expect(g.delegateStatus(spec.requestId)).toEqual({
    ok: true,
    status: { state: "running", childThreadId: child },
  });
  expect(g.delegateStatus("never-asked")).toEqual({ ok: true, status: undefined });
  agents.settle(thread, spec.requestId, "completed");
  expect(g.delegateStatus(spec.requestId)).toEqual({
    ok: true,
    status: { state: "settled", childThreadId: child, status: "completed" },
  });
});

test("cancel-delegates.cancels-by-owner-scope-outside-replayed-code-only", async () => {
  const { thread, agents, g } = await rig();
  await installOther(agents, thread);
  const outside = await g.cancelDelegates("group disabled");
  expect(outside).toEqual({ ok: true, cancelled: true });
  expect(agents.cancels).toEqual([
    { target: { ownerScopeId: "delegator" }, reason: "group disabled" },
  ]);
  expect(agents.status(thread, "mine")).toMatchObject({
    state: "settled",
    result: { status: "aborted" },
  });
  // 다른 scope가 소유한 위임은 건드리지 않는다
  expect(agents.status(thread, "theirs")).toMatchObject({ state: "running" });
});

/** delegator가 소유한 위임 하나와 다른 scope가 소유한 위임 하나를 만든다 */
async function installOther(
  agents: ReturnType<typeof fakeAgents>,
  thread: ThreadId,
  owner = "delegator",
): Promise<void> {
  const signal = new AbortController().signal;
  const base = { parentThreadId: thread, caller: "main", depth: 0, signal } as const;
  await agents.delegate(
    { agent: "a", task: "t", requestId: "mine" },
    { ...base, owner: { kind: "scope", scopeId: owner }, ownerRequestId: "mine" },
  );
  await agents.delegate(
    { agent: "a", task: "t", requestId: "theirs" },
    { ...base, owner: { kind: "scope", scopeId: "someone-else" }, ownerRequestId: "theirs" },
  );
}

async function cancelIsDeniedIn(kind: "on" | "drive"): Promise<void> {
  const { agents, g } = await rig((th) => context(kind, th));
  expect(await g.cancelDelegates()).toEqual({
    ok: false,
    error: { kind: "group.effectNotAllowed", effect: "g.cancelDelegates", context: kind },
  });
  expect(agents.cancels).toEqual([]);
}

test("cancel-delegates.is-denied-in-on-handlers", () => cancelIsDeniedIn("on"));
test("cancel-delegates.is-denied-in-drive-functions", () => cancelIsDeniedIn("drive"));

test("cancel-delegates.runs-from-on-dispose-and-aborts-the-groups-children", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const agents = fakeAgents({ ids: t.ids });
  const results: unknown[] = [];
  const g = await installInjected(
    t,
    groupManifestOf({ name: "disposer" }),
    () => ({ agents: () => agents, callContext: () => undefined }),
    (api) => {
      api.onDispose(async () => {
        results.push(await api.cancelDelegates());
      });
    },
  );
  await t.host.openThread(thread);
  await installOther(agents, thread, "disposer");
  t.host.scope("disposer")?.disable();
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(results).toEqual([{ ok: true, cancelled: true }]);
  expect(agents.status(thread, "mine")).toMatchObject({
    state: "settled",
    result: { status: "aborted" },
  });
  expect(g.id).toBe("disposer");
});

function manifest(name: string): ReturnType<typeof groupManifestOf> {
  return groupManifestOf({ name, points: ["lifecycle.agent.settled"] });
}

test("agent-settled.reaches-only-the-owner-scope-with-the-delegation-result", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const agents = fakeAgents({ ids: t.ids });
  const heard: string[] = [];
  const access = () => ({ agents: () => agents, callContext: () => context("on", thread) });
  const owner = await installInjected(t, manifest("owner-a"), access, (g) => {
    g.on("lifecycle.agent.settled", (payload) => {
      heard.push(`owner-a:${payload.requestId}:${payload.status}`);
    });
  });
  await installInjected(
    t,
    manifest("bystander"),
    access,
    (g) => {
      g.on("lifecycle.agent.settled", (payload) => {
        heard.push(`bystander:${payload.requestId}`);
      });
    },
    1,
  );
  await t.host.openThread(thread);
  const started = await owner.delegate({ agent: "a", task: "t", requestId: "owner-a:1" });
  expect(started.ok).toBe(true);
  const payload = agents.settle(thread, "owner-a:1", "completed");
  expect(payload).toBeDefined();
  if (payload === undefined) return;
  await t.host.afterCommit(thread, [{ id: t.ids.next("evt"), kind: "agent.settled", payload }]);
  expect(heard).toEqual(["owner-a:owner-a:1:completed"]);
});
