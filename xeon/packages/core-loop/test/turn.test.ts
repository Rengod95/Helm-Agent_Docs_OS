import { expect, test } from "bun:test";
import { countKind, deltaTextOf, firstOfKind, kindsOf, payloadField } from "./support/inspect.ts";
import { createHarness, recordedCallId } from "./support/harness.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const text = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

const callRead = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } }],
  stopReason: "toolUse",
});

test("a_text_turn_commits_each_point_with_its_commit_key", async () => {
  const h = await createHarness({ script: [text("hello")] });
  const admitted = await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  expect(admitted.ok && admitted.value.status).toBe("started");
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(kindsOf(events)).toEqual([
    "thread.started",
    "input.queued",
    "item.recorded", // T1: 입력 item
    "input.placed",
    "turn.started",
    "step.started", // T2
    "item.recorded", // T3: 접두 system item
    "part.recorded",
    "item.recorded", // T3: assistant
    "step.completed", // T4
    "checkpoint.step",
    "turn.completed", // T6
  ]);
  const turnId = events.find((event) => event.kind === "turn.started")?.turnId;
  expect(turnId).toBeDefined();
  const keys = h.fake.commitKeys(h.threadId);
  expect(keys.slice(2)).toEqual([
    `turn:${turnId}:start`,
    `turn:${turnId}:start`,
    `turn:${turnId}:start`,
    `step:${turnId}:0:start`,
    `resp:${turnId}:0`,
    `resp:${turnId}:0`,
    `resp:${turnId}:0`,
    `step:${turnId}:0:end`,
    `step:${turnId}:0:end`,
    `turn:${turnId}:end`,
  ]);
  const completed = firstOfKind(events, "turn.completed");
  expect(completed?.payload).toMatchObject({ status: "completed", stepCount: 1, error: null });
});

test("turn_start_records_input_before_turn_started", async () => {
  const h = await createHarness({ script: [text("ok")] });
  await h.loop.admit({ threadId: h.threadId, content: "hello", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  const input = events.find((event) => event.kind === "item.recorded");
  const placed = firstOfKind(events, "input.placed");
  const started = firstOfKind(events, "turn.started");
  expect(input?.seq).toBeLessThan(started?.seq ?? 0);
  expect(placed?.seq).toBeLessThan(started?.seq ?? 0);
  expect(started?.payload).toMatchObject({ requestId: expect.any(String), scopeId: null });
});

test("the_step_end_commit_carries_step_completed_and_the_checkpoint", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [callRead("c1"), text("done")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  const checkpoints = events.filter((event) => event.kind === "checkpoint.step");
  expect(checkpoints).toHaveLength(2);
  expect(checkpoints[0]?.payload).toMatchObject({
    stepIndex: 0,
    next: "request",
    pendingToolCalls: [],
  });
  expect(checkpoints[1]?.payload).toMatchObject({ stepIndex: 1, next: "turn_end" });
  const keys = h.fake.commitKeys(h.threadId);
  // step.completed와 checkpoint.step은 같은 커밋 키(한 트랜잭션)다
  const firstEnd = events.findIndex((event) => event.kind === "step.completed");
  expect(keys[firstEnd]).toBe(keys[firstEnd + 1]);
  expect(countKind(events, "turn.completed")).toBe(1);
});

test("a_tool_step_records_intent_exec_result_inside_the_step", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [callRead("c1"), text("done")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const kinds = kindsOf(h.fake.events(h.threadId));
  const slice = kinds.slice(kinds.indexOf("effect.intent"), kinds.indexOf("step.completed"));
  expect(slice).toEqual(["effect.intent", "effect.exec", "effect.result", "item.recorded"]);
  const completed = firstOfKind(h.fake.events(h.threadId), "step.completed");
  expect(completed?.payload).toMatchObject({
    stepIndex: 0,
    status: "completed",
    stopReason: "toolUse",
  });
  const payload = completed?.payload;
  const resultIds =
    typeof payload === "object" && payload !== null && "toolResultItemIds" in payload
      ? payload.toolResultItemIds
      : [];
  expect(Array.isArray(resultIds) && resultIds.length).toBe(1);
});

test("volatile_after_seq_not_behind_durable", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [callRead("c1"), text("answer")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const volatile = h.fake.volatile();
  expect(volatile.length).toBeGreaterThan(0);
  const events = h.fake.events(h.threadId);
  const stepStartSeq = new Map(
    events
      .filter((event) => event.kind === "step.started")
      .map((event) => [event.stepId, event.seq]),
  );
  for (const event of volatile) {
    if (event.stepId === null) continue;
    expect(event.afterSeq).toBeGreaterThanOrEqual(stepStartSeq.get(event.stepId) ?? 0);
  }
  // n은 turn마다 0부터 1씩 늘고, 내구 kind는 휘발로 나가지 않는다
  expect(volatile.map((event) => event.n)).toEqual(volatile.map((_event, index) => index));
  expect(new Set(volatile.map((event) => event.durable))).toEqual(new Set([false]));
  const kinds = new Set(volatile.map((event) => event.kind));
  expect(kinds.has("step.started")).toBe(false);
  expect(kinds.has("item.updated")).toBe(true);
  expect(volatile.map(deltaTextOf).join("")).toContain("answer");
});

test("a_steer_input_is_placed_at_the_step_end_and_sent_in_the_next_request", async () => {
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: async () => {
          // 도구가 도는 동안 사용자가 steer를 넣는다
          await h.loop.admit({
            threadId: h.threadId,
            content: "actually use b.txt",
            via: "interactive",
            whenBusy: "steer",
          });
          return { text: "A" };
        },
      },
    ],
    script: [callRead("c1"), text("done")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  const kinds = kindsOf(events);
  const stepEnd = kinds.indexOf("step.completed");
  // 같은 커밋 안: step.completed → 배치 item.recorded → input.placed → checkpoint.step
  expect(kinds.slice(stepEnd, stepEnd + 4)).toEqual([
    "step.completed",
    "item.recorded",
    "input.placed",
    "checkpoint.step",
  ]);
  const second = h.models.requests[1];
  const last = second?.messages.at(-1);
  expect(last).toMatchObject({ role: "user", content: "actually use b.txt" });
  expect(countKind(events, "turn.started")).toBe(1);
});

test("a_followUp_input_starts_a_new_turn_after_the_current_one_settles", async () => {
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: async () => {
          await h.loop.admit({
            threadId: h.threadId,
            content: "next question",
            via: "interactive",
          });
          return { text: "A" };
        },
      },
    ],
    script: [callRead("c1"), text("done one"), text("done two")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "turn.started")).toBe(2);
  expect(countKind(events, "turn.completed")).toBe(2);
  const statuses = events.flatMap((event) =>
    event.kind === "turn.completed" ? [payloadField(event, "status")] : [],
  );
  expect(statuses).toEqual(["completed", "completed"]);
  expect(h.models.remaining()).toBe(0);
});

test("admit_duplicate_request_id_does_not_queue_twice", async () => {
  const h = await createHarness({ script: [text("one")] });
  const first = await h.loop.admit({
    threadId: h.threadId,
    content: "x",
    via: "rpc",
    requestId: "req-1",
  });
  const again = await h.loop.admit({
    threadId: h.threadId,
    content: "x",
    via: "rpc",
    requestId: "req-1",
  });
  await h.settle();
  expect(first.ok && first.value.status).toBe("started");
  expect(again.ok && again.value.status).toBe("duplicate");
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(1);
});

test("admit_rejects_an_invalid_request_id", async () => {
  const h = await createHarness();
  const result = await h.loop.admit({
    threadId: h.threadId,
    content: "x",
    via: "rpc",
    requestId: "x".repeat(65),
  });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error.kind).toBe("input_invalid");
});

test("thread_status_reports_idle_after_the_turn_settles", async () => {
  const h = await createHarness({ script: [text("ok")] });
  expect(h.loop.status(h.threadId)).toBe("idle");
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  expect(h.loop.status(h.threadId)).toBe("idle");
  expect(h.loop.threadStatus(h.threadId)).toMatchObject({ runningTurnId: null, phase: "idle" });
});

test("a_blocked_call_gets_a_toolResult_item_without_effect_events", async () => {
  const h = await createHarness({
    tools: [{ name: "read", blockReason: "denied by policy" }],
    script: [callRead("c1"), text("ok")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "effect.intent")).toBe(0);
  const keys = h.fake.commitKeys(h.threadId);
  const resultIndex = keys.indexOf(`tool:${recordedCallId(h, "c1")}:result`);
  expect(resultIndex).toBeGreaterThan(-1);
  expect(events[resultIndex]?.kind).toBe("item.recorded");
  expect(events[resultIndex]?.payload).toMatchObject({
    item: { kind: "toolResult", effectId: null, message: { isError: true } },
  });
});

test("a_provider_error_fails_the_turn", async () => {
  const h = await createHarness({ script: [{ kind: "error", message: "boom" }] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const completed = firstOfKind(h.fake.events(h.threadId), "turn.completed");
  expect(completed?.payload).toMatchObject({ status: "failed", error: "boom" });
});

test("resume_returns_a_read_failure_instead_of_throwing", async () => {
  const h = await createHarness({ script: [text("hello")] });
  h.fake.failNextRead({ kind: "busy" });
  const resumed = await h.loop.resume(h.threadId);
  expect(resumed).toEqual({ ok: false, error: { kind: "busy" } });
  // 같은 요청을 다시 하면 읽을 수 있고 열린 turn이 없으니 할 일이 없다
  const again = await h.loop.resume(h.threadId);
  expect(again).toEqual({ ok: true, value: { status: "nothing" } });
});

test("a_failed_open_turn_read_keeps_the_input_queued_and_logs_the_start_failure", async () => {
  const h = await createHarness({ script: [text("hello")] });
  h.fake.failNextRead({ kind: "io", code: "SQLITE_IOERR" });
  const admitted = await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  // 입력은 접수됐고 시작만 미뤄진다
  expect(admitted.ok && admitted.value.status).toBe("queued");
  expect(h.logs.records.some((record) => record.event === "loop.start_failed")).toBe(true);
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBe(0);
  // 다음 입력이 오면 큐에 남은 입력부터 시작한다
  await h.loop.admit({ threadId: h.threadId, content: "again", via: "interactive" });
  await h.settle();
  expect(countKind(h.fake.events(h.threadId), "turn.started")).toBeGreaterThan(0);
});

// L1.loop.spec §4.2: 한 단계는 커밋 3개(S1 step.started, C3 응답, C5 단계 끝)와 도구 호출마다 3개(E1 의도, E2 실행 표시, E3 결과)다.
// 진짜 core-loop를 대역 저장소 위에서 돌리고 커밋 키로 센다. 같은 커밋의 이벤트는 같은 키를 쓴다
function callMany(count: number): ScriptedResponse {
  return {
    kind: "message",
    content: Array.from({ length: count }, (_unused, index) => ({
      type: "toolCall" as const,
      id: `c${index + 1}`,
      name: "read",
      arguments: { path: `${index + 1}.txt` },
    })),
    stopReason: "toolUse",
  };
}

async function expectStepCommits(count: number): Promise<void> {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: count === 0 ? [text("done")] : [callMany(count), text("done")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const turnId = firstOfKind(h.fake.events(h.threadId), "turn.started")?.turnId;
  expect(turnId).toBeDefined();
  const commits = new Set(h.fake.commitKeys(h.threadId));
  const ofStep = (index: number): string[] =>
    [...commits].filter(
      (key) =>
        key.startsWith(`step:${turnId}:${index}:`) ||
        key === `resp:${turnId}:${index}` ||
        (index === 0 && key.startsWith("tool:")),
    );
  const first = ofStep(0);
  // 단계 0: S1 + C3 + C5, 그리고 도구 호출 n개의 E1·E2·E3
  expect({ count, commits: first.length }).toEqual({ count, commits: 3 + 3 * count });
  expect(first.filter((key) => key.startsWith("tool:"))).toHaveLength(3 * count);
  if (count > 0) {
    // 도구 결과를 받은 두 번째 단계에는 도구 호출이 없으니 커밋 3개다
    expect(ofStep(1)).toHaveLength(3);
  }
  // 단계 커밋은 위 둘뿐이다. 그 밖의 커밋은 입력 접수, thread 시작, T1, T6이다
  const stepKeys = [...commits].filter((key) => key.startsWith("step:") || key.startsWith("resp:"));
  expect(stepKeys.toSorted()).toEqual(
    [...ofStep(0), ...ofStep(1)].filter((key) => !key.startsWith("tool:")).toSorted(),
  );
}

test("each_step_commits_three_plus_three_per_tool_call", async () => {
  await Promise.all([0, 1, 2, 3].map(expectStepCommits));
});
