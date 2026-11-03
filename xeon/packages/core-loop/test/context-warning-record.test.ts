import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { StepCompletedPayloadSchema } from "@fresnel/contracts/conversation";
import { createHarness } from "./support/harness.ts";

// T-MEAS-EV: 요청을 조립하며 나온 컨텍스트 경고는 그 단계의 `step.completed`에 내구 기록으로 남는다.

const answer = {
  kind: "message",
  content: [{ type: "text", text: "ok" }],
  stopReason: "stop",
} as const;

test("context warnings of the assembly land in the step.completed record", async () => {
  const h = await createHarness({ script: [answer] });
  h.context.warnings.push(
    { code: "cache_prefix_reset", at: 0 },
    { code: "near_window", tokens: 900, contextWindow: 1000 },
  );
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const completed = h.fake.events(h.threadId).filter((event) => event.kind === "step.completed");
  expect(completed).toHaveLength(1);
  const checked = parse(StepCompletedPayloadSchema, completed[0]?.payload);
  expect(checked.ok ? checked.value.contextWarnings : undefined).toEqual([
    { code: "cache_prefix_reset", at: 0 },
    { code: "near_window", tokens: 900, contextWindow: 1000 },
  ]);
});

test("a step without warnings keeps the step.completed payload as before", async () => {
  const h = await createHarness({ script: [answer] });
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const completed = h.fake.events(h.threadId).find((event) => event.kind === "step.completed");
  const checked = parse(StepCompletedPayloadSchema, completed?.payload);
  expect(checked.ok && "contextWarnings" in checked.value).toBe(false);
});

test("the request composition of the assembly lands in the step.completed record", async () => {
  const h = await createHarness({ script: [answer] });
  h.context.composition.value = {
    system: 10,
    tools: 40,
    sections: { memory: 3 },
    injected: 2,
    volatile: 5,
    history: 30,
    total: 50,
  };
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const completed = h.fake.events(h.threadId).find((event) => event.kind === "step.completed");
  const checked = parse(StepCompletedPayloadSchema, completed?.payload);
  expect(checked.ok ? checked.value.composition : undefined).toEqual({
    system: 10,
    tools: 40,
    sections: { memory: 3 },
    injected: 2,
    volatile: 5,
    history: 30,
    total: 50,
  });
});
