import { expect, test } from "bun:test";
import { canContinue, stepLimitReached } from "../src/budget.ts";
import { createHarness } from "./support/harness.ts";
import { countKind, firstOfKind } from "./support/inspect.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const read = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
});
const done = (value = "done"): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

test("default_has_no_step_cap", async () => {
  const steps = 60;
  const script = [...Array.from({ length: steps }, (_value, index) => read(`c${index}`)), done()];
  const h = await createHarness({ tools: [{ name: "read" }], script });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(h.tools.executed).toHaveLength(steps);
  expect(countKind(events, "step.completed")).toBe(steps + 1);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "completed",
    stepCount: steps + 1,
  });
});

test("max_steps_ends_turn_as_interrupted", async () => {
  const script = [...Array.from({ length: 6 }, (_value, index) => read(`c${index}`)), done()];
  const h = await createHarness({ tools: [{ name: "read" }], script, maxSteps: 3 });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "step.completed")).toBe(3);
  expect(h.models.requests).toHaveLength(3);
  expect(firstOfKind(events, "turn.completed")?.payload).toMatchObject({
    status: "interrupted",
    error: "step_limit",
    stepCount: 3,
  });
  const checkpoints = events.filter((event) => event.kind === "checkpoint.step");
  expect(checkpoints.at(-1)?.payload).toMatchObject({ stepIndex: 2, next: "turn_end" });
});

test("a_turn_that_settles_on_the_last_allowed_step_is_completed_not_interrupted", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), done()],
    maxSteps: 2,
  });
  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  expect(firstOfKind(h.fake.events(h.threadId), "turn.completed")?.payload).toMatchObject({
    status: "completed",
    error: null,
  });
});

test("step_budget_helpers", () => {
  expect(stepLimitReached({ maxSteps: 0 }, 1000)).toBe(false);
  expect(stepLimitReached({ maxSteps: 3 }, 2)).toBe(false);
  expect(stepLimitReached({ maxSteps: 3 }, 3)).toBe(true);
  const open = {
    hardStop: false,
    abortRequested: false,
    stepLimit: false,
    externalStop: false,
    stopping: false,
    gateExhausted: false,
  };
  expect(canContinue(open)).toBe(true);
  expect(canContinue({ ...open, hardStop: true })).toBe(false);
  expect(canContinue({ ...open, abortRequested: true })).toBe(false);
  expect(canContinue({ ...open, stepLimit: true })).toBe(false);
  expect(canContinue({ ...open, externalStop: true })).toBe(false);
  expect(canContinue({ ...open, stopping: true })).toBe(false);
  expect(canContinue({ ...open, gateExhausted: true })).toBe(false);
});
