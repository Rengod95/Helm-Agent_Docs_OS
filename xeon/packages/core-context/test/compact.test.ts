import { describe, expect, test } from "bun:test";
import { canonicalJson } from "@xeon/contracts";
import type { ItemRecord } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope } from "@xeon/contracts/records";
import {
  UPDATE_SUMMARIZATION_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
} from "../src/compaction/prompts.ts";
import {
  assembleOptions,
  assistantItem,
  binding,
  fixedTokens,
  userItem,
} from "./support/builders.ts";
import { harness, installHandlers, type Harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";
import { buildChat } from "./support/scenario.ts";

// L1.context.plan §5: compaction_is_non_destructive, rolling_summary_updates_previous, summary_call_uses_summary_role_no_cache.
// 요약 모델은 test/support/fake-models.ts의 대역이다(요약 응답은 준비한 문장이다).

const SMALL = { keepRecentTokens: 250, reserveTokens: 1024 };

function request(overrides: Partial<Parameters<Harness["service"]["compact"]>[1]> = {}) {
  return {
    reason: "manual" as const,
    binding,
    contextWindow: 200_000,
    willRetry: false,
    ...overrides,
  };
}

function userItemOf(h: Harness, text: string): { item: ItemRecord } {
  return userItem(h.log, text);
}

function assistantItemOf(h: Harness, text: string): { item: ItemRecord } {
  return assistantItem(h.log, text);
}

function bytesOf(events: readonly DurableEventEnvelope[]): string[] {
  return events.map((event) => canonicalJson(event));
}

describe("compaction_is_non_destructive", () => {
  test("only a thread.compacted event and a new prefix item are added, nothing earlier changes", async () => {
    const h = await harness({ settings: SMALL });
    const chat = await buildChat(h, 6);
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids));
    h.fake.replies.push({ kind: "text", text: "SUMMARY ONE" });
    const before = bytesOf(h.log.events);

    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(outcome.status).toBe("compacted");

    const after = h.log.events;
    expect(after.length).toBe(before.length + 2);
    expect(bytesOf(after.slice(0, before.length))).toEqual(before);
    expect(after.slice(-2).map((event) => event.kind)).toEqual([
      "thread.compacted",
      "item.recorded",
    ]);
    // 새 접두는 정렬된 도구 전체 목록을 다시 광고한다
    const prefix = present(after.at(-1));
    expect(canonicalJson(prefix.payload)).toContain('"toolsAdded"');
    expect(canonicalJson(prefix.payload)).toContain("bash");

    // 조립 결과에는 firstKept 앞 원문이 없고 요약이 하나 있다
    const assembled = valueOf(
      await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
    );
    const text = JSON.stringify(assembled.messages);
    expect(text).toContain("SUMMARY ONE");
    expect(text).not.toContain("question 0");
    expect(assembled.compactionHead?.eventId).toBe(after.at(-2)?.id);
    expect(assembled.pendingItems).toHaveLength(0);

    // 비파괴: leaf를 컴팩션 앞으로 옮기면 원문이 다시 조립된다
    const original = valueOf(
      await h.service.assemble(
        h.log.threadId,
        chat.assistants.at(-1) ?? h.log.leaf(),
        assembleOptions(h.log.ids),
      ),
    );
    expect(JSON.stringify(original.messages)).toContain("question 0");
    expect(original.compactionHead).toBeNull();
  });

  test("the commit uses the C7 key and the details record the reason and step", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    const stepId = h.log.ids.next("stp");
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(await h.service.compact(h.log.threadId, request({ reason: "threshold", stepId })));
    expect(h.log.commits.map((commit) => commit.requestId)).toEqual([
      `compact:${h.log.threadId}:${stepId}:threshold`,
    ]);
    const compacted = present(h.log.events.findLast((event) => event.kind === "thread.compacted"));
    expect(compacted.payload).toMatchObject({
      details: { xeon: { reason: "threshold", stepId }, readFiles: [], modifiedFiles: [] },
      fromExtension: null,
    });
    expect(compacted.stepId).toBe(stepId);
  });

  test("a manual compaction without a step keys on the leaf event", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    const leaf = h.log.leaf();
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(await h.service.compact(h.log.threadId, request()));
    expect(h.log.commits[0]?.requestId).toBe(`compact:${h.log.threadId}:${leaf}:manual`);
    const compacted = present(h.log.events.findLast((event) => event.kind === "thread.compacted"));
    expect(compacted.payload).toMatchObject({ details: { xeon: { stepId: null } } });
  });

  test("the summary usage and tokensBefore are recorded", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({
      kind: "text",
      text: "S",
      usage: { input: 321, output: 12, totalTokens: 333 },
    });
    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    const compacted = present(h.log.events.findLast((event) => event.kind === "thread.compacted"));
    expect(compacted.payload).toMatchObject({ usage: { input: 321, output: 12 } });
    expect(outcome.status === "compacted" && outcome.tokensBefore).toBeGreaterThan(0);
  });
});

describe("summary call", () => {
  test("summary_call_uses_summary_role_no_cache", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(await h.service.compact(h.log.threadId, request()));
    expect(h.fake.calls).toHaveLength(1);
    expect(h.fake.calls[0]).toMatchObject({
      role: "summary",
      cacheRetention: "none",
      system: SUMMARIZATION_SYSTEM_PROMPT,
    });
    // 요약 대상은 대화 텍스트로 직렬화해 넣는다
    expect(h.fake.calls[0]?.prompt).toContain("[User]: question 0");
    expect(h.fake.calls[0]?.prompt).toContain("<conversation>");
  });

  test("the response cap is min(0.8 x reserve, 16000) and the config instructions are appended", async () => {
    const h = await harness({
      settings: { ...SMALL, reserveTokens: 5000, compactionInstructions: "focus on tests" },
    });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(await h.service.compact(h.log.threadId, request({ instructions: "and docs" })));
    expect(h.fake.calls[0]?.maxTokens).toBe(4000);
    expect(h.fake.calls[0]?.prompt).toContain("Additional focus: focus on tests\nand docs");
  });
});

describe("rolling_summary_updates_previous", () => {
  test("the second compaction updates the earlier summary and only sends what came after it", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "FIRST SUMMARY" });
    valueOf(await h.service.compact(h.log.threadId, request()));

    // 컴팩션 뒤 대화가 이어진다
    const turn = h.log.ids.next("trn");
    for (let i = 0; i < 5; i += 1) {
      h.log.append("item.recorded", userItemOf(h, `later question ${i} ${"y".repeat(400)}`), {
        turnId: turn,
      });
      h.log.append("item.recorded", assistantItemOf(h, `later answer ${i} ${"y".repeat(400)}`), {
        turnId: turn,
      });
    }
    h.fake.replies.push({ kind: "text", text: "SECOND SUMMARY" });
    const second = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(second.status).toBe("compacted");
    const prompt = present(h.fake.calls[1]).prompt;
    expect(prompt).toContain(UPDATE_SUMMARIZATION_PROMPT);
    expect(prompt).toContain("<previous-summary>\nFIRST SUMMARY\n</previous-summary>");
    expect(prompt).toContain("later question 0");
    // 첫 컴팩션에서 이미 요약된 원문은 다시 보내지 않는다
    expect(prompt).not.toContain("question 0 xxx");
    // 이전 머리는 다음 요약의 previousSummary로만 남고 조립에는 마지막 머리 하나만 쓴다
    const assembled = valueOf(
      await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
    );
    expect(JSON.stringify(assembled.messages)).toContain("SECOND SUMMARY");
    expect(JSON.stringify(assembled.messages)).not.toContain("FIRST SUMMARY");
  });
});

describe("split turn", () => {
  test("a cut inside one long turn summarizes the history and the turn prefix separately", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 2);
    const turn = h.log.ids.next("trn");
    h.log.append("item.recorded", userItemOf(h, `big task ${"z".repeat(300)}`), { turnId: turn });
    for (let i = 0; i < 6; i += 1) {
      h.log.append("item.recorded", assistantItemOf(h, `step ${i} ${"z".repeat(500)}`), {
        turnId: turn,
      });
    }
    h.fake.replies.push({ kind: "text", text: "HISTORY" }, { kind: "text", text: "TURN PREFIX" });
    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(outcome.status).toBe("compacted");
    expect(h.fake.calls).toHaveLength(2);
    expect(h.fake.calls[0]?.prompt).toContain("question 0");
    expect(h.fake.calls[1]?.prompt).toContain("# Instructions");
    expect(h.fake.calls[1]?.prompt).toContain("big task");
    // 두 요약은 "---"와 턴 맥락 표지로 합친다. 턴 앞부분 응답 상한은 reserve의 절반이다
    const compacted = present(h.log.events.findLast((event) => event.kind === "thread.compacted"));
    expect(compacted.payload).toMatchObject({
      summary: "HISTORY\n\n---\n\n**Turn Context (split turn):**\n\nTURN PREFIX",
    });
    expect(h.fake.calls[1]?.maxTokens).toBe(512);
  });
});

describe("skips", () => {
  test("nothing to summarize when everything fits in the kept budget", async () => {
    const h = await harness({ settings: { keepRecentTokens: 100_000 } });
    await buildChat(h, 3);
    expect(valueOf(await h.service.compact(h.log.threadId, request()))).toEqual({
      status: "skipped",
      why: "nothing_to_summarize",
    });
    expect(h.fake.calls).toHaveLength(0);
    expect(h.log.commits).toHaveLength(0);
  });

  test("right after a compaction there is nothing to do", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(await h.service.compact(h.log.threadId, request()));
    expect(valueOf(await h.service.compact(h.log.threadId, request()))).toEqual({
      status: "skipped",
      why: "last_entry_is_compaction",
    });
  });

  test("automatic reasons are skipped when autoCompact is off, a manual one is not", async () => {
    const h = await harness({ settings: { ...SMALL, autoCompact: false } });
    await buildChat(h, 6);
    const skipped = { status: "skipped", why: "disabled" } as const;
    expect(
      valueOf(await h.service.compact(h.log.threadId, request({ reason: "threshold" }))),
    ).toEqual(skipped);
    expect(
      valueOf(await h.service.compact(h.log.threadId, request({ reason: "overflow" }))),
    ).toEqual(skipped);
    h.fake.replies.push({ kind: "text", text: "S" });
    expect(valueOf(await h.service.compact(h.log.threadId, request())).status).toBe("compacted");
  });

  test("a service without the core.context producer or an id source never compacts", async () => {
    const h = await harness({ settings: SMALL, compaction: false });
    await buildChat(h, 6);
    expect(valueOf(await h.service.compact(h.log.threadId, request()))).toEqual({
      status: "skipped",
      why: "disabled",
    });
    expect(h.log.commits).toHaveLength(0);
  });
});

async function failing(
  reply: Parameters<Harness["fake"]["replies"]["push"]>[0],
): Promise<{ h: Harness; error: { kind: string; message: string } | undefined }> {
  const h = await harness({ settings: SMALL });
  await buildChat(h, 6);
  h.fake.replies.push(reply);
  const failed: string[] = [];
  await installHandlers(h.host, "watch-failed", 5, ["session_compact_failed"], (g) => {
    g.on("session_compact_failed", (payload) => {
      failed.push(String(payload.errorMessage));
    });
  });
  const before = h.log.events.length;
  const result = await h.service.compact(h.log.threadId, request());
  await h.host.settled();
  expect(h.log.events.length).toBe(before);
  expect(h.log.commits).toHaveLength(0);
  expect(failed).toHaveLength(1);
  return { h, error: result.ok ? undefined : result.error };
}

describe("failures", () => {
  test("compaction_failure_emits_session_compact_failed: a model error", async () => {
    const { error } = await failing({ kind: "error", message: "529 overloaded" });
    expect(error).toEqual({
      kind: "summary_failed",
      message: "Summarization failed: 529 overloaded",
    });
  });

  test("a length stop is summary_truncated and a tool call is summary_has_tool_call", async () => {
    expect((await failing({ kind: "length", text: "partial" })).error?.kind).toBe(
      "summary_truncated",
    );
    expect((await failing({ kind: "toolCall" })).error?.kind).toBe("summary_has_tool_call");
  });

  test("an aborted summary is aborted and reports a null message", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "aborted" });
    const messages: (string | null)[] = [];
    await installHandlers(h.host, "watch-failed", 5, ["session_compact_failed"], (g) => {
      g.on("session_compact_failed", (payload) => {
        messages.push(payload.errorMessage);
      });
    });
    const result = await h.service.compact(h.log.threadId, request());
    await h.host.settled();
    expect(result).toMatchObject({ ok: false, error: { kind: "aborted" } });
    expect(messages).toEqual([null]);
  });

  test("no model for the summary role", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.resolveFailure.current = { kind: "no_model_for_role", message: "none" };
    const result = await h.service.compact(h.log.threadId, request());
    expect(result).toMatchObject({ ok: false, error: { kind: "summary_failed" } });
    expect(h.log.commits).toHaveLength(0);
  });

  test("a summary over the record limit is summary_truncated", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "s".repeat(70_000) });
    const result = await h.service.compact(h.log.threadId, request());
    expect(result).toMatchObject({ ok: false, error: { kind: "summary_truncated" } });
    expect(h.log.commits).toHaveLength(0);
  });

  test("a commit that the store rejects or fails is commit_failed and leaves the log alone", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "S" }, { kind: "text", text: "S" });
    const before = h.log.events.length;
    h.log.commitFault.current = { kind: "store", error: { kind: "busy" } };
    expect(await h.service.compact(h.log.threadId, request())).toMatchObject({
      ok: false,
      error: { kind: "commit_failed", message: "compaction commit failed: busy" },
    });
    h.log.commitFault.current = { kind: "reject", code: "leaf_conflict" };
    expect(await h.service.compact(h.log.threadId, request())).toMatchObject({
      ok: false,
      error: { kind: "commit_failed" },
    });
    expect(h.log.events.length).toBe(before);
  });

  test("a leaf that moved while summarizing is rejected, not committed", async () => {
    const h = await harness({ settings: SMALL });
    await buildChat(h, 6);
    h.fake.replies.push({ kind: "text", text: "S" });
    // 요약 응답 뒤 커밋 전에 가지가 자라난 상황: 요약 대상 leaf와 달라지면 expectedLeaf가 거부한다
    h.fake.hooks.afterComplete = () => {
      h.log.append("item.recorded", userItemOf(h, "late arrival"));
    };
    const result = await h.service.compact(h.log.threadId, request());
    expect(result).toMatchObject({ ok: false, error: { kind: "commit_failed" } });
  });
});

describe("shouldCompact", () => {
  test("shouldCompact: false at window minus reserve and true one token above", async () => {
    const h = await harness({
      settings: { reserveTokens: 16_384 },
      models: { contextWindow: 100_000, estimator: fixedTokens(100_000 - 16_384) },
    });
    await buildChat(h, 2);
    const at = await h.service.shouldCompact(h.log.threadId, h.log.leaf(), binding);
    expect(at).toEqual({ should: false, tokens: 83_616, threshold: 83_616 });

    const above = await harness({
      settings: { reserveTokens: 16_384 },
      models: { contextWindow: 100_000, estimator: fixedTokens(100_000 - 16_384 + 1) },
    });
    await buildChat(above, 2);
    expect(
      (await above.service.shouldCompact(above.log.threadId, above.log.leaf(), binding)).should,
    ).toBe(true);
  });

  test("autoCompact off is always false, and an unknown pinned model gives no check", async () => {
    const h = await harness({
      settings: { autoCompact: false },
      models: { contextWindow: 1000, estimator: fixedTokens(5000) },
    });
    await buildChat(h, 2);
    expect((await h.service.shouldCompact(h.log.threadId, h.log.leaf(), binding)).should).toBe(
      false,
    );
    h.fake.rebindFailure.current = { kind: "model_not_found", message: "gone" };
    expect(await h.service.shouldCompact(h.log.threadId, h.log.leaf(), binding)).toEqual({
      should: false,
      tokens: 0,
      threshold: 0,
    });
  });

  test("the check never calls the model", async () => {
    const h = await harness({ models: { contextWindow: 1000, estimator: fixedTokens(5000) } });
    await buildChat(h, 2);
    await h.service.shouldCompact(h.log.threadId, h.log.leaf(), binding);
    expect(h.fake.calls).toHaveLength(0);
  });
});
