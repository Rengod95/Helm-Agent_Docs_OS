import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalJson, type Logger } from "@fresnel/contracts";
import { WorkspaceFiles, WorkspaceFilesKey } from "@fresnel/contracts/capabilities";
import type { ToolCallTraceEvent, ToolCallTraceSink } from "@fresnel/contracts/extensions";
import { argTokensOf } from "../src/call-trace.ts";
import { eachInOrder } from "../src/util.ts";
import {
  ASSISTANT,
  EDITED_FILE_CHANGE,
  NOW,
  callTool,
  createHarness,
  installHandlers,
  layer,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// 도구 호출 추적(`ToolCallTraceSink`, 정본 turn-record-metrics.md §3.2·§4.3). 닫힌 호출마다 한 줄이 나가고, 줄의 판정·주체·
// 승인·실행 값이 그 호출이 실제로 걸린 길과 맞아야 한다. 기록기가 있어도 모델이 보는 결과와 세션 사건은 같아야 한다.

/** 받은 줄을 순서대로 모은다 */
function collecting(): { readonly events: ToolCallTraceEvent[]; readonly sink: ToolCallTraceSink } {
  const events: ToolCallTraceEvent[] = [];
  return {
    events,
    sink: {
      record: (event) => {
        events.push(event);
      },
    },
  };
}

/** 호출 id의 줄. 없으면 undefined이고 `toMatchObject`가 그 사실을 드러낸다 */
function lineOf(
  events: readonly ToolCallTraceEvent[],
  toolCallId: string,
): ToolCallTraceEvent | undefined {
  return events.find((event) => event.toolCallId === toolCallId);
}

function pendingCards(h: Harness) {
  return h.runtime.approvals.pending(h.thread);
}

/** 경고 이름을 모은다. 추적 싱크가 던졌을 때 남는 경고를 확인한다 */
function recordingLogger(): { readonly logger: Logger; readonly warnings: string[] } {
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => {
      warnings.push(event);
    },
    error: () => undefined,
    child: () => logger,
  };
  return { logger, warnings };
}

test("an allowed read records one allowed line with its owner, caller, exec and result", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const run = h.run();
  const out = await callTool(h.runtime.tools, run, {
    id: "t_read",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.isError).toBe(false);
  expect(trace.events).toHaveLength(1);
  expect(lineOf(trace.events, "t_read")).toMatchObject({
    threadId: h.thread,
    turnId: run.turnId,
    stepId: run.stepId,
    parentToolCallId: null,
    tool: "read",
    plugin: WorkspaceFiles.id,
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "read",
    capability: { id: WorkspaceFiles.id, method: "read" },
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    approval: null,
    exec: { startedAt: NOW, durationMs: 0, status: "ok" },
    result: { truncated: false, isError: false },
    closedAt: NOW,
  });
  // 인자 값은 싣지 않는다. 정규화 JSON의 해시와 글자 수만 남는다
  const canonical = canonicalJson({ path: "a.txt" });
  expect(lineOf(trace.events, "t_read")?.argsHash).toBe(
    createHash("sha256").update(canonical).digest("hex"),
  );
  expect(lineOf(trace.events, "t_read")?.argTokenCount).toBe(Math.ceil(canonical.length / 4));
  // 문자열 인자 "a.txt"의 토큰은 a(두 글자 미만이라 버림)와 txt다
  expect(lineOf(trace.events, "t_read")?.argTokens).toEqual(["txt"]);
});

test("the argument tokens are the lowercase words of the top-level string arguments, in key order, without duplicates", () => {
  expect(
    argTokensOf({
      path: "src/A.ts",
      command: "Git status --short; rm -rf build/ && GIT status",
      count: 3,
      flag: true,
      note: "a",
      nested: { text: "ignored because it is not top-level" },
    }),
  ).toEqual(["git", "status", "short", "rm", "rf", "build", "src", "ts"]);
  expect(argTokensOf({ text: "Résumé 2026 año, 東京 ok" })).toEqual([
    "résumé",
    "2026",
    "año",
    "東京",
    "ok",
  ]);
  expect(argTokensOf({ count: 3 })).toEqual([]);
  expect(argTokensOf(["not", "an", "object"])).toEqual([]);
});

test("the argument tokens stop at 64 distinct words and cut each word at 64 characters", () => {
  const words = Array.from({ length: 70 }, (_, index) => `w${String(index).padStart(3, "0")}`);
  const tokens = argTokensOf({ text: words.join(" ") });
  expect(tokens).toHaveLength(64);
  expect(tokens[0]).toBe("w000");
  expect(tokens.at(-1)).toBe("w063");
  const long = "x".repeat(70);
  expect(argTokensOf({ text: long })).toEqual(["x".repeat(64)]);
});

test("a tool.call.before block records blocked_hook with the blocking handler", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ block: true, reason: "no reads" }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "t_hook",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("[fresnel:denied_by_extension] no reads");
  expect(lineOf(trace.events, "t_hook")).toMatchObject({
    verdict: "blocked_hook",
    blockedBy: { plugin: "gate", hook: "tool.call.before" },
    policy: null,
    approval: null,
    exec: null,
    result: { isError: true, truncated: false },
  });
});

test("a tool.call.before handler that throws records blocked_hook_fault under that handler", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  await installHandlers(h, "bad-hook", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => {
      throw new Error("boom");
    });
  });
  await callTool(h.runtime.tools, h.run(), {
    id: "t_fault",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(lineOf(trace.events, "t_fault")).toMatchObject({
    verdict: "blocked_hook_fault",
    blockedBy: { plugin: "bad-hook", hook: "tool.call.before" },
    exec: null,
  });
});

test("a guard.tool.before block records blocked_guard and a throwing guard records blocked_guard_fault", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  await installHandlers(h, "guard", ["guard.tool.before"], (g) => {
    g.on("guard.tool.before", (payload) => {
      if (payload.toolCallId === "t_guard_block") {
        return { block: true, reason: "no reads today" };
      }
      throw new Error("boom");
    });
  });
  await callTool(h.runtime.tools, h.run(), {
    id: "t_guard_block",
    name: "read",
    args: { path: "a.txt" },
  });
  await callTool(h.runtime.tools, h.run(), {
    id: "t_guard_fault",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(lineOf(trace.events, "t_guard_block")).toMatchObject({
    verdict: "blocked_guard",
    blockedBy: { plugin: "guard", hook: "guard.tool.before" },
  });
  expect(lineOf(trace.events, "t_guard_fault")).toMatchObject({
    verdict: "blocked_guard_fault",
    blockedBy: { plugin: "guard", hook: "guard.tool.before" },
  });
});

test("a replace decision records replaced_hook and runs nothing", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  const probe = registerWorkspace(h);
  await installHandlers(h, "cacher", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({
      replace: { content: [{ type: "text", text: "from cache" }] },
      reason: "cached",
    }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "t_replace",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe("from cache");
  expect(probe.calls).toEqual([]);
  expect(lineOf(trace.events, "t_replace")).toMatchObject({
    verdict: "replaced_hook",
    blockedBy: { plugin: "cacher", hook: "tool.call.before" },
    exec: null,
    result: { isError: false },
  });
});

test("a policy deny records denied_policy with the deciding rule's tier and no blocking handler", async () => {
  const trace = collecting();
  const h = await createHarness({
    callTrace: trace.sink,
    layers: [
      layer("user", {
        "l1.tools.rules": [
          { id: "u.deny-read", action: "tool.call", resource: { tool: "read" }, effect: "deny" },
        ],
      }),
    ],
  });
  const probe = registerWorkspace(h);
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "t_policy",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.isError).toBe(true);
  expect(probe.calls).toEqual([]);
  expect(lineOf(trace.events, "t_policy")).toMatchObject({
    verdict: "denied_policy",
    policy: { effect: "deny", tier: "user" },
    blockedBy: null,
    approval: null,
    exec: null,
  });
});

test("a bash call the user denies records denied_human, and one the user allows records allowed with the answer", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const denied = callTool(h.runtime.tools, h.run(), {
    id: "t_human_no",
    name: "bash",
    args: { command: "echo no" },
  });
  await until(() => pendingCards(h).length === 1);
  const [denyCard] = pendingCards(h);
  await h.runtime.approvals.respond(denyCard?.approvalId ?? "", { decision: "deny" });
  await denied;
  const allowed = callTool(h.runtime.tools, h.run(), {
    id: "t_human_yes",
    name: "bash",
    args: { command: "echo yes" },
  });
  await until(() => pendingCards(h).length === 1);
  const [allowCard] = pendingCards(h);
  await h.runtime.approvals.respond(allowCard?.approvalId ?? "", { decision: "allow" });
  await allowed;

  expect(lineOf(trace.events, "t_human_no")).toMatchObject({
    tool: "bash",
    risk: "exec",
    verdict: "denied_human",
    policy: { effect: "ask", tier: "default" },
    approval: {
      approvalId: denyCard?.approvalId,
      decision: "deny",
      resolvedBy: "user",
      waitMs: 0,
      inheritedFrom: null,
    },
    exec: null,
  });
  expect(lineOf(trace.events, "t_human_yes")).toMatchObject({
    verdict: "allowed",
    approval: {
      approvalId: allowCard?.approvalId,
      decision: "allow",
      resolvedBy: "user",
      inheritedFrom: null,
    },
    exec: { status: "ok" },
  });
});

test("a call with no one to ask records denied_noninteractive with the unattended resolution", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "t_noninteractive",
    name: "bash",
    args: { command: "echo none" },
  });
  expect(out.isError).toBe(true);
  expect(lineOf(trace.events, "t_noninteractive")).toMatchObject({
    verdict: "denied_noninteractive",
    policy: { effect: "deny", tier: "default" },
    blockedBy: null,
    approval: null,
    exec: null,
  });
});

test("a hook ask the user denies records denied_human with no blocking handler", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "t_hook_ask",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  const [card] = pendingCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  await done;
  expect(lineOf(trace.events, "t_hook_ask")).toMatchObject({
    verdict: "denied_human",
    blockedBy: null,
    approval: { approvalId: card?.approvalId, decision: "deny", resolvedBy: "user" },
  });
});

test("an unknown tool records unavailable with no owner, risk or capability", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  await callTool(h.runtime.tools, h.run(), { id: "t_missing", name: "no_such_tool", args: {} });
  expect(lineOf(trace.events, "t_missing")).toMatchObject({
    tool: "no_such_tool",
    plugin: null,
    risk: null,
    capability: null,
    targetHash: null,
    verdict: "unavailable",
    policy: null,
    exec: null,
  });
});

test("arguments that fail the schema record invalid_args with the owner known", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const out = await callTool(h.runtime.tools, h.run(), { id: "t_bad", name: "read", args: {} });
  expect(out.isError).toBe(true);
  expect(lineOf(trace.events, "t_bad")).toMatchObject({
    tool: "read",
    plugin: WorkspaceFiles.id,
    risk: "read",
    verdict: "invalid_args",
    exec: null,
  });
});

test("a prepared call the batch does not run records aborted, and a truncated call that was never prepared records invalid_args", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const run = h.run();
  const prepared = await h.runtime.tools.prepare(
    { type: "toolCall", id: "t_cancel", name: "read", arguments: { path: "a.txt" } },
    ASSISTANT,
    run,
  );
  expect(prepared.kind).toBe("ready");
  await h.runtime.tools.settleRejected(
    [{ type: "toolCall", id: "t_cancel", name: "read", arguments: { path: "a.txt" } }],
    "not_executed",
    run,
  );
  await h.runtime.tools.settleRejected(
    [{ type: "toolCall", id: "t_cut", name: "read", arguments: { path: "a.txt" } }],
    "truncated",
    run,
  );
  expect(lineOf(trace.events, "t_cancel")).toMatchObject({
    verdict: "aborted",
    exec: null,
    result: { isError: true },
  });
  expect(lineOf(trace.events, "t_cut")).toMatchObject({
    verdict: "invalid_args",
    tool: "read",
    exec: null,
  });
});

test("a plugin call with no parent records the calling plugin, the via path and no turn", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    plugin: { name: "cap-reader", scopeId: "scope-reader" },
    via: "method",
    target: { kind: "capability", capability: "workspace.files", method: "read" },
    input: { path: "a.txt" },
    requestId: "p-read",
  });
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(trace.events).toHaveLength(1);
  expect(trace.events[0]).toMatchObject({
    turnId: null,
    stepId: null,
    parentToolCallId: null,
    tool: "read",
    plugin: WorkspaceFiles.id,
    caller: "plugin",
    callerPlugin: "cap-reader",
    via: "method",
    risk: "read",
    verdict: "allowed",
    approval: null,
    exec: { status: "ok" },
  });
});

test("a plugin call made while a tool call waits for approval takes that call's turn, step and parent id", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const run = h.run();
  // 사용자 승인을 기다리는 bash 호출이 바깥 호출이다. 그동안 플러그인이 그 호출을 바깥으로 두고 read를 부른다
  const outer = callTool(h.runtime.tools, run, {
    id: "t_outer",
    name: "bash",
    args: { command: "echo outer" },
  });
  await until(() => pendingCards(h).length === 1);
  const inner = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    plugin: { name: "cap-reader", scopeId: "scope-reader" },
    via: "tool",
    target: { kind: "capability", capability: "workspace.files", method: "read" },
    input: { path: "a.txt" },
    requestId: "p-inner",
    parentToolCallId: "t_outer",
  });
  expect(inner).toMatchObject({ ok: true, value: { isError: false } });
  const [card] = pendingCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  await outer;
  const innerLines = trace.events.filter((event) => event.caller === "plugin");
  expect(innerLines).toHaveLength(1);
  expect(innerLines[0]).toMatchObject({
    turnId: run.turnId,
    stepId: run.stepId,
    parentToolCallId: "t_outer",
    callerPlugin: "cap-reader",
    via: "tool",
    verdict: "allowed",
  });
});

test("a plugin call that inherits a human-answered review card records the inherited approval", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerEditable(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    plugin: { name: "cap-artifacts", scopeId: "scope-artifacts" },
    via: "method",
    target: { kind: "capability", capability: "workspace.files", method: "edit" },
    input: EDIT_A,
    requestId: "inherit-trace",
    inheritApproval: { approvalId },
  });
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(trace.events).toHaveLength(1);
  expect(trace.events[0]).toMatchObject({
    caller: "plugin",
    callerPlugin: "cap-artifacts",
    via: "method",
    tool: "edit",
    risk: "write",
    verdict: "allowed",
    policy: { effect: "ask", tier: null },
    approval: {
      approvalId,
      decision: "allow",
      resolvedBy: "user",
      waitMs: 0,
      inheritedFrom: approvalId,
    },
    exec: { status: "ok" },
  });
});

test("a plugin call to a missing target records unavailable under the calling plugin", async () => {
  const trace = collecting();
  const h = await createHarness({ callTrace: trace.sink });
  registerWorkspace(h);
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    plugin: { name: "cap-reader", scopeId: "scope-reader" },
    via: "command",
    target: { kind: "tool", name: "no_such_tool" },
    input: {},
    requestId: "p-missing",
  });
  expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  expect(trace.events).toHaveLength(1);
  expect(trace.events[0]).toMatchObject({
    tool: "no_such_tool",
    plugin: null,
    caller: "plugin",
    callerPlugin: "cap-reader",
    via: "command",
    verdict: "unavailable",
    exec: null,
    result: null,
  });
});

test("the model sees the same results with and without a trace sink, and the session records the same events", async () => {
  const without = await runSequence(await createHarness());
  const trace = collecting();
  const withSink = await runSequence(await createHarness({ callTrace: trace.sink }));
  expect(withSink.results).toEqual(without.results);
  expect(withSink.events).toEqual(without.events);
  expect(trace.events.map((event) => event.verdict)).toEqual([
    "allowed",
    "blocked_hook",
    "invalid_args",
    "unavailable",
  ]);
});

test("a trace sink that throws leaves the call outcomes unchanged and logs one warning per closed call", async () => {
  const without = await runSequence(await createHarness());
  const logged = recordingLogger();
  const throwing: ToolCallTraceSink = {
    record: () => {
      throw new Error("sink down");
    },
  };
  const withThrowing = await runSequence(
    await createHarness({ callTrace: throwing, logger: logged.logger }),
  );
  expect(withThrowing.results).toEqual(without.results);
  expect(withThrowing.events).toEqual(without.events);
  expect(logged.warnings).toEqual([
    "tools.call_trace_failed",
    "tools.call_trace_failed",
    "tools.call_trace_failed",
    "tools.call_trace_failed",
  ]);
});

/**
 * 같은 입력을 한 하네스에 흘린다. 모델이 보는 결과(차단 사유, 오류 표지, 메시지)와 세션 사건을 정규화 JSON 문자열로 돌려준다.
 * 메시지에는 시각과 id가 들지만 하네스의 시계와 순차 id 때문에 두 하네스에서 같다
 */
async function runSequence(h: Harness): Promise<{
  readonly results: string[];
  readonly events: string[];
}> {
  registerWorkspace(h);
  const run = h.run();
  await installHandlers(h, "gate", ["tool.call.before"], (g) => {
    g.on("tool.call.before", (payload) =>
      payload.toolCallId === "s_blocked" ? { block: true, reason: "private" } : undefined,
    );
  });
  const calls = [
    { id: "s_ok", name: "read", args: { path: "a.txt" } },
    { id: "s_blocked", name: "read", args: { path: "blocked.txt" } },
    { id: "s_invalid", name: "read", args: {} },
    { id: "s_missing", name: "no_such_tool", args: {} },
  ];
  const results: string[] = [];
  // 호출은 차례로 흘려야 순차 id와 세션 사건의 순서가 두 하네스에서 같다
  await eachInOrder(calls, async (call) => {
    const out = await callTool(h.runtime.tools, run, call);
    results.push(
      canonicalJson({
        blocked: out.blocked ?? null,
        isError: out.isError,
        message: out.outcome.message,
      }),
    );
  });
  const events = h.session.events.map((event) =>
    canonicalJson({ kind: event.kind, payload: event.payload }),
  );
  return { results, events };
}

const EDIT_A = { path: "src/a.ts", edits: [{ oldText: "new a", newText: "old a" }] };
const REVIEW_ID = "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function digestOf(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** 쓰기 위험 등급의 편집 기능을 올린다(U-11 시험과 같은 모양). 정책이 묻도록 `edit`을 write로 둔다 */
function registerEditable(h: Harness): void {
  h.apis.set(WorkspaceFiles.id, {
    edit: () => Promise.resolve({ applied: 1, matchMode: "exact", change: EDITED_FILE_CHANGE }),
  });
  h.runtime.tools.register({
    kind: "capability",
    def: WorkspaceFiles,
    key: WorkspaceFilesKey,
    policy: { edit: { risk: "write" } },
  });
}

/** 검토 카드를 열고 사람이 답하게 한 승인 id를 돌려준다 */
async function answeredReviewCard(h: Harness, writes: readonly string[]): Promise<string> {
  const opened = await h.runtime.approvals.open({
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "rvw-card-trace",
    title: "Review the changes",
    body: {
      kind: "review",
      review: {
        reviewId: REVIEW_ID,
        artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        title: "t",
        round: 1,
        files: [{ path: "src/a.ts", change: "modified", binary: false, hunks: 1 }],
        writes: [...writes],
      },
    },
    remember: ["once"],
  });
  if (!opened.ok) throw new Error("the review card was not opened");
  return opened.value.request.approvalId;
}

async function answer(h: Harness, approvalId: string): Promise<void> {
  const applied = await h.runtime.approvals.respond(approvalId, {
    decision: "answer",
    answer: { decisions: [{ hunkId: "f0h0", decision: "rejected" }], comments: [], submit: true },
  });
  expect(applied).toEqual({ applied: true });
}
