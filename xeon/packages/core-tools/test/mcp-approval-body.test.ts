import { expect, test } from "bun:test";
import type { ApprovalBodyJson } from "@fresnel/contracts/records";
import { approvalBodyOf } from "../src/approvals/pending.ts";
import {
  callTool,
  createHarness,
  directTool,
  registerWorkspace,
  until,
} from "./support/harness.ts";

// MCP 서버 도구의 승인 본문은 서버 이름과 서버가 알린 성질을 싣는다(표시용). 정책과 승인 결정은 바뀌지 않는다.

test("an MCP tool's approval names the server and the traits the server declared, and still asks", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "mcp.qa",
    tool: directTool("echo", () =>
      Promise.resolve({ content: [{ type: "text", text: "ok" }], details: null }),
    ),
    policy: {
      mcpServer: "qa",
      risk: "exec",
      mcpDeclared: { readOnlyHint: true, destructiveHint: false },
    },
    exposure: "always",
  });
  const run = h.run();
  const done = callTool(h.runtime.tools, run, {
    id: "call_mcp",
    name: "echo",
    args: { text: "hi" },
  });
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  const [request] = h.runtime.approvals.pending(h.thread);
  if (request?.body.kind !== "tool") throw new Error("the MCP tool must ask with a tool approval");
  expect(request.body.tool.mcp).toStrictEqual({
    server: "qa",
    declared: { readOnlyHint: true, destructiveHint: false },
  });
  expect(request.body.tool.toolName).toBe("echo");
  // 선언한 읽기 전용 성질은 정책 입력이 아니라서 여전히 묻는다
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  await h.runtime.approvals.respond(request.approvalId, { decision: "allow" });
  expect((await done).isError).toBe(false);
});

test("an MCP tool that declares nothing carries the server name and no declared traits", async () => {
  const h = await createHarness();
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "mcp.qa",
    tool: directTool("echo", () =>
      Promise.resolve({ content: [{ type: "text", text: "ok" }], details: null }),
    ),
    policy: { mcpServer: "qa", risk: "exec" },
    exposure: "always",
  });
  const run = h.run();
  const done = callTool(h.runtime.tools, run, { id: "call_bare", name: "echo", args: {} });
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  const [request] = h.runtime.approvals.pending(h.thread);
  if (request?.body.kind !== "tool") throw new Error("the MCP tool must ask with a tool approval");
  expect(request.body.tool.mcp).toStrictEqual({ server: "qa" });
  await h.runtime.approvals.respond(request.approvalId, { decision: "deny" });
  await done;
});

test("an ordinary tool's approval carries no MCP fields", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const run = h.run();
  const done = callTool(h.runtime.tools, run, {
    id: "call_bash",
    name: "bash",
    args: { command: "ls" },
  });
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  const [request] = h.runtime.approvals.pending(h.thread);
  if (request?.body.kind !== "tool") throw new Error("bash must ask with a tool approval");
  expect(request.body.tool).not.toHaveProperty("mcp");
  await h.runtime.approvals.respond(request.approvalId, { decision: "deny" });
  await done;
});

test("a recorded approval body keeps the MCP fields when it is read back, and an old body without them reads as before", () => {
  const recorded: ApprovalBodyJson = {
    kind: "tool",
    tool: {
      toolName: "echo",
      risk: "exec",
      args: { text: "hi" },
      argsHash: "h",
      ruleId: "mcp.default",
      mcp: { server: "qa", declared: { destructiveHint: true } },
    },
  };
  expect(approvalBodyOf(recorded)).toStrictEqual({
    kind: "tool",
    tool: {
      toolName: "echo",
      risk: "exec",
      args: { text: "hi" },
      argsHash: "h",
      ruleId: "mcp.default",
      mcp: { server: "qa", declared: { destructiveHint: true } },
    },
  });
  const old: ApprovalBodyJson = {
    kind: "tool",
    tool: { toolName: "bash", risk: "exec", args: { command: "ls" }, argsHash: "h", ruleId: null },
  };
  expect(approvalBodyOf(old)).toStrictEqual({
    kind: "tool",
    tool: { toolName: "bash", risk: "exec", args: { command: "ls" }, argsHash: "h", ruleId: null },
  });
});
