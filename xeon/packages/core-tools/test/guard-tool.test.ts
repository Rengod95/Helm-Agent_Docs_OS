import { expect, test } from "bun:test";
import {
  callTool,
  createHarness,
  installHandlers,
  registerWorkspace,
  type Harness,
} from "./support/harness.ts";

// M3-REQ-109 guard.tool.before: 정책·승인 판정 뒤, effect.intent 전에 부른다. fail-closed. 내장 검사는 없다.

function kinds(h: Harness): string[] {
  return h.session.events.map((event) => event.kind);
}

test("a guard.tool.before block stops the tool, writes no effect and tells the model the reason", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "guard", ["guard.tool.before"], (g) => {
    g.on("guard.tool.before", () => ({ block: true, reason: "no reads today" }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_g1",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("[xeon:denied_by_guard] no reads today");
  expect(probe.calls).toEqual([]);
  expect(kinds(h)).toEqual(["item.recorded"]);
});

test("a throwing guard.tool.before handler also blocks (fail closed)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "bad-guard", ["guard.tool.before"], (g) => {
    g.on("guard.tool.before", () => {
      throw new Error("boom");
    });
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_g2",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("[xeon:denied_by_guard] extension handler failed");
  expect(probe.calls).toEqual([]);
  expect(kinds(h)).toEqual(["item.recorded"]);
});

test("a guard without an opinion lets the call run, and it sees the call after tool.call.before", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const order: string[] = [];
  await installHandlers(h, "order", ["tool.call.before", "guard.tool.before"], (g) => {
    g.on("tool.call.before", () => {
      order.push("tool.call.before");
      return undefined;
    });
    g.on("guard.tool.before", (payload) => {
      order.push(`guard:${payload.toolName}:${payload.risk}:${payload.caller}`);
      return undefined;
    });
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_g3",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.isError).toBe(false);
  expect(order).toEqual(["tool.call.before", "guard:read:read:main"]);
  expect(probe.calls).toHaveLength(1);
});

test("a call denied earlier never reaches the guard", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const seen: string[] = [];
  await installHandlers(h, "deny-then-guard", ["tool.call.before", "guard.tool.before"], (g) => {
    g.on("tool.call.before", () => ({ block: true, reason: "no" }));
    g.on("guard.tool.before", (payload) => {
      seen.push(payload.toolName);
      return undefined;
    });
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_g4",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("[xeon:denied_by_extension] no");
  expect(seen).toEqual([]);
});
