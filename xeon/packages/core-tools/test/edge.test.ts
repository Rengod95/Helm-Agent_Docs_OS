import { expect, test } from "bun:test";
import { err, ok, parse } from "@xeon/contracts";
import { BashToolParams } from "@xeon/contracts/capabilities";
import { EffectIntentSchema } from "@xeon/contracts/records";
import type { CommitRequest, CommitResult } from "@xeon/contracts/records";
import { sequentialIds } from "../src/testing/index.ts";
import { commitWithRetry, describeFailure } from "../src/commit.ts";
import { commitKeyPart } from "../src/effects.ts";
import { requestCommitKey, requestKeyFor } from "../src/approvals/protocol.ts";
import {
  ASSISTANT,
  callTool,
  createHarness,
  directTool,
  installHandlers,
  layer,
  registerWorkspace,
  textOf,
  until,
} from "./support/harness.ts";

const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

function emptyRequest(): CommitRequest {
  return {
    threadId: sequentialIds().next("thr"),
    requestId: "k",
    fingerprintSource: null,
    build: () => ({ kind: "reject", code: "x", detail: null }),
  };
}

test("commitWithRetry retries busy with the same request and reports every failure kind as a value", () => {
  const seen: CommitRequest[] = [];
  const request = emptyRequest();
  const busy = commitWithRetry(
    {
      commit: (r) => {
        seen.push(r);
        return err({ kind: "busy" });
      },
    },
    request,
  );
  expect(busy.ok).toBe(false);
  expect(seen).toHaveLength(3);
  expect(seen.every((entry) => entry === request)).toBe(true);

  const results: CommitResult[] = [
    { status: "rejected", code: "turn_aborting", detail: null, replayed: false },
    { status: "key_reused", requestId: "k" },
  ];
  const described = results.map((result) => {
    const outcome = commitWithRetry({ commit: () => ok(result) }, request);
    return outcome.ok ? "ok" : describeFailure(outcome.failure);
  });
  expect(described).toEqual(["commit rejected: turn_aborting", "commit key reused: k"]);
  const disk = commitWithRetry({ commit: () => err({ kind: "disk_full" }) }, request);
  expect(disk.ok ? "ok" : describeFailure(disk.failure)).toBe("store error: disk_full");
});

test("tool call ids outside the commit key alphabet or too long are hashed deterministically", async () => {
  expect(await commitKeyPart("call_1")).toBe("call_1");
  const odd = await commitKeyPart("call|odd id/with space");
  expect(odd).toMatch(/^h_[0-9a-f]{40}$/);
  expect(await commitKeyPart("call|odd id/with space")).toBe(odd);
  const long = "t".repeat(60);
  expect(await requestKeyFor(long)).toMatch(/^h_[0-9a-f]{40}$/);
  expect(await requestKeyFor("short")).toBe("short");
  const thread = "thr_00000000000000000000000001";
  expect(await requestCommitKey(thread, "call_1")).toBe(`approval:${thread}:call_1:request`);
  const hashed = await requestCommitKey(thread, "k".repeat(48));
  expect(hashed).toMatch(/^approval:[0-9a-f]{32}:request$/);
  expect(hashed.length).toBeLessThanOrEqual(64);

  const h = await createHarness();
  registerWorkspace(h);
  await callTool(h.runtime.tools, h.run(), {
    id: "call|odd id",
    name: "read",
    args: { path: "a" },
  });
  expect(h.session.commits[0]?.requestId).toBe(`tool:${await commitKeyPart("call|odd id")}:intent`);
});

test("details and structuredContent over the event limit are replaced by their size in the record", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("fat", () =>
      Promise.resolve({
        content: [{ type: "text", text: "ok" }],
        details: { blob: "x".repeat(200_000) },
        structuredContent: { rows: "y".repeat(200_000) },
      }),
    ),
    policy: { risk: "read" },
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_1", name: "fat", args: {} });
  expect(out.isError).toBe(false);
  const text = JSON.stringify(h.session.events);
  expect(text).toContain("xeonOversize");
  expect(text.length).toBeLessThan(10_000);
});

test("a direct tool whose structuredContent violates its outputSchema becomes an internal error result", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: {
      ...directTool("typed", () =>
        Promise.resolve({
          content: [{ type: "text", text: "ok" }],
          details: null,
          structuredContent: { nope: 1 },
        }),
      ),
      outputSchema: BashToolParams,
    },
    policy: { risk: "read" },
  });
  const out = await callTool(h.runtime.tools, h.run(), { id: "call_2", name: "typed", args: {} });
  expect(out.isError).toBe(true);
  expect(textOf(out.result)).toContain("[internal] structuredContent violates the output schema");
});

test("arguments over 256 KiB go to a blob in the intent and a rerun reads them back", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const seen: string[] = [];
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: {
      ...directTool("bash", (_id, params) => {
        const command: unknown =
          typeof params === "object" && params !== null && "command" in params
            ? params.command
            : "";
        seen.push(typeof command === "string" ? command : "");
        return Promise.resolve({ content: [{ type: "text", text: "ran" }], details: null });
      }),
      replay: "safe",
    },
    policy: { risk: "exec" },
  });
  const big = "z".repeat(300_000);
  const run = h.run();
  const hooks = h.runtime.tools.hooks(run);
  const tools = h.runtime.tools.toAgentTools(
    await h.runtime.tools.advertise({ run, activated: new Set() }),
    run,
  );
  const before = await hooks.beforeToolCall(
    {
      assistantMessage: ASSISTANT,
      toolCall: { type: "toolCall", id: "call_3", name: "bash", arguments: {} },
      args: { command: big },
      context: { messages: [], tools: [...tools] },
    },
    run.signal,
  );
  expect(before).toBeUndefined();
  const intent = parse(EffectIntentSchema, h.session.events[0]?.payload);
  expect(intent.ok).toBe(true);
  if (!intent.ok) return;
  expect(intent.value.args).toMatchObject({
    type: "blob",
    size: 300_000 + '{"command":""}'.length,
  });
  const record = await h.runtime.tools.rerun(intent.value, run);
  expect(record.isError).toBe(false);
  expect(seen).toEqual([big]);
});

test("a call whose tool_execution_end arrives without an afterToolCall still releases its tool node", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const tools = h.runtime.tools.toAgentTools(
    await h.runtime.tools.advertise({ run, activated: new Set() }),
    run,
  );
  const hooks = h.runtime.tools.hooks(run);
  const read = tools.find((tool) => tool.name === "read");
  await hooks.beforeToolCall(
    {
      assistantMessage: ASSISTANT,
      toolCall: { type: "toolCall", id: "call_4", name: "read", arguments: {} },
      args: { path: "a" },
      context: { messages: [], tools: [...tools] },
    },
    run.signal,
  );
  await read?.execute("call_4", { path: "a" }, run.signal, undefined);
  const node = h.tasks.scopes.find((scope) => scope.kind === "tool");
  expect(node).toBeDefined();
  let settled = false;
  const watching = node?.settle().then(() => {
    settled = true;
    return settled;
  });
  await h.runtime.tools.observe(
    {
      type: "tool_execution_end",
      toolCallId: "call_4",
      toolName: "read",
      result: {},
      isError: false,
    },
    run,
  );
  await until(() => settled);
  await watching;
  expect(settled).toBe(true);
});

test("a tool_call decision with terminate stops the batch", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  await installHandlers(h, "stopper", ["tool_call"], (g) => {
    g.on("tool_call", () => ({ block: true, reason: "stop here", terminate: true }));
  });
  const run = h.run();
  const hooks = h.runtime.tools.hooks(run);
  const before = await hooks.beforeToolCall(
    {
      assistantMessage: ASSISTANT,
      toolCall: { type: "toolCall", id: "call_5", name: "read", arguments: {} },
      args: { path: "a" },
      context: { messages: [], tools: [] },
    },
    run.signal,
  );
  expect(before).toEqual({
    block: true,
    reason: "[xeon:denied_by_extension] stop here",
    terminate: true,
  });
});

test("an unregistered tool and non-object args are refused by the hook", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const hooks = h.runtime.tools.hooks(run);
  const missing = await hooks.beforeToolCall(
    {
      assistantMessage: ASSISTANT,
      toolCall: { type: "toolCall", id: "c", name: "nope", arguments: {} },
      args: {},
      context: { messages: [], tools: [] },
    },
    run.signal,
  );
  expect(missing?.reason).toContain("tool_unavailable");
  const notObject = await hooks.beforeToolCall(
    {
      assistantMessage: ASSISTANT,
      toolCall: { type: "toolCall", id: "c2", name: "read", arguments: {} },
      args: "text",
      context: { messages: [], tools: [] },
    },
    run.signal,
  );
  expect(notObject?.reason).toContain("invalid_args");
  expect(h.session.events).toEqual([]);
});

test("a failed approval.requested commit blocks the call with commit_failed and runs nothing", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  h.session.setFault((request) =>
    request.requestId.startsWith("approval:") ? { kind: "disk_full" } : undefined,
  );
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_6",
    name: "bash",
    args: { command: "ls" },
  });
  expect(out.blocked).toContain("tools.commit_failed");
  expect(probe.calls).toEqual([]);
  expect(h.session.events).toEqual([]);
});
