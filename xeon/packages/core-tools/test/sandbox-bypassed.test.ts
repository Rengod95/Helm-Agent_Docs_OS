import { expect, test } from "bun:test";
import { callTool, createHarness, layer } from "./support/harness.ts";
import type { JsonObject } from "@xeon/contracts/conversation";
import { Type } from "typebox";

// M3-33, L0.sandbox.spec §4.8, L1.tools.spec §4.12.2. 도구 결과가 샌드박스 밖 실행을 알리면 결과 커밋에 감사 이벤트 tool.sandbox_bypassed가 함께 남는다.

const ALLOW = [
  layer("user", {
    "l1.tools.rules": [
      { id: "u.shell", action: "tool.call", resource: { tool: "shell_probe" }, effect: "allow" },
    ],
  }),
];

function registerShell(h: Awaited<ReturnType<typeof createHarness>>, structured: JsonObject): void {
  const registered = h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: {
      name: "shell_probe",
      label: "shell_probe",
      description: "shell",
      parameters: Type.Object({}),
      execute: () =>
        Promise.resolve({
          content: [{ type: "text", text: "ran" }],
          details: null,
          structuredContent: structured,
        }),
    },
    policy: { risk: "exec" },
  });
  expect(registered.ok).toBe(true);
}

test("a result that says it ran outside the sandbox commits tool.sandbox_bypassed with the reason", async () => {
  const h = await createHarness({ layers: ALLOW });
  registerShell(h, { exitCode: 0, sandboxed: false, unsandboxedBy: "run_unsandboxed" });
  const run = h.run({ caller: "main" });
  await callTool(h.runtime.tools, run, { id: "c1", name: "shell_probe", args: {} });
  const events = h.session.events.filter((event) => event.kind === "tool.sandbox_bypassed");
  expect(events.map((event) => event.payload)).toEqual([
    {
      toolCallId: "c1",
      toolName: "shell_probe",
      reason: "run_unsandboxed",
      at: expect.any(Number),
    },
  ]);
});

test("a sandboxed result and an unknown reason leave no audit event", async () => {
  const h = await createHarness({ layers: ALLOW });
  registerShell(h, { exitCode: 0, sandboxed: true });
  await callTool(h.runtime.tools, h.run({ caller: "main" }), {
    id: "c1",
    name: "shell_probe",
    args: {},
  });
  const second = await createHarness({ layers: ALLOW });
  registerShell(second, { sandboxed: false, unsandboxedBy: "whatever" });
  await callTool(second.runtime.tools, second.run({ caller: "main" }), {
    id: "c1",
    name: "shell_probe",
    args: {},
  });
  expect(h.session.events.some((event) => event.kind === "tool.sandbox_bypassed")).toBe(false);
  expect(second.session.events.some((event) => event.kind === "tool.sandbox_bypassed")).toBe(false);
});
