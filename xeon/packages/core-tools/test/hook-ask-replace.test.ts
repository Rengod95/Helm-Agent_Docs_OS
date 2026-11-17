import { expect, test } from "bun:test";
import {
  callTool,
  createHarness,
  installHandlers,
  layer,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// M5e 스펙 §4.2(묻기, 결과 대신 주기)와 §5.1 H-1(정책을 넓히지 못한다), H-2(합치기), H-3(카드는 하나), §7 E-1, E-2.

function kindsOf(h: Harness): string[] {
  return h.session.events.map((event) => event.kind);
}

function pendingCards(h: Harness) {
  return h.runtime.approvals.pending(h.thread);
}

const DENY_READ = layer("user", {
  "l1.tools.rules": [
    { id: "u.no-read", action: "tool.call", resource: { tool: "read" }, effect: "deny" },
  ],
});

const ASK_READ = layer("user", {
  "l1.tools.rules": [
    { id: "u.ask-read", action: "tool.call", resource: { tool: "read" }, effect: "ask" },
  ],
});

test("a tool.call.before ask opens one card with askedBy and the hook rule id; allow runs the tool", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "call_a1",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  const [card] = pendingCards(h);
  expect(card?.body).toMatchObject({
    kind: "tool",
    tool: { ruleId: "hook:gate", askedBy: { extension: "gate", reason: "check the path" } },
  });
  expect(card?.remember).toEqual(["once"]);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  const out = await done;
  expect(out.blocked).toBeUndefined();
  expect(out.outcome.isError).toBe(false);
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("a tool.call.before ask that the user denies returns the user-denied result and runs nothing", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "call_a2",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  const [card] = pendingCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  const out = await done;
  expect(out.blocked).toBe("The user denied this tool call.");
  expect(out.outcome.message.details).toEqual({ code: "denied_by_user" });
  expect(probe.calls).toEqual([]);
});

test("a hook ask still opens its card under bypass mode (E-2)", async () => {
  const h = await createHarness({
    layers: [layer("user", { "l1.tools.permissionMode": "bypass" })],
  });
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "call_a3",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  const [card] = pendingCards(h);
  expect(card?.body).toMatchObject({ kind: "tool", tool: { ruleId: "hook:gate" } });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("a policy deny stays a deny when a hook asks: no card opens (H-1)", async () => {
  const h = await createHarness({ layers: [DENY_READ] });
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_a4",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toContain("[fresnel:denied_by_policy]");
  expect(pendingCards(h)).toEqual([]);
  expect(kindsOf(h).filter((kind) => kind === "approval.requested")).toEqual([]);
  expect(probe.calls).toEqual([]);
});

test("a policy ask and a hook ask share ONE card that carries both reasons (H-3)", async () => {
  const h = await createHarness({ layers: [ASK_READ] });
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "call_a5",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  const [card] = pendingCards(h);
  expect(card?.title).toContain("rule u.ask-read");
  expect(card?.title).toContain("check the path");
  expect(card?.body).toMatchObject({
    kind: "tool",
    tool: { ruleId: "hook:gate", askedBy: { extension: "gate", reason: "check the path" } },
  });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(kindsOf(h).filter((kind) => kind === "approval.requested")).toHaveLength(1);
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("an unattended run refuses a hook ask with the extension text on one line (E-1)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "call_a6",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe(
    "[fresnel:denied_by_extension] check the path (confirmation unavailable)",
  );
  expect(out.outcome.message.details).toEqual({
    code: "denied_by_extension",
    hook: "tool.call.before",
    extension: "gate",
    outcome: "asked",
    reason: "check the path",
  });
  expect(pendingCards(h)).toEqual([]);
  expect(probe.calls).toEqual([]);
});

test("a replace decision records its content, runs nothing, writes no intent, and skips tool.result", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  let resultHookCalls = 0;
  await installHandlers(h, "cacher", ["tool.call.before", "tool.result"], (g) => {
    g.on("tool.call.before", () => ({
      replace: { content: [{ type: "text", text: "from cache" }], details: { source: "cache" } },
      reason: "cached",
    }));
    g.on("tool.result", () => {
      resultHookCalls += 1;
      return undefined;
    });
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_a7",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("from cache");
  expect(out.outcome.isError).toBe(false);
  expect(out.outcome.state).toBe("rejected");
  expect(out.outcome.message.details).toEqual({
    source: "cache",
    hook: "replaced",
    extension: "cacher",
  });
  expect(probe.calls).toEqual([]);
  expect(kindsOf(h)).toEqual(["item.recorded"]);
  expect(resultHookCalls).toBe(0);
});

test("a replace decision skips policy: a deny rule does not turn it into a denial", async () => {
  const h = await createHarness({ layers: [DENY_READ] });
  registerWorkspace(h);
  await installHandlers(h, "cacher", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({
      replace: { content: [{ type: "text", text: "from cache" }] },
      reason: "cached",
    }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_a8",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("from cache");
  expect(out.outcome.isError).toBe(false);
  expect(pendingCards(h)).toEqual([]);
});

test("replace outranks ask when two handlers decide (block > replace > ask)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "asker", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "maybe" }));
  });
  await installHandlers(h, "cacher", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({
      replace: { content: [{ type: "text", text: "from cache" }] },
      reason: "cached",
    }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_a9",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("from cache");
  expect(pendingCards(h)).toEqual([]);
  expect(probe.calls).toEqual([]);
});

test("an ask from one handler and a block from another blocks the call (H-2)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "asker", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "maybe" }));
  });
  await installHandlers(h, "blocker", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ block: true, reason: "no" }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_a10",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("[fresnel:denied_by_extension] no");
  expect(pendingCards(h)).toEqual([]);
  expect(probe.calls).toEqual([]);
});
