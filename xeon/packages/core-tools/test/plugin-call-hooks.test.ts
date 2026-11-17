import { expect, test } from "bun:test";
import type { PluginCallRequest } from "@fresnel/contracts/services";
import {
  createHarness,
  installHandlers,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// 훅 결정 `ask`와 `replace`는 플러그인이 부른 호출에도 모델이 부른 호출과 같은 뜻이다(M5e 스펙 §4.2, hooks-core-boundary U-3).

function callOf(h: Harness, patch: Partial<PluginCallRequest> = {}): PluginCallRequest {
  return {
    threadId: h.thread,
    plugin: { name: "p1", scopeId: "scope-p1" },
    via: "method",
    target: { kind: "tool", name: "read" },
    input: { path: "a.txt" },
    requestId: "req-1",
    ...patch,
  };
}

test("a tool.call.before ask on a plugin call opens a card with askedBy; allow runs the call", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = h.runtime.tools.executeForPlugin(callOf(h));
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [card] = h.runtime.approvals.pending(h.thread);
  expect(card?.body).toMatchObject({
    kind: "tool",
    tool: { ruleId: "hook:gate", askedBy: { extension: "gate", reason: "check the path" } },
  });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect(await done).toMatchObject({ ok: true, value: { isError: false } });
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("a tool.call.before ask on a plugin call that the user denies returns a human denial and runs nothing", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = h.runtime.tools.executeForPlugin(callOf(h));
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [card] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await done).toMatchObject({ ok: false, error: { kind: "denied", resolvedBy: "human" } });
  expect(probe.calls).toEqual([]);
});

test("a replace decision on a plugin call returns the replacing content as the result and runs nothing", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "swap", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({
      replace: { content: [{ type: "text", text: "from the hook" }] },
      reason: "cached",
    }));
  });
  const result = await h.runtime.tools.executeForPlugin(callOf(h));
  expect(result).toMatchObject({ ok: true, value: { content: "from the hook", isError: false } });
  expect(probe.calls).toEqual([]);
});
