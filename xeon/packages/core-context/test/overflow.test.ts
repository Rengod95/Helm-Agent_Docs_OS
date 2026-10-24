import { describe, expect, test } from "bun:test";
import type { AssistantMessage, StepId } from "@xeon/contracts/conversation";
import { createContextService } from "../src/service.ts";
import { assembleOptions, binding, userItem } from "./support/builders.ts";
import { harness, installHandlers, type Harness } from "./support/harness.ts";
import { valueOf } from "./support/result.ts";
import { buildChat } from "./support/scenario.ts";

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

const SMALL = { keepRecentTokens: 250, reserveTokens: 1024 };

async function overflowed(): Promise<{ h: Harness; stepId: StepId }> {
  const h = await harness({ settings: SMALL });
  await buildChat(h, 6);
  return { h, stepId: h.log.ids.next("stp") };
}

describe("overflow recovery", () => {
  test("overflow_recovers_once_per_step", async () => {
    const { h, stepId } = await overflowed();
    h.fake.replies.push({ kind: "text", text: "S" });
    const recovery = await h.service.recoverOverflow(h.log.threadId, stepId, failed, binding);
    expect(recovery.action).toBe("retry");
    expect(h.log.commits).toHaveLength(1);
    expect(h.log.commits[0]?.requestId).toBe(`compact:${h.log.threadId}:${stepId}:overflow`);
    const compacted = h.log.events.findLast((event) => event.kind === "thread.compacted");
    expect(recovery).toMatchObject({ action: "retry", compactedEventId: compacted?.id });
    expect(h.fake.calls[0]).toMatchObject({ role: "summary", stepId });
  });

  test("overflow_second_failure_surfaces_error: no further compaction, even from a new service", async () => {
    const { h, stepId } = await overflowed();
    h.fake.replies.push({ kind: "text", text: "S" });
    await h.service.recoverOverflow(h.log.threadId, stepId, failed, binding);
    const commits = h.log.commits.length;

    expect(await h.service.recoverOverflow(h.log.threadId, stepId, failed, binding)).toEqual({
      action: "fail",
      reason: "second_overflow",
    });
    // 프로세스를 다시 띄운 것처럼 서비스를 새로 만들어도 가지가 판정한다
    const restarted = createContextService({
      session: h.log,
      models: h.fake.models,
      ext: h.host.host,
      settings: h.settings,
      producer: h.producer,
      ids: h.log.ids,
    });
    expect(await restarted.recoverOverflow(h.log.threadId, stepId, failed, binding)).toEqual({
      action: "fail",
      reason: "second_overflow",
    });
    expect(h.log.commits).toHaveLength(commits);
    expect(h.fake.calls).toHaveLength(1);
  });

  test("another step may recover again", async () => {
    const { h, stepId } = await overflowed();
    h.fake.replies.push({ kind: "text", text: "S" });
    await h.service.recoverOverflow(h.log.threadId, stepId, failed, binding);
    // 컴팩션 뒤 대화가 자라 다음 단계에서 다시 넘친다
    const turn = h.log.ids.next("trn");
    for (let i = 0; i < 6; i += 1) {
      h.log.append("item.recorded", userItem(h.log, `more ${i} ${"q".repeat(400)}`), {
        turnId: turn,
      });
    }
    h.fake.replies.push({ kind: "text", text: "S2" });
    const next = h.log.ids.next("stp");
    expect((await h.service.recoverOverflow(h.log.threadId, next, failed, binding)).action).toBe(
      "retry",
    );
  });

  test("a cancelled, failed or empty compaction fails with its own reason", async () => {
    const cancelled = await overflowed();
    await installHandlers(cancelled.h.host, "deny", 3, ["session_before_compact"], (g) => {
      g.on("session_before_compact", () => ({ cancel: true as const, reason: "no" }));
    });
    expect(
      await cancelled.h.service.recoverOverflow(
        cancelled.h.log.threadId,
        cancelled.stepId,
        failed,
        binding,
      ),
    ).toEqual({ action: "fail", reason: "compaction_cancelled" });

    const broken = await overflowed();
    broken.h.fake.replies.push({ kind: "error", message: "boom" });
    expect(
      await broken.h.service.recoverOverflow(broken.h.log.threadId, broken.stepId, failed, binding),
    ).toEqual({ action: "fail", reason: "compaction_failed" });

    const empty = await harness({ settings: { keepRecentTokens: 100_000 } });
    await buildChat(empty, 2);
    expect(
      await empty.service.recoverOverflow(
        empty.log.threadId,
        empty.log.ids.next("stp"),
        failed,
        binding,
      ),
    ).toEqual({ action: "fail", reason: "compaction_failed" });
  });

  test("overflow_disabled: autoCompact off or a service without a producer never calls the model", async () => {
    const off = await harness({ settings: { ...SMALL, autoCompact: false } });
    await buildChat(off, 6);
    const stepId = off.log.ids.next("stp");
    expect(await off.service.recoverOverflow(off.log.threadId, stepId, failed, binding)).toEqual({
      action: "fail",
      reason: "disabled",
    });
    const bare = await harness({ settings: SMALL, compaction: false });
    await buildChat(bare, 6);
    expect(await bare.service.recoverOverflow(bare.log.threadId, stepId, failed, binding)).toEqual({
      action: "fail",
      reason: "disabled",
    });
    expect(off.fake.calls).toHaveLength(0);
    expect(bare.fake.calls).toHaveLength(0);
    expect(off.log.commits).toHaveLength(0);
  });
});

describe("other entry points without a compaction setup", () => {
  test("estimate delegates to models.tokens", async () => {
    const h = await harness();
    const estimate = h.service.estimate([{ role: "user", content: "hello", timestamp: 1 }]);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(estimate.lastUsageIndex).toBeNull();
  });

  test("assemble still works with the default settings and no compaction", async () => {
    const h = await harness({ compaction: false });
    h.log.append("thread.started", {});
    h.log.append("item.recorded", userItem(h.log, "hello"));
    const result = valueOf(
      await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
    );
    expect(result.pendingItems.map((item) => item.purpose)).toEqual(["prefix"]);
  });
});
