import { expect, test } from "bun:test";
import type { AssistantMessage, StepId } from "@xeon/contracts/conversation";
import { assembleOptions, binding, userItem } from "./support/builders.ts";
import { harness } from "./support/harness.ts";

const failed: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "error",
  errorMessage: "prompt is too long",
  timestamp: 1,
};

test("overflow_disabled_in_m1", async () => {
  const h = await harness();
  const stepId: StepId = h.log.ids.next("stp");
  const recovery = await h.service.recoverOverflow(h.log.threadId, stepId, failed, binding);
  expect(recovery).toEqual({ action: "fail", reason: "disabled" });
  // 같은 단계에서 다시 불러도 같고, 가지를 읽거나 요약을 부르지 않는다
  const again = await h.service.recoverOverflow(h.log.threadId, stepId, failed, binding);
  expect(again).toEqual({ action: "fail", reason: "disabled" });
  expect(h.log.reads.count).toBe(0);
  expect(h.log.events).toHaveLength(0);
});

test("compaction_entry_points_report_disabled_in_m1", async () => {
  const h = await harness();
  h.log.append("thread.started", {});
  h.log.append("item.recorded", userItem(h.log, "hello"));
  const opts = assembleOptions(h.log.ids);
  const compacted = await h.service.compact(h.log.threadId, {
    reason: "manual",
    binding,
    contextWindow: opts.contextWindow,
    willRetry: false,
  });
  expect(compacted).toEqual({ ok: true, value: { status: "skipped", why: "disabled" } });
  const check = await h.service.shouldCompact(h.log.threadId, h.log.leaf(), binding);
  expect(check.should).toBe(false);
  const draft = await h.service.summarizeBranch(h.log.threadId, h.log.leaf(), h.log.leaf());
  expect(draft.ok).toBe(false);
  if (!draft.ok) expect(draft.error.kind).toBe("summary_failed");
  // 위 호출 모두 이벤트를 쓰지 않는다
  expect(h.log.events).toHaveLength(2);
});

test("estimate_delegates_to_models_tokens", async () => {
  const h = await harness();
  const estimate = h.service.estimate([{ role: "user", content: "hello", timestamp: 1 }]);
  expect(estimate.tokens).toBeGreaterThan(0);
  expect(estimate.lastUsageIndex).toBeNull();
});
