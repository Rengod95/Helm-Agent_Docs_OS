import { expect, test } from "bun:test";
import { Type } from "typebox";
import {
  defineCapability,
  parseSecretRef,
  serviceKey,
  type CallContext,
  type CallOptions,
} from "@xeon/contracts/capabilities";
import type { ApprovalEvidence, ToolRunContext } from "@xeon/contracts/services";
import type { JsonObject } from "@xeon/contracts/conversation";
import { createCallTable } from "../src/calls.ts";
import { createPipeline } from "../src/pipeline.ts";
import { createRegistry } from "../src/registry.ts";
import { fakeSecretChecker } from "../src/testing/index.ts";
import type { ToolEntry } from "../src/types.ts";
import {
  ASSISTANT,
  callTool,
  createHarness,
  directTool,
  expectOk,
  layer,
  registerWorkspace,
  textOf,
  until,
  type Harness,
} from "./support/harness.ts";

// L1A.4: 비밀을 쓰는 호출(secretEnv)의 `needs_approval`이 승인 요청으로 이어지고, 받은 증거가 호출에 실린다(TL-18, L1.tools.spec §4.12, U-19)

const TOKEN = "secret://github-token";
const TOKEN_HANDLE = expectOk(parseSecretRef(TOKEN)).handle;
const PROMPT = {
  handle: TOKEN_HANDLE,
  desc: "GitHub token",
  purpose: "bash:gh",
  target: { kind: "command", argv0: "gh", commandLine: "gh api user" },
  ttlSeconds: 60,
} as const;

interface Probe {
  readonly runs: { readonly toolCallId: string; readonly evidence: ApprovalEvidence | null }[];
}

/** bash 이름의 시험 도구. secretEnv를 받는 인자 모양이고 실행 때 받은 증거를 기록한다 */
function pipelineFor(h: Harness): {
  probe: Probe;
  call: (
    run: ToolRunContext,
    id: string,
    args: JsonObject,
  ) => Promise<{ blocked: string | undefined }>;
} {
  const probe: Probe = { runs: [] };
  const entry: ToolEntry = {
    name: "bash",
    label: "bash",
    description: "bash",
    parameters: Type.Record(Type.String(), Type.Unknown()),
    outputSchema: undefined,
    executionMode: "parallel",
    ref: { capability: "ext.test", name: "bash" },
    capability: undefined,
    mcpServer: undefined,
    risk: "exec",
    classes: [],
    hints: {},
    replay: "unsafe",
    exposure: "always",
    outputLimits: {},
    raw: (call) => {
      probe.runs.push({ toolCallId: call.toolCallId, evidence: call.secretApproval });
      return Promise.resolve({
        result: { content: [{ type: "text", text: "ran" }], details: null },
        interrupted: false,
      });
    },
    locks: undefined,
  };
  const registry = createRegistry();
  registry.add([entry]);
  const pipeline = createPipeline(h.deps, registry, createCallTable(), h.runtime.approvals);
  return {
    probe,
    call: async (run, id, args) => {
      const toolCall = { type: "toolCall" as const, id, name: "bash", arguments: args };
      const prepared = await pipeline.prepare(toolCall, ASSISTANT, run);
      if (prepared.kind === "settled") return { blocked: textOf(prepared.outcome.result) };
      await pipeline.execute(prepared.call, () => {}, run);
      return { blocked: undefined };
    },
  };
}

const NEEDS = { kind: "needs_approval", approval: "per-use", prompt: PROMPT } as const;
const ARGS: JsonObject = { command: "gh api user", secretEnv: { GH_TOKEN: TOKEN } };
const ALLOW_BASH = layer("user", {
  "l1.tools.rules": [
    { id: "u.bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
  ],
});

test("the approval of the bash call itself is the per-use evidence: one request, and the call carries the evidence", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker });
  const { probe, call } = pipelineFor(h);
  const done = call(h.run(), "sec_1", ARGS);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.body).toMatchObject({
    kind: "tool",
    tool: { toolName: "bash", ruleId: "default.bash-ask" },
  });
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  expect((await done).blocked).toBeUndefined();

  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  expect(checker.calls).toHaveLength(1);
  expect(checker.calls[0]?.ctx).toMatchObject({
    mode: "env",
    purpose: "bash:gh",
    target: { kind: "command", argv0: "gh", commandLine: "gh api user" },
    actor: "agent",
    toolCallId: "sec_1",
    approval: null,
  });
  expect(probe.runs).toEqual([
    {
      toolCallId: "sec_1",
      evidence: {
        approvalId: request?.approvalId ?? "",
        scope: "per-use",
        grantedAt: expect.any(Number),
        expiresAt: null,
      },
    },
  ]);
});

test("when a rule already allows the call, the secret use is asked separately with its own rule id", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  const { probe, call } = pipelineFor(h);
  const done = call(h.run(), "sec_2", ARGS);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.body).toMatchObject({ kind: "tool", tool: { ruleId: "secret.use" } });
  expect(request?.title).toContain(TOKEN);
  expect(request?.remember).toEqual(["once"]);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  expect((await done).blocked).toBeUndefined();
  expect(probe.runs[0]?.evidence?.approvalId).toBe(request?.approvalId);
});

test("a non-interactive run denies the secret-use ask at once: the request and a noninteractive resolution are recorded in one commit", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  // 승인 서비스가 활성 호출 표에서 호출을 찾으므로 `pipelineFor`의 따로 만든 파이프라인이 아니라 런타임의 도구 경로를 쓴다
  const ran: string[] = [];
  h.runtime.tools.register({
    kind: "direct",
    orderKey: "ext.test",
    tool: directTool("bash", (toolCallId) => {
      ran.push(toolCallId);
      return Promise.resolve({ content: [{ type: "text", text: "ran" }], details: null });
    }),
    policy: { risk: "exec" },
  });
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "sec_ni",
    name: "bash",
    args: ARGS,
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(ran).toEqual([]);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  const approvals = h.session.events.filter((event) => event.kind.startsWith("approval."));
  expect(approvals.map((event) => event.kind)).toEqual(["approval.requested", "approval.resolved"]);
  expect(approvals[1]?.payload).toMatchObject({ decision: "deny", resolvedBy: "noninteractive" });
  const requestCommits = h.session.commits.filter((commit) =>
    commit.kinds.includes("approval.requested"),
  );
  expect(requestCommits.map((commit) => commit.kinds)).toEqual([
    ["approval.requested", "approval.resolved"],
  ]);
  expect(h.session.events.some((event) => event.kind === "effect.intent")).toBe(false);
});

test("a denied secret use blocks the call with the fixed sentence and writes no effect", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  const { probe, call } = pipelineFor(h);
  const done = call(h.run(), "sec_3", ARGS);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "deny",
    answer: { feedback: "no" },
  });
  const out = await done;
  expect(out.blocked).toContain("denied_by_user");
  expect(probe.runs).toEqual([]);
  expect(h.session.events.some((event) => event.kind === "effect.intent")).toBe(false);
});

test("a thread-remembered tool approval is not a fresh user approval: the secret use is asked again", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker });
  const { probe, call } = pipelineFor(h);
  const first = call(h.run(), "sec_4a", ARGS);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [one] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(one?.approvalId ?? "", {
    decision: "allow",
    remember: "thread",
  });
  await first;
  const second = call(h.run(), "sec_4b", ARGS);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [two] = h.runtime.approvals.pending(h.thread);
  expect(two?.body).toMatchObject({ tool: { ruleId: "secret.use" } });
  await h.runtime.approvals.respond(two?.approvalId ?? "", { decision: "allow" });
  await second;
  expect(probe.runs.map((run) => run.evidence?.approvalId)).toEqual([
    one?.approvalId,
    two?.approvalId,
  ]);
});

test("check refusals, missing secrets, foreign syntax and a missing secrets service block the call before any approval", async () => {
  const checker = fakeSecretChecker({
    [TOKEN]: { kind: "deny", reason: "command_mismatch" },
    "secret://other": { kind: "allow" },
  });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  const { probe, call } = pipelineFor(h);
  const denied = await call(h.run(), "sec_5a", ARGS);
  expect(denied.blocked).toContain("secret_denied");
  expect(denied.blocked).toContain("command_mismatch");
  const missing = await call(h.run(), "sec_5b", {
    command: "gh",
    secretEnv: { X: "secret://nowhere" },
  });
  expect(missing.blocked).toContain("secret_denied");
  expect(missing.blocked).toContain("secret_missing");
  const foreign = await call(h.run(), "sec_5c", { command: "gh", secretEnv: { X: "$TOKEN" } });
  expect(foreign.blocked).toContain("invalid_secret_ref");
  const noCommand = await call(h.run(), "sec_5d", { secretEnv: { X: "secret://other" } });
  expect(noCommand.blocked).toContain("needs a command");
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  expect(probe.runs).toEqual([]);

  const bare = await createHarness({ layers: [ALLOW_BASH] });
  const withoutService = pipelineFor(bare);
  const out = await withoutService.call(bare.run(), "sec_5e", ARGS);
  expect(out.blocked).toContain("secret_unavailable");
});

test("calls without secretEnv never reach the secrets service and run with no evidence", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  const { probe, call } = pipelineFor(h);
  const out = await call(h.run(), "sec_6", { command: "ls" });
  expect(out.blocked).toBeUndefined();
  expect(checker.calls).toEqual([]);
  expect(probe.runs).toEqual([{ toolCallId: "sec_6", evidence: null }]);
});

test("a per-session requirement is satisfied by the same per-use evidence", async () => {
  const checker = fakeSecretChecker({
    [TOKEN]: { kind: "needs_approval", approval: "per-session", prompt: PROMPT },
  });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  const { probe, call } = pipelineFor(h);
  const done = call(h.run(), "sec_7", ARGS);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(probe.runs[0]?.evidence).toMatchObject({ scope: "per-use", expiresAt: null });
});

/** secretEnv를 받는 시험용 셸 능력. 모델 도구 bash는 secretEnv를 광고하지 않으므로(L1.tools.spec §10) 그룹 코드가 쓰는 모양만 흉내 낸다 */
const ProbeShellInput = Type.Object({
  command: Type.String(),
  secretEnv: Type.Optional(Type.Record(Type.String(), Type.String())),
});
const ProbeShell = defineCapability({
  id: "test.probe-shell",
  version: "1.0.0",
  description: "secretEnv probe",
  service: {
    methods: {
      run: {
        description: "run",
        input: ProbeShellInput,
        output: Type.Object({ ok: Type.Boolean() }),
      },
    },
  },
  tools: [
    {
      name: "bash",
      label: "bash",
      description: "bash",
      method: "run",
      parameters: ProbeShellInput,
    },
  ],
});

test("a capability tool gets the evidence and the interactivity through CallContext (F request 13)", async () => {
  const checker = fakeSecretChecker({ [TOKEN]: NEEDS });
  const h = await createHarness({ secretChecker: checker, layers: [ALLOW_BASH] });
  const seen: (CallContext | undefined)[] = [];
  h.apis.set(ProbeShell.id, {
    run: (_input: unknown, options?: CallOptions) => {
      seen.push(options?.context);
      return Promise.resolve({ ok: true });
    },
  });
  h.runtime.tools.register({
    kind: "capability",
    def: ProbeShell,
    key: serviceKey(ProbeShell),
    policy: { bash: { risk: "exec" } },
  });
  const done = callTool(h.runtime.tools, h.run(), { id: "sec_cap", name: "bash", args: ARGS });
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  expect((await done).blocked).toBeUndefined();
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({
    toolCallId: "sec_cap",
    interactive: true,
    approval: { approvalId: request?.approvalId, scope: "per-use", expiresAt: null },
  });
});

test("a call that uses no secret carries no evidence", async () => {
  const h = await createHarness({ layers: [ALLOW_BASH] });
  const workspace = registerWorkspace(h);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "plain_1",
    name: "bash",
    args: { command: "ls" },
  });
  expect(out.blocked).toBeUndefined();
  const run = workspace.calls.find((call) => call.method === "run");
  expect(run?.context?.approval).toBeUndefined();
  expect(run?.context?.interactive).toBe(false);
});
