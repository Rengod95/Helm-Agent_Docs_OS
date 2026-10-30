import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalJson } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import { createMcpStartGate, type McpStartDefinition } from "../src/mcp-start.ts";
import { fakeApprovals, fakeSecretChecker } from "../src/testing/index.ts";
import { expectOk, until } from "./support/harness.ts";

// M3-05, M3-REQ-75, L1.tools.spec §4.12.1. 비밀 env stdio 서버의 기동 승인: 정의 해시마다 한 번, 승인 레코드에 정의 해시가 실린다.

const REF = "secret://gh-token";
const HANDLE = expectOk(parseSecretRef(REF)).handle;
const NEEDS = {
  kind: "needs_approval",
  approval: "per-session",
  prompt: {
    handle: HANDLE,
    desc: "GitHub token",
    purpose: "mcp.start:gh",
    target: { kind: "command", argv0: "gh-mcp", commandLine: "mcp:gh" },
    ttlSeconds: 60,
  },
} as const;

const DEFINITION: McpStartDefinition = {
  server: "gh",
  source: "settings:user",
  command: "gh-mcp",
  args: ["--stdio"],
  cwd: null,
  env: { LOG_LEVEL: "info" },
  secretEnv: { GITHUB_TOKEN: REF },
};

const hashOf = (definition: McpStartDefinition): string =>
  createHash("sha256")
    .update(canonicalJson({ ...definition }))
    .digest("hex");

async function setup(table: Parameters<typeof fakeSecretChecker>[0] = { [HANDLE]: NEEDS }) {
  const world = await fakeApprovals();
  const thread = world.ids.next("thr");
  await world.openThread(thread);
  const secrets = fakeSecretChecker(table);
  const gate = createMcpStartGate({
    approvals: world.approvals,
    secrets,
    hash: hashOf,
    clock: { now: () => 1_000 },
    logger: undefined,
  });
  return { world, thread, secrets, gate };
}

test("the first start asks once, the request record carries the definition hash, and an allow yields session evidence", async () => {
  const { world, thread, gate } = await setup();
  const resolved: string[] = [];
  gate.onResolved((server) => resolved.push(server));
  expect(await gate.check(DEFINITION, { threadId: thread })).toEqual({ kind: "pending" });
  const [request] = world.approvals.pending(thread);
  expect(request?.title).toBe('Start MCP server "gh" with secret://gh-token?');
  expect(request?.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "mcp_start",
      risk: "exec",
      ruleId: "mcp.start",
      argsHash: hashOf(DEFINITION),
      args: {
        server: "gh",
        definitionHash: hashOf(DEFINITION),
        secretEnv: { GITHUB_TOKEN: REF },
        envNames: ["LOG_LEVEL"],
      },
    },
  });
  // 같은 정의로 다시 부르면 새 요청이 생기지 않는다
  expect(await gate.check(DEFINITION, { threadId: thread })).toEqual({ kind: "pending" });
  expect(world.approvals.pending(thread)).toHaveLength(1);

  expect(await world.approvals.respond(request?.approvalId ?? "", { decision: "allow" })).toEqual({
    applied: true,
  });
  await until(() => resolved.length > 0);
  expect(resolved).toEqual(["gh"]);
  expect(await gate.check(DEFINITION, { threadId: thread })).toEqual({
    kind: "approved",
    evidence: {
      approvalId: request?.approvalId ?? "",
      scope: "per-session",
      grantedAt: 1_000,
      expiresAt: null,
    },
  });
  expect(world.approvals.pending(thread)).toEqual([]);
});

test("a changed definition asks again and a restored definition matches the earlier approval", async () => {
  const { world, thread, gate } = await setup();
  const resolved: string[] = [];
  gate.onResolved((server) => resolved.push(server));
  await gate.check(DEFINITION, { threadId: thread });
  const first = world.approvals.pending(thread)[0]?.approvalId ?? "";
  await world.approvals.respond(first, { decision: "allow" });
  await until(() => resolved.length > 0);
  const changed: McpStartDefinition = { ...DEFINITION, args: ["--stdio", "--write"] };
  expect(await gate.check(changed, { threadId: thread })).toEqual({ kind: "pending" });
  const pending = world.approvals.pending(thread);
  expect(pending).toHaveLength(1);
  expect(pending[0]?.body).toMatchObject({
    tool: { argsHash: hashOf(changed), args: { definitionHash: hashOf(changed) } },
  });
  // 처음 정의로 되돌리면 같은 승인이 다시 맞는다
  expect((await gate.check(DEFINITION, { threadId: thread })).kind).toBe("approved");
});

test("a deny is reported as denied and a policy deny never reaches the user", async () => {
  const { world, thread, gate } = await setup();
  await gate.check(DEFINITION, { threadId: thread });
  const id = world.approvals.pending(thread)[0]?.approvalId ?? "";
  await world.approvals.respond(id, { decision: "deny" });
  await until(() => world.approvals.pending(thread).length === 0);
  const verdict = await gate.check(DEFINITION, { threadId: thread });
  expect(verdict.kind).toBe("denied");

  const blocked = await setup({ [HANDLE]: { kind: "deny", reason: "tool_not_allowed" } });
  expect(await blocked.gate.check(DEFINITION, { threadId: blocked.thread })).toEqual({
    kind: "denied",
    reason: `${HANDLE}: tool_not_allowed`,
  });
  expect(blocked.world.approvals.pending(blocked.thread)).toEqual([]);
});

test("without a thread the gate has nowhere to ask and stays pending without a request", async () => {
  const { world, thread, gate } = await setup();
  expect(await gate.check(DEFINITION, { threadId: undefined })).toEqual({ kind: "pending" });
  expect(world.approvals.pending(thread)).toEqual([]);
});

test("the policy check uses the mcp.start purpose and the mcp:<server> command target", async () => {
  const { thread, secrets, gate } = await setup();
  await gate.check(DEFINITION, { threadId: thread });
  expect(secrets.calls[0]?.ctx).toMatchObject({
    mode: "env",
    purpose: "mcp.start:gh",
    target: { kind: "command", argv0: "gh-mcp", commandLine: "mcp:gh" },
    approval: null,
  });
});
