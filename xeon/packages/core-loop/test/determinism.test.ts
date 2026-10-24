import { expect, test } from "bun:test";
import { createHarness } from "./support/harness.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const script: readonly ScriptedResponse[] = [
  {
    kind: "message",
    content: [
      { type: "text", text: "looking" },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
      { type: "toolCall", id: "c2", name: "denied", arguments: {} },
    ],
    stopReason: "toolUse",
  },
  { kind: "message", content: [{ type: "text", text: "all done" }], stopReason: "stop" },
];

async function runOnce(): Promise<{ readonly durable: string; readonly volatile: string }> {
  const h = await createHarness({
    tools: [{ name: "read" }, { name: "denied", blockReason: "no" }],
    script,
  });
  await h.loop.admit({
    threadId: h.threadId,
    content: "go",
    via: "interactive",
    requestId: "req-1",
  });
  await h.settle();
  return {
    durable: JSON.stringify(h.fake.events()),
    volatile: JSON.stringify(h.fake.volatile()),
  };
}

test("same_tape_same_input_same_injected_values_give_byte_identical_event_lists", async () => {
  const first = await runOnce();
  const second = await runOnce();
  expect(first.durable.length).toBeGreaterThan(500);
  expect(second.durable).toBe(first.durable);
  expect(second.volatile).toBe(first.volatile);
});
