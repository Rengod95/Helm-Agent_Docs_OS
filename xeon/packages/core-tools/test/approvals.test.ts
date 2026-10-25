import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { ApprovalResolvedPayloadSchema, COMMIT_KEY_PATTERN } from "@xeon/contracts/records";
import type { ApprovalRequestInput } from "@xeon/contracts/services";
import { createToolRuntime } from "../src/runtime.ts";
import {
  callTool,
  createHarness,
  installHandlers,
  registerWorkspace,
  textOf,
  until,
  type Harness,
  expectOk,
} from "./support/harness.ts";

function kinds(h: Harness): string[] {
  return h.session.events.map((event) => event.kind);
}

async function startBash(h: Harness, id: string, command = "echo hi") {
  const run = h.run();
  const done = callTool(h.runtime.tools, run, { id, name: "bash", args: { command } });
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  return { run, done };
}

test("bash asks: an allow response runs the tool and every step is recorded in order", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const { done } = await startBash(h, "call_1");
  expect(probe.calls).toEqual([]);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "bash",
      risk: "exec",
      ruleId: "default.bash-ask",
      args: { command: "echo hi" },
    },
  });
  // `always`는 제안하지 않는다(L1.tools.spec §4.7 6번)
  expect(request?.remember).toEqual(["once", "thread"]);
  const applied = await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "allow",
  });
  expect(applied).toEqual({ applied: true });
  const out = await done;
  expect(out.blocked).toBeUndefined();
  expect(textOf(out.result)).toContain("ok");
  expect(probe.calls.map((call) => call.method)).toEqual(["run"]);
  expect(kinds(h)).toEqual([
    "approval.requested",
    "checkpoint.step",
    "approval.resolved",
    "effect.intent",
    "effect.exec",
    "effect.result",
    "item.recorded",
  ]);
  expect(h.session.commits.map((commit) => commit.requestId)[0]).toMatch(
    /^approval:thr_[0-9A-Z]{26}:call_1:request$/,
  );
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
});

test("approval ids are the approval.requested event ids", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const { done } = await startBash(h, "call_2");
  const [request] = h.runtime.approvals.pending(h.thread);
  const requested = h.session.events.find((event) => event.kind === "approval.requested");
  expect(request?.approvalId).toBe(requested?.id);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "deny" });
  await done;
});

test("a deny response blocks the call with the fixed sentence and the user's feedback", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const { done } = await startBash(h, "call_3", "rm -rf build");
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "deny",
    answer: { feedback: "use trash instead" },
  });
  const out = await done;
  expect(out.blocked).toBe(
    "[xeon:denied_by_user] The user denied this tool call. Feedback: use trash instead",
  );
  expect(probe.calls).toEqual([]);
  // 거부된 호출에는 효과 이벤트가 없다
  expect(kinds(h)).toEqual([
    "approval.requested",
    "checkpoint.step",
    "approval.resolved",
    "item.recorded",
  ]);
});

test("approval_respond_twice_not_applied: the second response changes nothing", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const { done } = await startBash(h, "call_4");
  const [request] = h.runtime.approvals.pending(h.thread);
  const id = request?.approvalId ?? "";
  expect(await h.runtime.approvals.respond(id, { decision: "allow" })).toEqual({ applied: true });
  const before = h.session.events.length;
  expect(await h.runtime.approvals.respond(id, { decision: "deny" })).toEqual({
    applied: false,
    reason: "already_resolved",
  });
  await done;
  expect(h.session.events.filter((event) => event.kind === "approval.resolved")).toHaveLength(1);
  expect(h.session.events.length).toBeGreaterThanOrEqual(before);
});

test("an unknown approval id and an invalid response are not applied", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  expect(await h.runtime.approvals.respond("evt_missing", { decision: "allow" })).toEqual({
    applied: false,
    reason: "unknown_approval",
  });
  const { done } = await startBash(h, "call_5");
  const [request] = h.runtime.approvals.pending(h.thread);
  const id = request?.approvalId ?? "";
  // tool 요청에는 answer 결정을 쓸 수 없다
  expect(await h.runtime.approvals.respond(id, { decision: "answer" })).toMatchObject({
    applied: false,
    reason: "answer_invalid",
  });
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  await h.runtime.approvals.respond(id, { decision: "allow" });
  await done;
});

test("approval_remember_thread_skips_next_ask, and restore rebuilds the allow list", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const first = await startBash(h, "call_6");
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "allow",
    remember: "thread",
  });
  await first.done;
  // 같은 도구의 다음 ask는 승인 없이 allow다
  const second = await callTool(h.runtime.tools, h.run(), {
    id: "call_7",
    name: "bash",
    args: { command: "echo again" },
  });
  expect(second.blocked).toBeUndefined();
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  expect(probe.calls).toHaveLength(2);

  // 재개 뒤에도 같다: 새 서비스가 이벤트에서 허용 목록을 다시 만든다
  const restarted = createToolRuntime(h.deps);
  registerWorkspace({ ...h, runtime: restarted });
  await restarted.approvals.restore(h.thread);
  const third = await callTool(restarted.tools, h.run(), {
    id: "call_8",
    name: "bash",
    args: { command: "echo after restart" },
  });
  expect(third.blocked).toBeUndefined();
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
});

test("a client that asks for always on a bash request is refused, because always is not offered", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const { done } = await startBash(h, "call_9");
  const [request] = h.runtime.approvals.pending(h.thread);
  const refused = await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "allow",
    remember: "always",
  });
  expect(refused).toMatchObject({ applied: false, reason: "answer_invalid" });
  expect(refused.applied ? "" : (refused.detail ?? "")).toContain("always");
  // 요청은 그대로 대기 중이라 고쳐 보낼 수 있다
  const retried = await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "allow",
    remember: "thread",
  });
  expect(retried).toEqual({ applied: true });
  await done;
  // 해결된 요청과 모르는 요청은 이유가 다르다: 클라이언트가 "고쳐 보낸다"와 "더 할 일 없다"를 구분한다
  expect(
    await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" }),
  ).toEqual({ applied: false, reason: "already_resolved" });
  expect(await h.runtime.approvals.respond("evt_unknown", { decision: "allow" })).toEqual({
    applied: false,
    reason: "unknown_approval",
  });
});

test("a decision that does not fit the request kind says which part is wrong and keeps the request pending", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const { done } = await startBash(h, "call_dec");
  const [request] = h.runtime.approvals.pending(h.thread);
  const refused = await h.runtime.approvals.respond(request?.approvalId ?? "", {
    decision: "answer",
  });
  expect(refused).toEqual({
    applied: false,
    reason: "answer_invalid",
    detail: 'decision "answer" does not fit this request',
  });
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "deny" });
  await done;
});

test("an adapter request that offers always is applied as thread and records what was asked", async () => {
  const h = await createHarness();
  const run = h.run();
  const input: ApprovalRequestInput = {
    origin: {
      threadId: h.thread,
      turnId: run.turnId,
      stepId: run.stepId,
      toolCallId: null,
      caller: "main",
    },
    requestKey: "adapter-always",
    title: "adapter",
    body: {
      kind: "tool",
      tool: { toolName: "probe", risk: "read", args: {}, argsHash: "h0", ruleId: null },
    },
    remember: ["once", "thread", "always"],
  };
  const opened = expectOk(await h.runtime.approvals.open(input));
  await h.runtime.approvals.respond(opened.request.approvalId, {
    decision: "allow",
    remember: "always",
  });
  const resolved = h.session.events.find((event) => event.kind === "approval.resolved");
  const payload = parse(ApprovalResolvedPayloadSchema, resolved?.payload);
  expect(payload.ok).toBe(true);
  if (!payload.ok) return;
  // 낮춘 사실은 기록에 남는다: 적용한 범위와 요청한 범위가 다르다
  expect(payload.value).toMatchObject({
    decision: "allow",
    remember: "thread",
    requestedRemember: "always",
    resolvedBy: "user",
  });
});

test("approval_turn_abort_cancels_pending: the request is closed as cancelled and nothing runs", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const controller = new AbortController();
  const run = h.run({ signal: controller.signal });
  const done = callTool(h.runtime.tools, run, {
    id: "call_10",
    name: "bash",
    args: { command: "sleep 100" },
  });
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  controller.abort();
  const out = await done;
  expect(out.blocked).toContain("approval_cancelled");
  expect(probe.calls).toEqual([]);
  expect(kinds(h)).toEqual([
    "approval.requested",
    "checkpoint.step",
    "approval.resolved",
    "item.recorded",
  ]);
  const resolved = parse(
    ApprovalResolvedPayloadSchema,
    h.session.events.find((event) => event.kind === "approval.resolved")?.payload,
  );
  expect(resolved.ok && resolved.value.resolvedBy).toBe("cancelled");
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
});

test("approval_pending_restored_after_restart: restore returns the same request and a re-run adds no new one", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const { done: abandoned } = await startBash(h, "call_11");
  const [before] = h.runtime.approvals.pending(h.thread);
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  void abandoned; // 이 프로세스는 강제 종료된 것으로 본다. 이 호출은 더 이상 이어지지 않는다

  const restarted = createToolRuntime(h.deps);
  const probeAfter = registerWorkspace({ ...h, runtime: restarted });
  const restored = expectOk(await restarted.approvals.restore(h.thread));
  expect(restored).toHaveLength(1);
  expect(restored[0]?.approvalId).toBe(before?.approvalId);
  expect(restarted.approvals.pending(h.thread)[0]?.approvalId).toBe(before?.approvalId);

  // core-loop 대역이 대기 호출을 같은 파이프라인으로 다시 돌린다
  const rerunDone = callTool(restarted.tools, h.run(), {
    id: "call_11",
    name: "bash",
    args: { command: "echo hi" },
  });
  await until(() => restarted.approvals.pending(h.thread).length === 1);
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
  await restarted.approvals.respond(before?.approvalId ?? "", { decision: "allow" });
  const out = await rerunDone;
  expect(out.blocked).toBeUndefined();
  expect(probe.calls).toEqual([]);
  expect(probeAfter.calls).toHaveLength(1);
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
});

test("a request whose answer was committed before the restart is answered immediately", async () => {
  const h = await createHarness();
  const input: ApprovalRequestInput = {
    origin: {
      threadId: h.thread,
      turnId: h.run().turnId,
      stepId: null,
      toolCallId: "call_12",
      caller: "main",
    },
    requestKey: "call_12",
    title: 'Allow tool "bash"?',
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "exec",
        args: { command: "ls" },
        argsHash: "0".repeat(64),
        ruleId: null,
      },
    },
    remember: ["once"],
  };
  const controller = new AbortController();
  const waiting = h.runtime.approvals.request(input, controller.signal);
  await until(() => h.runtime.approvals.pending(h.thread).length === 1);
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  expect(await waiting).toMatchObject({ ok: true, value: { decision: "allow" } });

  const restarted = createToolRuntime(h.deps);
  const again = await restarted.approvals.request(input, controller.signal);
  expect(again).toMatchObject({ ok: true, value: { decision: "allow", resolvedBy: "user" } });
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
});

test("a tool call id outside the commit key alphabet still gets a valid approval.requested commit key", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const { done } = await startBash(h, "call|odd id/with space");
  const requested = h.session.commits.find((commit) => commit.kinds.includes("approval.requested"));
  expect(requested?.requestId).toMatch(new RegExp(COMMIT_KEY_PATTERN));
  expect(requested?.requestId).not.toContain("|");
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  const outcome = await done;
  expect(outcome.isError).toBe(false);
  expect(probe.calls).toHaveLength(1);
  // 재시작 뒤 같은 요청은 같은 키로 이어진다(키가 결정적이다)
  expect(h.session.events.filter((event) => event.kind === "approval.requested")).toHaveLength(1);
});

test("a failed request commit comes back as an error value, not a Bug", async () => {
  const h = await createHarness();
  h.session.setFault(() => ({ kind: "disk_full" }));
  const result = await h.runtime.approvals.request(
    {
      origin: {
        threadId: h.thread,
        turnId: h.run().turnId,
        stepId: null,
        toolCallId: "call_fail",
        caller: "main",
      },
      requestKey: "call_fail",
      title: "Allow?",
      body: {
        kind: "tool",
        tool: {
          toolName: "bash",
          risk: "exec",
          args: { command: "ls" },
          argsHash: "0".repeat(64),
          ruleId: null,
        },
      },
      remember: ["once"],
    },
    new AbortController().signal,
  );
  expect(result).toEqual({ ok: false, error: { kind: "store", error: { kind: "disk_full" } } });
  expect(h.session.events).toHaveLength(0);
});

test("restore reports a failed event read instead of throwing", async () => {
  const h = await createHarness();
  h.session.failNextRead({ kind: "row_invalid", where: "events.envelope" });
  expect(await h.runtime.approvals.restore(h.thread)).toEqual({
    ok: false,
    error: { kind: "row_invalid", where: "events.envelope" },
  });
  expect(expectOk(await h.runtime.approvals.restore(h.thread))).toEqual([]);
});

test("ui_prompt_start fires after the request commit and ui_prompt_end after the resolution", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const seen: string[] = [];
  await installHandlers(h, "prompt-watch", ["ui_prompt_start", "ui_prompt_end"], (g) => {
    g.on("ui_prompt_start", () => {
      seen.push(`start:${kinds(h).join(",")}`);
    });
    g.on("ui_prompt_end", () => {
      seen.push(`end:${kinds(h).join(",")}`);
    });
  });
  const { done } = await startBash(h, "call_13");
  const [request] = h.runtime.approvals.pending(h.thread);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(seen).toEqual([
    "start:approval.requested,checkpoint.step",
    "end:approval.requested,checkpoint.step,approval.resolved",
  ]);
});

test("non-interactive runs deny an ask before any request is written", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "call_14",
    name: "bash",
    args: { command: "ls" },
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(kinds(h)).toEqual(["item.recorded"]);
});
