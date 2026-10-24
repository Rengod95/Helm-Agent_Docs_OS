import { expect, test } from "bun:test";
import { createHarness } from "./support/harness.ts";
import { countKind, kindsOf } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const read: ScriptedResponse = {
  kind: "message",
  content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
  stopReason: "toolUse",
};
const done: ScriptedResponse = {
  kind: "message",
  content: [{ type: "text", text: "done" }],
  stopReason: "stop",
};

test("step_commit_includes_checkpoint_same_transaction", async () => {
  // 커밋 전 장애: step.completed와 checkpoint.step 둘 다 없다
  const before = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  before.fake.crashBefore((key) => /^step:.*:0:end$/.test(key));
  await before.loop.admit({ threadId: before.threadId, content: "go", via: "interactive" });
  await before.settle();
  const cut = before.fake.events(before.threadId);
  expect(countKind(cut, "step.completed")).toBe(0);
  expect(countKind(cut, "checkpoint.step")).toBe(0);
  expect(countKind(cut, "item.recorded")).toBeGreaterThan(0);

  // after_commit 장애: 둘 다 있고 같은 커밋 키다
  const after = await createHarness({ tools: [{ name: "read" }], script: [read, done] });
  after.fake.crashAfter((key) => /^step:.*:0:end$/.test(key));
  await after.loop.admit({ threadId: after.threadId, content: "go", via: "interactive" });
  await after.settle();
  const kept = after.fake.events(after.threadId);
  const keys = after.fake.commitKeys(after.threadId);
  const index = kindsOf(kept).indexOf("step.completed");
  expect(index).toBeGreaterThan(-1);
  expect(kept[index + 1]?.kind).toBe("checkpoint.step");
  expect(keys[index]).toBe(keys[index + 1]);
});

test("a_cut_between_input_queued_and_turn_start_leaves_the_input_queued", async () => {
  const h = await createHarness({ script: [done] });
  h.fake.crashBefore((key) => /^turn:.*:start$/.test(key));
  await h.loop.admit({ threadId: h.threadId, content: "first", via: "interactive" });
  await h.settle();
  const cut = h.fake.events(h.threadId);
  expect(countKind(cut, "input.queued")).toBe(1);
  expect(countKind(cut, "turn.started")).toBe(0);

  // 다음 시작에서 queued 입력이 배치된다
  const h2 = await h.restart({ script: [done] });
  const admitted = await h2.loop.admit({
    threadId: h2.threadId,
    content: "second",
    via: "interactive",
  });
  expect(admitted.ok).toBe(true);
  await h2.settle();
  const events = h2.fake.events(h2.threadId);
  expect(countKind(events, "turn.started")).toBeGreaterThanOrEqual(1);
  expect(countKind(events, "input.placed")).toBeGreaterThanOrEqual(1);
});

test("stop_at_safe_boundary_leaves_turn_open", async () => {
  const gate = Promise.withResolvers<void>();
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: async () => {
          await gate.promise;
          return { text: "A" };
        },
      },
    ],
    script: [read, done],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.tick();
  expect(h.loop.status(h.threadId)).toBe("running");
  const stopping = h.loop.stopAtSafeBoundary(5_000);
  gate.resolve();
  expect(await stopping).toBe(true);
  const events = h.fake.events(h.threadId);
  // T4까지 커밋하고 turn.completed는 쓰지 않는다
  expect(countKind(events, "step.completed")).toBe(1);
  expect(countKind(events, "turn.completed")).toBe(0);
  expect(h.models.requests).toHaveLength(1);
  expect(h.loop.status(h.threadId)).toBe("idle");

  // 재개 후보로 남는다
  const h2 = await h.restart({ tools: [{ name: "read" }], script: [done] });
  const resumed = await h2.loop.resume(h2.threadId);
  expect(resumed.ok && resumed.value).toMatchObject({ status: "resumed", from: "request" });
  await h2.settle();
  expect(countKind(h2.fake.events(h2.threadId), "turn.completed")).toBe(1);
});

test("stop_at_safe_boundary_reports_false_when_the_deadline_passes", async () => {
  const h = await createHarness({
    tools: [{ name: "read", run: () => new Promise(() => {}) }],
    script: [read, done],
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.tick();
  const stopping = h.loop.stopAtSafeBoundary(1_000);
  await h.clock.advance(1_000);
  expect(await stopping).toBe(false);
});
