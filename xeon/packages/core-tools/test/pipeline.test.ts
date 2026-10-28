import { expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import {
  CapabilityError,
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
} from "@xeon/contracts/capabilities";
import { EffectIntentSchema, EffectResultSchema } from "@xeon/contracts/records";
import { createToolRuntime } from "../src/runtime.ts";
import {
  ASSISTANT,
  callTool,
  createHarness,
  directTool,
  errorText,
  expectOk,
  installHandlers,
  layer,
  registerWorkspace,
  rejectionOf,
  textOf,
  until,
  type Harness,
} from "./support/harness.ts";

function kindsOf(h: Harness): string[] {
  return h.session.events.map((event) => event.kind);
}

function eventsOfKind(h: Harness, kind: string) {
  return h.session.events.filter((event) => event.kind === kind);
}

const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

test("a read call is allowed and recorded as intent, exec, result in three commits", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const run = h.run();
  const out = await callTool(h.runtime.tools, run, {
    id: "call_1",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBeUndefined();
  expect(out.isError).toBe(false);
  expect(textOf(out.result)).toContain("hello");
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
  expect(h.session.commits.map((commit) => commit.requestId)).toEqual([
    "tool:call_1:intent",
    "tool:call_1:exec",
    "tool:call_1:result",
  ]);
  expect(h.session.commits.map((commit) => commit.kinds)).toEqual([
    ["effect.intent"],
    ["effect.exec"],
    ["effect.result", "item.recorded"],
  ]);
  expect(out.outcome.itemId).not.toBeNull();
  expect(out.outcome.state).toBe("executed");
});

test("exec_committed_separately: intent and exec are different commits before the provider runs", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const probe = registerWorkspace(h);
  const run = h.run();
  const seenAtCall: string[] = [];
  h.apis.set(WorkspaceShell.id, {
    run: (input: unknown) => {
      seenAtCall.push(...kindsOf(h));
      probe.calls.push({ method: "run", input });
      return Promise.resolve({
        exitCode: 0,
        output: "done",
        truncated: false,
        durationMs: 1,
        sandboxed: false,
      });
    },
  });
  await callTool(h.runtime.tools, run, { id: "call_2", name: "bash", args: { command: "echo" } });
  expect(seenAtCall).toEqual(["effect.intent", "effect.exec"]);
  const requestIds = h.session.commits.map((commit) => commit.requestId);
  expect(new Set(requestIds).size).toBe(requestIds.length);
});

test("result_and_tool_result_item_same_commit: consecutive seq under one request id", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  await callTool(h.runtime.tools, h.run(), { id: "call_3", name: "ls", args: {} });
  const result = h.session.commits.find((commit) => commit.requestId === "tool:call_3:result");
  expect(result).toBeDefined();
  expect(result?.lastSeq).toBe((result?.firstSeq ?? 0) + 1);
  const events = h.session.events.filter(
    (event) => event.seq >= (result?.firstSeq ?? 0) && event.seq <= (result?.lastSeq ?? 0),
  );
  expect(events.map((event) => event.kind)).toEqual(["effect.result", "item.recorded"]);
  const parsed = parse(EffectResultSchema, events[0]?.payload);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const item: unknown = events[1]?.payload;
  expect(JSON.stringify(item)).toContain(parsed.value.resultItemId ?? "missing");
  expect(parsed.value.status).toBe("ok");
  expect(parsed.value.synthesized).toBe(false);
});

test("effect.intent carries the final args, hash, replay policy and null idempotency key", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  await callTool(h.runtime.tools, h.run(), {
    id: "call_4",
    name: "read",
    args: { path: "a.txt", offset: 2 },
  });
  const intent = parse(EffectIntentSchema, eventsOfKind(h, "effect.intent")[0]?.payload);
  expect(intent.ok).toBe(true);
  if (!intent.ok) return;
  expect(intent.value.toolName).toBe("read");
  expect(intent.value.args).toEqual({ path: "a.txt", offset: 2 });
  expect(intent.value.replay).toBe("safe");
  expect(intent.value.idempotencyKey).toBeNull();
  expect(intent.value.argsHash).toMatch(/^[0-9a-f]{64}$/);
});

test("intent_committed_before_execute: a failed intent commit blocks the call and never reaches the provider", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  h.session.setFault((request) =>
    request.requestId.endsWith(":intent") ? { kind: "disk_full" } : undefined,
  );
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_5",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toContain("tools.commit_failed");
  expect(probe.calls).toEqual([]);
  // 효과 기록 없이 닫은 호출은 toolResult item만 남는다
  expect(kindsOf(h)).toEqual(["item.recorded"]);
});

test("a busy intent commit is retried with the same request id", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  let failures = 1;
  const seen: string[] = [];
  h.session.setFault((request) => {
    seen.push(request.requestId);
    if (request.requestId.endsWith(":intent") && failures > 0) {
      failures -= 1;
      return { kind: "busy" };
    }
    return undefined;
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_6",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBeUndefined();
  expect(seen.filter((id) => id.endsWith(":intent"))).toEqual([
    "tool:call_6:intent",
    "tool:call_6:intent",
  ]);
});

test("executing a call that was never prepared is a bug and never reaches the provider", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const run = h.run();
  const toolCall = {
    type: "toolCall" as const,
    id: "call_7",
    name: "read",
    arguments: { path: "a.txt" },
  };
  const thrown = await rejectionOf(() =>
    h.runtime.tools.execute({ toolCall, args: { path: "a.txt" } }, () => {}, run),
  );
  expect(thrown).toBeInstanceOf(Bug);
  expect(errorText(thrown)).toContain("tools.intent_missing");
  expect(probe.calls).toEqual([]);
});

test("exec commit failure does not run the tool and closes the call as abandoned", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  h.session.setFault((request) =>
    request.requestId.endsWith(":exec") ? { kind: "disk_full" } : undefined,
  );
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_8",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(probe.calls).toEqual([]);
  expect(out.isError).toBe(true);
  expect(textOf(out.result)).toContain("tools.commit_failed");
  const result = parse(EffectResultSchema, eventsOfKind(h, "effect.result")[0]?.payload);
  expect(result.ok && result.value.status).toBe("abandoned");
});

test("capability_error_to_is_error: a CapabilityError becomes an isError result with data in details", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.apis.set(WorkspaceFiles.id, {
    read: () =>
      Promise.reject(
        new CapabilityError({
          capability: "workspace.files",
          method: "read",
          code: "rate_limited",
          message: "slow down",
          retryable: true,
          retryAfterMs: 500,
        }),
      ),
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_9",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.isError).toBe(true);
  expect(textOf(out.result)).toBe("[rate_limited] slow down");
  expect(out.result?.details).toMatchObject({ code: "rate_limited", retryAfterMs: 500 });
  const result = parse(EffectResultSchema, eventsOfKind(h, "effect.result")[0]?.payload);
  expect(result.ok && result.value.status).toBe("error");
});

test("an aborted CapabilityError is recorded as interrupted", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.apis.set(WorkspaceFiles.id, {
    read: () =>
      Promise.reject(
        new CapabilityError({
          capability: "workspace.files",
          method: "read",
          code: "aborted",
          message: "cancelled",
          retryable: false,
        }),
      ),
  });
  await callTool(h.runtime.tools, h.run(), { id: "call_10", name: "read", args: { path: "a" } });
  const result = parse(EffectResultSchema, eventsOfKind(h, "effect.result")[0]?.payload);
  expect(result.ok && result.value.status).toBe("interrupted");
});

test("an unavailable capability provider is an error result, not a crash", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  h.apis.delete(WorkspaceFiles.id);
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_11",
    name: "read",
    args: { path: "a" },
  });
  expect(out.isError).toBe(true);
  expect(textOf(out.result)).toContain("[unavailable]");
});

test("tool_call_hook_throw_denies: a throwing handler blocks the call and leaves no effect events", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "bad-guard", ["tool_call"], (g) => {
    g.on("tool_call", () => {
      throw new Error("boom");
    });
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_12",
    name: "read",
    args: { path: "a" },
  });
  expect(out.blocked).toBe("[xeon:denied_by_extension] extension handler failed");
  expect(probe.calls).toEqual([]);
  expect(kindsOf(h)).toEqual(["item.recorded"]);
});

test("a tool_call handler decision blocks with its own reason", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  await installHandlers(h, "guard", ["tool_call"], (g) => {
    g.on("tool_call", () => ({ block: true, reason: "no reads today" }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_13",
    name: "read",
    args: { path: "a" },
  });
  expect(out.blocked).toBe("[xeon:denied_by_extension] no reads today");
});

test("a dispatcher exception is also a denial (fail closed)", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const failing = createToolRuntimeWith(h, {
    dispatch: () => Promise.reject(new Error("dispatcher down")),
  });
  const out = await callTool(failing.tools, h.run(), {
    id: "call_14",
    name: "read",
    args: { path: "a" },
  });
  expect(out.blocked).toContain("denied_by_extension");
  expect(kindsOf(h)).toEqual(["item.recorded"]);
});

test("tool_result_handler_throw_skipped: one failing handler does not turn the result into an error", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  await installHandlers(h, "bad-result", ["tool_result"], (g) => {
    g.on("tool_result", () => {
      throw new Error("boom");
    });
  });
  await installHandlers(h, "good-result", ["tool_result"], (g) => {
    g.on("tool_result", (_payload, current) => ({
      content: [...current.content, { type: "text", text: "appended by handler" }],
    }));
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_15", name: "ls", args: {} });
  expect(out.isError).toBe(false);
  expect(textOf(out.result)).toContain("appended by handler");
  expect(textOf(out.result)).toContain("a.txt");
});

test("custom direct tools run through the same pipeline and ToolsPort registration works", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  let calls = 0;
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("bash", () => {
      calls += 1;
      return Promise.resolve({ content: [{ type: "text", text: "direct ok" }], details: null });
    }),
    policy: { risk: "exec" },
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_16",
    name: "bash",
    args: { command: "x" },
  });
  expect(textOf(out.result)).toBe("direct ok");
  expect(calls).toBe(1);
  expect(kindsOf(h)).toEqual(["effect.intent", "effect.exec", "effect.result", "item.recorded"]);
});

test("a thrown tool error becomes an error result and the effect is recorded as error", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("bash", () => Promise.reject(new Error("disk exploded"))),
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_17",
    name: "bash",
    args: { command: "x" },
  });
  expect(out.isError).toBe(true);
  expect(textOf(out.result)).toContain("disk exploded");
  const result = parse(EffectResultSchema, eventsOfKind(h, "effect.result")[0]?.payload);
  expect(result.ok && result.value.status).toBe("error");
});

test("policy denies from settings never reach the provider", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          { id: "m.no-read", action: "tool.call", resource: { tool: "read" }, effect: "deny" },
        ],
      }),
    ],
  });
  const probe = registerWorkspace(h);
  const run = h.run();
  // 전역 deny는 광고 목록에서 빠지므로 광고하지 않은 도구를 직접 부르는 경로를 시험한다
  const toolset = expectOk(await h.runtime.tools.advertise({ run, activated: new Set() }));
  expect(toolset.tools.map((tool) => tool.name)).not.toContain("read");
  expect(toolset.removed.map((entry) => entry.ruleId)).toEqual(["m.no-read"]);
  const prepared = await h.runtime.tools.prepare(
    { type: "toolCall", id: "call_18", name: "read", arguments: { path: "a" } },
    ASSISTANT,
    run,
  );
  expect(prepared.kind).toBe("settled");
  if (prepared.kind !== "settled") return;
  expect(prepared.outcome.state).toBe("rejected");
  expect(textOf(prepared.outcome.result)).toContain("denied_by_policy");
  expect(probe.calls).toEqual([]);
  expect(kindsOf(h)).toEqual(["item.recorded"]);
});

test("a call from a child conversation passes through the ceiling stage and runs when both views allow it", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const run = {
    ...h.run(),
    caller: "subagent:worker" as const,
    depth: 1,
    ceiling: { caller: "main" as const, depth: 0, mode: "default" as const },
  };
  const out = await callTool(h.runtime.tools, run, {
    id: "call_19",
    name: "read",
    args: { path: "a" },
  });
  expect(out.blocked).toBeUndefined();
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
  const listed = expectOk(await h.runtime.tools.advertise({ run, activated: new Set() }));
  expect(listed.tools.map((tool) => tool.name)).toContain("read");
});

test("waiting for approval is not needed when the user rule allows the command by args pattern", async () => {
  const h = await createHarness({
    layers: [
      layer("user", {
        "l1.tools.rules": [
          {
            id: "u.git-status",
            action: "tool.call",
            resource: { tool: "bash", args: [{ pointer: "/command", pattern: "^git status" }] },
            effect: "allow",
          },
        ],
      }),
    ],
  });
  registerWorkspace(h);
  const allowed = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "call_20",
    name: "bash",
    args: { command: "git status --short" },
  });
  expect(allowed.blocked).toBeUndefined();
  const refused = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "call_21",
    name: "bash",
    args: { command: "rm -rf /" },
  });
  expect(refused.blocked).toContain("noninteractive_ask_denied");
});

test("until helper reports a missing condition", async () => {
  expect(errorText(await rejectionOf(() => until(() => false, 3)))).toBe("condition was not met");
});

function createToolRuntimeWith(h: Harness, ext: { dispatch: Harness["deps"]["ext"]["dispatch"] }) {
  const runtime = createToolRuntime({ ...h.deps, ext });
  runtime.tools.register({ kind: "capability", def: WorkspaceFiles, key: WorkspaceFilesKey });
  return runtime;
}

test("tap points fire for a settled call: start and end, both with masked payloads", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const seen: string[] = [];
  await installHandlers(h, "watch", ["tool_execution_start", "tool_execution_end"], (g) => {
    g.on("tool_execution_start", (payload) => {
      seen.push(`start:${payload.toolCallId}`);
    });
    g.on("tool_execution_end", (payload) => {
      seen.push(`end:${payload.toolCallId}:${String(payload.isError)}`);
    });
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "nope_1", name: "nope", args: {} });
  expect(out.blocked).toContain("tool_unavailable");
  expect(seen).toEqual(["start:nope_1", "end:nope_1:true"]);
});

test("tap points fire once per phase for an executed call", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const seen: string[] = [];
  await installHandlers(h, "watch", ["tool_execution_start", "tool_execution_end"], (g) => {
    g.on("tool_execution_start", (payload) => {
      seen.push(`start:${payload.toolCallId}`);
    });
    g.on("tool_execution_end", (payload) => {
      seen.push(`end:${payload.toolCallId}:${String(payload.isError)}`);
    });
  });
  await callTool(h.runtime.tools, h.run(), { id: "call_t1", name: "read", args: { path: "a" } });
  expect(seen).toEqual(["start:call_t1", "end:call_t1:false"]);
});

test("settleRejected with the truncated reason records a result item without any effect event", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const [outcome] = await h.runtime.tools.settleRejected(
    [{ type: "toolCall", id: "cut_1", name: "read", arguments: { path: "a" } }],
    "truncated",
    run,
  );
  expect(outcome?.state).toBe("truncated");
  expect(outcome?.isError).toBe(true);
  expect(textOf(outcome?.result)).toContain("output token limit");
  expect(outcome?.itemId).not.toBeNull();
  expect(kindsOf(h)).toEqual(["item.recorded"]);
});

test("invalid arguments are settled by prepare before any policy or effect work", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "bad_1",
    name: "read",
    args: { offset: "not a number" },
  });
  expect(out.blocked).toContain("Validation failed");
  expect(out.outcome.state).toBe("rejected");
  expect(probe.calls).toEqual([]);
  expect(kindsOf(h)).toEqual(["item.recorded"]);
});

test("arguments are converted to the schema types before the intent and the provider call", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await callTool(h.runtime.tools, h.run(), {
    id: "conv_1",
    name: "read",
    args: { path: "a.txt", offset: "3" },
  });
  expect(probe.calls).toEqual([{ method: "read", input: { path: "a.txt", offset: 3 } }]);
  const intent = parse(EffectIntentSchema, eventsOfKind(h, "effect.intent")[0]?.payload);
  expect(intent.ok && intent.value.args).toEqual({ path: "a.txt", offset: 3 });
});
