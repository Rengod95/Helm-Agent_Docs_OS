import { expect, test } from "bun:test";
import { countKind, firstOfKind, kindsOf } from "./support/inspect.ts";
import { createHarness } from "./support/harness.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// M2 마감 G2-01(감사 L1-01). 루프가 컴팩션 두 길을 `xeon.context`에 잇는다: 요청 전 임계 검사와 오버플로우 복구.

const done: ScriptedResponse = {
  kind: "message",
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
};
const read: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
  stopReason: "toolUse",
};
const overflow: ScriptedResponse = {
  kind: "error",
  message: "context_overflow: prompt is too long",
};

test("a_full_window_is_compacted_before_the_request_and_the_request_is_built_on_the_new_leaf", async () => {
  const h = await createHarness({ script: [done] });
  h.context.compaction.shouldQueue.push(true);
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  expect(h.context.compaction.order).toEqual(["should", "compact", "assemble"]);
  expect(h.context.compaction.compactCalls).toMatchObject([
    {
      reason: "threshold",
      willRetry: false,
      contextWindow: 100_000,
      binding: { role: "main", provider: "fake", modelId: "fake-1" },
    },
  ]);
  const compacted = firstOfKind(h.fake.events(h.threadId), "thread.compacted");
  expect(compacted).toBeDefined();
  // 조립은 컴팩션이 커밋한 이벤트까지 읽은 leaf로 한다
  expect(String(h.context.assembled[0]?.leaf)).toBe(String(compacted?.id));
  expect(h.models.requests).toHaveLength(1);
  expect(countKind(h.fake.events(h.threadId), "turn.completed")).toBe(1);
});

test("a_window_below_the_threshold_is_not_compacted_and_every_step_is_checked", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(h.context.compaction.compactCalls).toEqual([]);
  expect(h.context.compaction.order.filter((name) => name === "should")).toHaveLength(2);
  expect(kindsOf(h.fake.events(h.threadId))).not.toContain("thread.compacted");
});

test("a_failed_compaction_does_not_stop_the_turn_and_is_not_retried_on_later_steps", async () => {
  const h = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  h.context.compaction.compactMode = "fail";
  h.context.compaction.shouldQueue.push(true, true);
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(h.context.compaction.compactCalls).toHaveLength(1);
  // 둘째 단계는 막혀서 검사도 하지 않는다
  expect(h.context.compaction.order.filter((name) => name === "should")).toHaveLength(1);
  expect(h.models.requests).toHaveLength(2);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
  });
  expect(h.logs.records.some((r) => r.event === "loop.compaction_failed")).toBe(true);
});

test("an_overflow_is_compacted_once_and_the_same_step_is_requested_again", async () => {
  const h = await createHarness({ script: [overflow, done] });
  h.context.compaction.overflowQueue.push("retry");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);

  expect(h.models.requests).toHaveLength(2);
  // 같은 단계다: 단계 시작은 한 번이고 두 요청의 stepId가 같다
  expect(countKind(events, "step.started")).toBe(1);
  expect(h.models.requests[1]?.stepId).toBe(h.models.requests[0]?.stepId ?? null);
  expect(h.context.compaction.overflowCalls).toEqual([
    {
      stepId: h.models.requests[0]?.stepId ?? "",
      errorMessage: "context_overflow: prompt is too long",
    },
  ]);
  // 실패한 시도는 기록되지 않고 성공한 응답만 남는다
  const assistants = events.filter(
    (event) =>
      event.kind === "item.recorded" && JSON.stringify(event.payload).includes('"assistant"'),
  );
  expect(assistants).toHaveLength(1);
  expect(JSON.stringify(assistants[0]?.payload)).not.toContain("context_overflow");
  expect(h.context.assembled).toHaveLength(2);
  expect(String(h.context.assembled[1]?.leaf)).toBe(
    String(firstOfKind(events, "thread.compacted")?.id),
  );
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({ status: "completed" });
});

test("a_second_overflow_in_the_same_step_ends_the_turn_with_the_error", async () => {
  const h = await createHarness({ script: [overflow, overflow] });
  h.context.compaction.overflowQueue.push("retry");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(h.models.requests).toHaveLength(2);
  // 복구는 단계당 한 번만 시도한다
  expect(h.context.compaction.overflowCalls).toHaveLength(1);
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "failed",
  });
});

test("an_overflow_that_cannot_be_recovered_commits_the_error_response_as_before", async () => {
  const h = await createHarness({ script: [overflow] });
  h.context.compaction.overflowQueue.push({ action: "fail", reason: "compaction_failed" });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(h.models.requests).toHaveLength(1);
  expect(JSON.stringify(h.fake.events(h.threadId))).toContain("context_overflow");
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "failed",
  });
  expect(
    h.logs.records.find((r) => r.event === "loop.overflow_not_recovered")?.fields,
  ).toMatchObject({
    reason: "compaction_failed",
  });
});

test("an_error_that_is_not_an_overflow_never_reaches_overflow_recovery", async () => {
  const h = await createHarness({ script: [{ kind: "error", message: "rate limited" }] });
  h.context.compaction.overflowQueue.push("retry");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(h.context.compaction.overflowCalls).toEqual([]);
  expect(h.models.requests).toHaveLength(1);
});
