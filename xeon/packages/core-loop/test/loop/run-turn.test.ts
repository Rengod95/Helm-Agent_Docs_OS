import { expect, test } from "bun:test";
import { createHarness } from "../support/harness.ts";
import { countKind, firstOfKind } from "../support/inspect.ts";
import type { ScriptedResponse } from "../support/fake-models.ts";

// L1.loop.plan §5 run-turn 시험. 단계 실패는 값으로 돌아오고, 예기치 않은 예외도 같은 경로로 T6 failed에 이른다.

const callGo: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "go", arguments: {} }],
  stopReason: "toolUse",
};

test("a_failed_step_commit_ends_the_turn_as_failed_without_throwing", async () => {
  const h = await createHarness({ tools: [{ name: "go" }], script: [callGo] });
  h.fake.failBusyFor((key) => key.startsWith("resp:"), 99);
  const admitted = await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  expect(admitted.ok).toBe(true);
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "failed",
    error: "loop_rejected",
  });
  expect(h.tools.executed).toEqual([]);
  expect(
    h.logs.records.some(
      (record) =>
        record.event === "loop.run_rejected" &&
        typeof record.fields["reason"] === "string" &&
        record.fields["reason"].startsWith("commit_failed"),
    ),
  ).toBe(true);
});

test("an_unexpected_exception_in_a_tool_step_is_contained_as_a_failed_turn", async () => {
  const h = await createHarness({
    tools: [
      {
        name: "go",
        run: () => Promise.reject(new Error("tool service broke")),
      },
    ],
    script: [callGo],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "turn.completed")).toBe(1);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "failed",
    error: "loop_rejected",
  });
  expect(h.loop.status(h.threadId)).toBe("idle");
});

test("a_model_that_cannot_be_resolved_fails_the_turn_with_a_logged_reason", async () => {
  const h = await createHarness({ script: [] });
  h.models.failResolve("model_not_found");
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "failed",
    error: "loop_rejected",
  });
  expect(
    h.logs.records.some(
      (record) =>
        record.event === "loop.run_rejected" &&
        typeof record.fields["reason"] === "string" &&
        record.fields["reason"].startsWith("model_unavailable"),
    ),
  ).toBe(true);
});
