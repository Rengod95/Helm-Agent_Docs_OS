import { expect, test } from "bun:test";
import { defineCapability, serviceKey, type CallerInfo } from "@xeon/contracts/capabilities";
import { Type } from "typebox";
import { callTool, createHarness, layer, type Harness } from "./support/harness.ts";
import { createToolRuntime } from "../src/runtime.ts";

// M3-REQ-100. 확장 도구 `execute`의 `ctx.caller.afterUntrusted`는 같은 turn이 웹·MCP 도구 결과를 읽은 뒤에만 참이다.
// M3-REQ-102. `ctx.toolCallId`는 호출 id다.

const ALLOW = [
  layer("user", {
    "l1.tools.rules": [
      { id: "u.ext", action: "tool.call", resource: { tool: "ext_probe" }, effect: "allow" },
      { id: "u.mcp", action: "tool.call", resource: { tool: "mcp_read" }, effect: "allow" },
      { id: "u.web", action: "tool.call", resource: { tool: "web_probe" }, effect: "allow" },
      { id: "u.safe", action: "tool.call", resource: { tool: "safe_read" }, effect: "allow" },
    ],
  }),
];

interface Seen {
  readonly toolCallId: string;
  readonly caller: CallerInfo;
}

function registerProbe(h: Harness, seen: Seen[]): void {
  const registered = h.runtime.tools.register("ext-probe", {
    name: "ext_probe",
    description: "probe",
    parameters: Type.Object({}),
    replay: "safe",
    execute: (_args, ctx) => {
      seen.push({ toolCallId: ctx.toolCallId, caller: ctx.caller });
      return Promise.resolve("ok");
    },
  });
  expect(registered.ok).toBe(true);
}

function registerSource(h: Harness, name: string, mcpServer: string | undefined): void {
  const registered = h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: {
      name,
      label: name,
      description: name,
      parameters: Type.Object({}),
      execute: () =>
        Promise.resolve({ content: [{ type: "text", text: "page text" }], details: null }),
    },
    policy: { risk: "read", ...(mcpServer === undefined ? {} : { mcpServer }) },
  });
  expect(registered.ok).toBe(true);
}

test("afterUntrusted is false for an extension tool when the turn read no untrusted result", async () => {
  const h = await createHarness({ layers: ALLOW });
  const seen: Seen[] = [];
  registerProbe(h, seen);
  registerSource(h, "safe_read", undefined);
  const run = h.run({ caller: "main" });
  await callTool(h.runtime.tools, run, { id: "c1", name: "safe_read", args: {} });
  await callTool(h.runtime.tools, run, { id: "c2", name: "ext_probe", args: {} });
  expect(seen).toEqual([{ toolCallId: "c2", caller: { kind: "model", agent: "main" } }]);
});

test("afterUntrusted is true for an extension tool after an MCP tool result in the same turn", async () => {
  const h = await createHarness({ layers: ALLOW });
  const seen: Seen[] = [];
  registerProbe(h, seen);
  registerSource(h, "mcp_read", "srv");
  const run = h.run({ caller: "main" });
  await callTool(h.runtime.tools, run, { id: "c1", name: "ext_probe", args: {} });
  await callTool(h.runtime.tools, run, { id: "c2", name: "mcp_read", args: {} });
  await callTool(h.runtime.tools, run, { id: "c3", name: "ext_probe", args: {} });
  expect(seen).toEqual([
    { toolCallId: "c1", caller: { kind: "model", agent: "main" } },
    { toolCallId: "c3", caller: { kind: "model", agent: "main", afterUntrusted: true } },
  ]);
});

test("afterUntrusted does not carry over to the next turn", async () => {
  const h = await createHarness({ layers: ALLOW });
  const seen: Seen[] = [];
  registerProbe(h, seen);
  registerSource(h, "mcp_read", "srv");
  await callTool(h.runtime.tools, h.run({ caller: "main" }), {
    id: "c1",
    name: "mcp_read",
    args: {},
  });
  await callTool(h.runtime.tools, h.run({ caller: "main" }), {
    id: "c2",
    name: "ext_probe",
    args: {},
  });
  expect(seen).toEqual([{ toolCallId: "c2", caller: { kind: "model", agent: "main" } }]);
});

test("a subagent caller keeps its name next to afterUntrusted", async () => {
  const h = await createHarness({ layers: ALLOW });
  const seen: Seen[] = [];
  registerProbe(h, seen);
  registerSource(h, "mcp_read", "srv");
  const run = h.run({ caller: "subagent:reviewer" });
  await callTool(h.runtime.tools, run, { id: "c1", name: "mcp_read", args: {} });
  await callTool(h.runtime.tools, run, { id: "c2", name: "ext_probe", args: {} });
  expect(seen).toEqual([
    {
      toolCallId: "c2",
      caller: { kind: "model", agent: "subagent", agentName: "reviewer", afterUntrusted: true },
    },
  ]);
});

const WebProbe = defineCapability({
  id: "web.fetch",
  version: "1.0.0",
  description: "web fetch stand-in",
  service: {
    methods: {
      run: {
        description: "run",
        input: Type.Object({}),
        output: Type.Object({ ok: Type.Boolean() }),
      },
    },
  },
  tools: [
    {
      name: "web_probe",
      label: "web_probe",
      description: "web_probe",
      method: "run",
      parameters: Type.Object({}),
    },
  ],
});

test("afterUntrusted is true after a web capability tool result", async () => {
  const h = await createHarness({ layers: ALLOW });
  const seen: Seen[] = [];
  registerProbe(h, seen);
  h.apis.set(WebProbe.id, { run: () => Promise.resolve({ ok: true }) });
  h.runtime.tools.register({
    kind: "capability",
    def: WebProbe,
    key: serviceKey(WebProbe),
    policy: { web_probe: { risk: "read" } },
  });
  const run = h.run({ caller: "main" });
  await callTool(h.runtime.tools, run, { id: "c1", name: "web_probe", args: {} });
  await callTool(h.runtime.tools, run, { id: "c2", name: "ext_probe", args: {} });
  expect(seen).toEqual([
    { toolCallId: "c2", caller: { kind: "model", agent: "main", afterUntrusted: true } },
  ]);
});

test("afterUntrusted survives a restart: a fresh runtime over the same events still sees the MCP read of the turn", async () => {
  const h = await createHarness({ layers: ALLOW });
  registerSource(h, "mcp_read", "srv");
  const run = h.run({ caller: "main" });
  await callTool(h.runtime.tools, run, { id: "c1", name: "mcp_read", args: {} });
  // 읽음 기록이 내구 이벤트로 남는다
  const recorded = h.session.events.filter((event) => event.kind === "tool.untrusted_read");
  expect(recorded.map((event) => event.payload)).toEqual([
    { turnId: run.turnId, toolCallId: "c1", toolName: "mcp_read", at: expect.any(Number) },
  ]);

  const restarted = createToolRuntime(h.deps);
  const seen: Seen[] = [];
  const registered = restarted.tools.register("ext-probe", {
    name: "ext_probe",
    description: "probe",
    parameters: Type.Object({}),
    replay: "safe",
    execute: (_args, ctx) => {
      seen.push({ toolCallId: ctx.toolCallId, caller: ctx.caller });
      return Promise.resolve("ok");
    },
  });
  expect(registered.ok).toBe(true);
  await callTool(restarted.tools, run, { id: "c2", name: "ext_probe", args: {} });
  expect(seen).toEqual([
    { toolCallId: "c2", caller: { kind: "model", agent: "main", afterUntrusted: true } },
  ]);
});

test("a restart does not invent afterUntrusted for a turn that read nothing untrusted", async () => {
  const h = await createHarness({ layers: ALLOW });
  const restarted = createToolRuntime(h.deps);
  const seen: Seen[] = [];
  restarted.tools.register("ext-probe", {
    name: "ext_probe",
    description: "probe",
    parameters: Type.Object({}),
    replay: "safe",
    execute: (_args, ctx) => {
      seen.push({ toolCallId: ctx.toolCallId, caller: ctx.caller });
      return Promise.resolve("ok");
    },
  });
  await callTool(restarted.tools, h.run({ caller: "main" }), {
    id: "c1",
    name: "ext_probe",
    args: {},
  });
  expect(seen).toEqual([{ toolCallId: "c1", caller: { kind: "model", agent: "main" } }]);
});
