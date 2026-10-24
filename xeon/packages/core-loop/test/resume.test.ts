import { expect, test } from "bun:test";
import { createHarness, type Harness } from "./support/harness.ts";
import { contextHash } from "./support/hash.ts";
import { countKind, firstOfKind, kindsOf } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const text = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});
const read = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
});

/** 끊기지 않은 실행에서 두 번째 요청의 컨텍스트 해시 */
async function baselineSecondRequest(): Promise<string> {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read("c1"), text("done")] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  return contextHash(h.models.requests[1]?.messages);
}

async function startAndCrash(
  h: Harness,
  crashKey: (key: string) => boolean,
  mode: "before" | "after",
): Promise<void> {
  if (mode === "before") h.fake.crashBefore(crashKey);
  else h.fake.crashAfter(crashKey);
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
}

test("resume_request_phase_resends_request_after_the_step_end_commit", async () => {
  const baseline = await baselineSecondRequest();
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), text("never used")],
  });
  await startAndCrash(h, (key) => /^step:.*:0:end$/.test(key), "after");
  // 끊긴 시점: T4는 커밋됐고 T6은 없다
  expect(countKind(h.fake.events(h.threadId), "checkpoint.step")).toBe(1);
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(0);

  const h2 = await h.restart({ tools: [{ name: "read" }], script: [text("done")] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "request" });
  await h2.settle();

  expect(h2.models.requests).toHaveLength(1);
  expect(contextHash(h2.models.requests[0]?.messages)).toBe(baseline);
  const events = h2.fake.events(h2.threadId);
  expect(countKind(events, "turn.completed")).toBe(1);
  expect(countKind(events, "thread.resumed")).toBe(1);
  // seq는 무간격이고 같은 turn의 turn.completed는 하나다
  const seqs = events.map((event) => event.seq);
  expect(seqs).toEqual(seqs.map((_seq, index) => (seqs[0] ?? 0) + index));
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "completed",
    stepCount: 2,
  });
});

test("resume_request_phase_resends_the_same_request_when_cut_before_the_response_commit", async () => {
  const baseline = await baselineSecondRequest();
  const h = await createHarness({ tools: [{ name: "read" }], script: [read("c1"), text("lost")] });
  // 두 번째 단계의 응답이 커밋되기 전에 끊긴다(스트리밍 중 끊김)
  await startAndCrash(h, (key) => /^resp:.*:1$/.test(key), "before");
  const before = h.fake.events(h.threadId);
  expect(countKind(before, "step.started")).toBe(2);
  expect(countKind(before, "step.completed")).toBe(1);

  const h2 = await h.restart({ tools: [{ name: "read" }], script: [text("done")] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "request" });
  await h2.settle();

  expect(contextHash(h2.models.requests[0]?.messages)).toBe(baseline);
  const events = h2.fake.events(h2.threadId);
  // 같은 단계를 다시 시작하지 않는다: step.started는 계속 둘이다
  expect(countKind(events, "step.started")).toBe(2);
  expect(countKind(events, "turn.completed")).toBe(1);
});

test("resume_tools_phase_uses_pending_tool_calls", async () => {
  const two: ScriptedResponse = {
    kind: "message",
    content: [
      { type: "toolCall", id: "call_a", name: "read", arguments: {} },
      { type: "toolCall", id: "call_b", name: "bash", arguments: {} },
    ],
    stopReason: "toolUse",
  };
  const tools = [
    { name: "read", executionMode: "sequential" as const },
    { name: "bash", executionMode: "sequential" as const },
  ];
  const h = await createHarness({ tools, script: [two] });
  // 호출 A는 끝났고 B는 의도 커밋 전에 끊긴다
  await startAndCrash(h, (key) => key === "tool:call_b:intent", "before");
  expect(h.tools.executed).toEqual(["call_a"]);

  const h2 = await h.restart({ tools, script: [text("all done")] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "tools" });
  await h2.settle();

  // 결과가 있는 호출은 다시 실행하지 않고 의도 없는 호출만 실행한다
  expect(h2.tools.executed).toEqual(["call_b"]);
  const events = h2.fake.events(h2.threadId);
  expect(countKind(events, "turn.completed")).toBe(1);
  const stepEnds = events.filter((event) => event.kind === "step.completed");
  expect(stepEnds).toHaveLength(2);
  expect(stepEnds[0]?.payload).toMatchObject({ stepIndex: 0, stopReason: "toolUse" });
  // 다음 요청에는 두 도구 결과가 모두 들어 있다
  const next = h2.models.requests[0]?.messages ?? [];
  const resultIds = next.flatMap((message) =>
    message.role === "toolResult" ? [message.toolCallId] : [],
  );
  expect(resultIds).toEqual(["call_a", "call_b"]);
});

test("resume_closes_a_step_cut_after_the_response_commit_by_running_the_step_end", async () => {
  const h = await createHarness({ script: [text("hello")] });
  // 텍스트 응답만 있는 단계가 T3 뒤 T4 전에 끊긴다
  await startAndCrash(h, (key) => /^step:.*:0:end$/.test(key), "before");
  const cut = h.fake.events(h.threadId);
  expect(countKind(cut, "step.completed")).toBe(0);
  expect(countKind(cut, "checkpoint.step")).toBe(0);

  const h2 = await h.restart({ script: [] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "tools" });
  await h2.settle();
  const events = h2.fake.events(h2.threadId);
  expect(kindsOf(events).slice(-3)).toEqual([
    "step.completed",
    "checkpoint.step",
    "turn.completed",
  ]);
  expect(h2.models.requests).toHaveLength(0);
});

test("resume_abort_requested_closes_turn", async () => {
  const h = await createHarness({ script: [{ kind: "stall" }] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.tick();
  // 취소 의도를 커밋하고 T6 직전에 끊긴다
  h.fake.crashBefore((key) => /^turn:.*:end$/.test(key));
  const aborted = await h.loop.interrupt(h.threadId);
  expect(aborted).toBe(true);
  await h.settle();
  const before = h.fake.events(h.threadId);
  expect(countKind(before, "turn.abort_requested")).toBe(1);
  expect(countKind(before, "turn.completed")).toBe(0);

  const h2 = await h.restart({ script: [] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({
    status: "closed",
    reason: "abort_requested",
  });
  await h2.settle();
  const events = h2.fake.events(h2.threadId);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "user",
  });
  expect(h2.models.requests).toHaveLength(0);
});

test("aborted_partial_stream_saved_as_aborted", async () => {
  const h = await createHarness({ script: [{ kind: "stall", partialText: "part" }] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.tick();
  expect(h.loop.status(h.threadId)).toBe("running");
  expect(await h.loop.interrupt(h.threadId)).toBe(true);
  await h.settle();
  const events = h.fake.events(h.threadId);
  const assistantItem = events.find(
    (event) =>
      event.kind === "item.recorded" &&
      typeof event.payload === "object" &&
      event.payload !== null &&
      "item" in event.payload &&
      typeof event.payload.item === "object" &&
      event.payload.item !== null &&
      "kind" in event.payload.item &&
      event.payload.item.kind === "assistant",
  );
  expect(assistantItem?.payload).toMatchObject({
    item: { status: "interrupted", message: { stopReason: "aborted" } },
  });
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "user",
  });
  expect(h.loop.status(h.threadId)).toBe("idle");
});

test("resume_with_nothing_open_reports_nothing", async () => {
  const h = await createHarness({ script: [text("ok")] });
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const resumed = await h.loop.resume(h.threadId);
  expect(resumed.ok && resumed.value).toEqual({ status: "nothing" });
});

test("a_thread_over_the_resume_limit_is_not_a_candidate_and_new_input_closes_the_stale_turn", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), text("lost")],
    maxResumeAttempts: 0,
  });
  await startAndCrash(h, (key) => /^step:.*:0:end$/.test(key), "after");
  const h2 = await h.restart({ tools: [{ name: "read" }], script: [text("fresh answer")] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toEqual({ status: "nothing" });

  const admitted = await h2.loop.admit({
    threadId: h2.threadId,
    content: "new",
    via: "interactive",
  });
  expect(admitted.ok && admitted.value.status).toBe("started");
  await h2.settle();
  const completions = h2.fake
    .events(h2.threadId)
    .filter((event) => event.kind === "turn.completed")
    .map((event) => event.payload);
  expect(completions).toHaveLength(2);
  expect(completions[0]).toMatchObject({ status: "interrupted" });
  expect(completions[1]).toMatchObject({ status: "completed" });
});

test("new_input_after_a_crash_closes_the_open_effects_of_the_stale_turn_with_synthesized_results", async () => {
  const tools = [{ name: "read" }];
  const h = await createHarness({ tools, script: [read("c1")] });
  // 실행은 시작됐지만 결과 커밋 전에 끊긴다(결과 불명 효과)
  await startAndCrash(h, (key) => key === "tool:c1:result", "before");
  expect(countKind(h.fake.events(h.threadId), "effect.exec")).toBe(1);
  expect(countKind(h.fake.events(h.threadId), "effect.result")).toBe(0);

  // 다른 프로세스가 열었고 resume 없이 새 입력이 온다: 열린 turn을 interrupted로 닫으면서 효과도 닫아야 한다
  const h2 = await h.restart({ tools, script: [text("fresh answer")] });
  const admitted = await h2.loop.admit({
    threadId: h2.threadId,
    content: "new",
    via: "interactive",
  });
  expect(admitted.ok && admitted.value.status).toBe("started");
  await h2.settle();

  const events = h2.fake.events(h2.threadId);
  const results = events.filter((event) => event.kind === "effect.result");
  expect(results).toHaveLength(1);
  expect(results[0]?.payload).toMatchObject({ synthesized: true, status: "interrupted" });
  const toolResult = events.find(
    (event) =>
      event.kind === "item.recorded" && JSON.stringify(event.payload).includes('"toolResult"'),
  );
  expect(JSON.stringify(toolResult?.payload)).toContain("may have taken effect");
  expect(h2.tools.executed).toEqual([]);
  expect(h2.tools.reran).toEqual([]);
  const completions = events.filter((event) => event.kind === "turn.completed");
  expect(completions.map((event) => event.payload)).toMatchObject([
    { status: "interrupted" },
    { status: "completed" },
  ]);
});

test("a_resubmitted_request_after_the_input_was_queued_but_before_the_turn_started_starts_the_turn", async () => {
  const h = await createHarness({ script: [text("lost")] });
  // 입력 수락(C1)은 커밋됐고 turn 시작(T1) 직전에 끊긴다
  h.fake.crashBefore((key) => /^turn:.*:start$/.test(key));
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive", requestId: "r1" });
  await h.settle();
  expect(countKind(h.fake.events(h.threadId), "input.queued")).toBe(1);
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(0);

  // 같은 requestId의 재제출은 duplicate(turn 없음)가 아니라 큐에 있는 입력으로 turn을 시작한다
  const h2 = await h.restart({ script: [text("answer")] });
  const again = await h2.loop.admit({
    threadId: h2.threadId,
    content: "go",
    via: "interactive",
    requestId: "r1",
  });
  expect(again.ok && again.value.status).toBe("started");
  await h2.settle();
  expect(countKind(h2.fake.events(h2.threadId), "input.queued")).toBe(1);
  expect(countKind(h2.fake.events(h2.threadId), "turn.started")).toBe(1);

  // turn이 시작된 뒤의 재제출은 그 turn을 돌려준다
  const third = await h2.loop.admit({
    threadId: h2.threadId,
    content: "go",
    via: "interactive",
    requestId: "r1",
  });
  expect(third.ok && third.value.status).toBe("duplicate");
  if (third.ok && third.value.status === "duplicate") {
    expect(third.value.turnId).not.toBeNull();
  }
});

test("a_busy_store_is_retried_with_the_same_commit_key", async () => {
  const h = await createHarness({ script: [text("ok")] });
  const attempts: string[] = [];
  h.fake.failBusyFor((key) => {
    if (key.startsWith("resp:")) attempts.push(key);
    return key.startsWith("resp:");
  }, 2);
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  // 응답 커밋은 busy를 두 번 만나고 같은 키로 세 번째에 성공한다(TX-05)
  expect(attempts).toHaveLength(2);
  expect(new Set(attempts).size).toBe(1);
  expect(h.fake.commitKeys(h.threadId).filter((key) => key === attempts[0])).toHaveLength(3);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
});

test("a_commit_that_stays_busy_fails_the_turn_without_executing_tools", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read("c1")] });
  h.fake.failBusyFor((key) => key.startsWith("resp:"), 99);
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(h.tools.executed).toEqual([]);
  expect(h.logs.records.some((record) => record.event === "loop.run_rejected")).toBe(true);
});

test("resume_reruns_a_safe_effect_whose_result_was_not_recorded", async () => {
  const tools = [{ name: "read", replay: "safe" as const }];
  const h = await createHarness({ tools, script: [read("c1")] });
  // 실행은 시작됐지만 결과 커밋 전에 끊긴다
  await startAndCrash(h, (key) => key === "tool:c1:result", "before");
  expect(countKind(h.fake.events(h.threadId), "effect.exec")).toBe(1);
  expect(countKind(h.fake.events(h.threadId), "effect.result")).toBe(0);

  const h2 = await h.restart({ tools, script: [text("after rerun")] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "tools" });
  await h2.settle();
  expect(h2.tools.reran).toEqual(["c1"]);
  expect(countKind(h2.fake.events(h2.threadId), "turn.completed")).toBe(1);
  expect(h2.models.requests).toHaveLength(1);
});

test("resume_closes_an_unsafe_effect_with_an_outcome_unknown_result_and_does_not_run_it_again", async () => {
  const tools = [{ name: "read" }];
  const h = await createHarness({ tools, script: [read("c1")] });
  await startAndCrash(h, (key) => key === "tool:c1:result", "before");

  const h2 = await h.restart({ tools, script: [text("noted")] });
  await h2.loop.resume(h2.threadId);
  await h2.settle();
  expect(h2.tools.executed).toEqual([]);
  expect(h2.tools.reran).toEqual([]);
  const next = h2.models.requests[0]?.messages ?? [];
  const result = next.find((message) => message.role === "toolResult");
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toContain("may have taken effect");
  expect(countKind(h2.fake.events(h2.threadId), "turn.completed")).toBe(1);
});

test("an_interrupt_during_a_tool_closes_the_calls_that_never_ran", async () => {
  const two: ScriptedResponse = {
    kind: "message",
    content: [
      { type: "toolCall", id: "c1", name: "read", arguments: {} },
      { type: "toolCall", id: "c2", name: "bash", arguments: {} },
    ],
    stopReason: "toolUse",
  };
  const state: { h: Harness | null } = { h: null };
  const h = await createHarness({
    tools: [
      {
        name: "read",
        executionMode: "sequential",
        run: async () => {
          await state.h?.loop.interrupt(state.h.threadId);
          return { text: "A" };
        },
      },
      { name: "bash", executionMode: "sequential" },
    ],
    script: [two],
  });
  state.h = h;
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  // 두 번째 호출은 실행되지 않았고 루프가 단계 끝 커밋 전에 닫는다
  expect(h.tools.executed).toEqual(["c1"]);
  expect(h.tools.closed).toEqual(["c2"]);
  const events = h.fake.events(h.threadId);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "user",
  });
  const keys = h.fake.commitKeys(h.threadId);
  expect(keys.filter((key) => key === "tool:c2:result").length).toBeGreaterThan(0);
});

// L1A.4 (LP12): 승인 대기 중 끊긴 turn은 await_input으로 재개하고, 응답이 기록되면 같은 호출이 주 경로로 실행된다
test("await_input_resumes_after_approval_response", async () => {
  const bash: ScriptedResponse = {
    kind: "message",
    content: [{ type: "toolCall", id: "call_a", name: "bash", arguments: {} }],
    stopReason: "toolUse",
  };
  const tools = [{ name: "bash", requiresApproval: true }];
  const h = await createHarness({ tools, script: [bash], withApprovals: true });
  // 승인 요청과 대기 체크포인트가 커밋된 직후 끊긴다
  h.fake.crashAfter((key) => key === "approval:call_a:request");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const before = h.fake.events(h.threadId);
  expect(countKind(before, "approval.requested")).toBe(1);
  expect(countKind(before, "effect.intent")).toBe(0);
  const waiting = before.findLast((event) => event.kind === "checkpoint.step");
  expect(waiting?.payload).toMatchObject({
    next: "await_input",
    pendingToolCalls: [{ toolCallId: "call_a", effectId: null, waiting: "approval" }],
  });

  const h2 = await h.restart({ tools, script: [text("all done")], withApprovals: true });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "await_input" });
  await h2.tick();
  // 승인 대기를 되살렸고 응답이 오기 전에는 모델도 도구도 부르지 않는다
  expect(h2.restored).toEqual([h2.threadId]);
  expect(h2.models.requests).toHaveLength(0);
  expect(h2.tools.executed).toEqual([]);
  expect(h2.tools.waitingApproval).toEqual(["call_a"]);
  expect(countKind(h2.fake.events(h2.threadId), "approval.requested")).toBe(1);

  // 응답이 기록되면 같은 호출이 prepare·execute로 실행되고 단계가 마감된다
  expect(await h2.tools.respondApproval("call_a")).toBe(true);
  await h2.settle();
  expect(h2.tools.executed).toEqual(["call_a"]);
  const events = h2.fake.events(h2.threadId);
  expect(countKind(events, "approval.requested")).toBe(1);
  expect(countKind(events, "approval.resolved")).toBe(1);
  expect(countKind(events, "effect.result")).toBe(1);
  expect(countKind(events, "turn.completed")).toBe(1);
  expect(h2.models.requests).toHaveLength(1);
  expect(events.find((event) => event.kind === "step.completed")?.payload).toMatchObject({
    stepIndex: 0,
    stopReason: "toolUse",
  });
});

test("a turn without a pending approval does not call restore on resume", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), text("never used")],
    withApprovals: true,
  });
  await startAndCrash(h, (key) => /^step:.*:0:end$/.test(key), "after");
  const h2 = await h.restart({
    tools: [{ name: "read" }],
    script: [text("done")],
    withApprovals: true,
  });
  await h2.loop.resume(h2.threadId);
  await h2.settle();
  expect(h2.restored).toEqual([]);
});

test("closing a stale turn cancels the approval requests it left behind", async () => {
  const bash: ScriptedResponse = {
    kind: "message",
    content: [{ type: "toolCall", id: "call_a", name: "bash", arguments: {} }],
    stopReason: "toolUse",
  };
  const tools = [{ name: "bash", requiresApproval: true }];
  const h = await createHarness({ tools, script: [bash], withApprovals: true });
  h.fake.crashAfter((key) => key === "approval:call_a:request");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const requested = h.fake.events(h.threadId).find((event) => event.kind === "approval.requested");

  // 재개 없이 새 입력이 온다: 열린 turn을 닫으면서 그 turn의 미해결 승인 요청도 취소한다
  const h2 = await h.restart({ tools, script: [text("fresh")], withApprovals: true });
  const admitted = await h2.loop.admit({
    threadId: h2.threadId,
    content: "new",
    via: "interactive",
  });
  expect(admitted.ok && admitted.value.status).toBe("started");
  await h2.settle();
  expect(h2.restored).toEqual([h2.threadId]);
  expect(h2.cancelledApprovals).toEqual([requested?.id ?? "missing"]);
  expect(h2.tools.executed).toEqual([]);
});
