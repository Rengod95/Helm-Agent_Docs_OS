import { expect, test } from "bun:test";
import type { AgentMessage, Message } from "@xeon/contracts/conversation";
import {
  BRANCH_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_PREFIX,
  branchSummaryMessage,
  compactionSummaryMessage,
  convertToLlm,
  customToUser,
  itemToMessage,
} from "../src/convert.ts";
import {
  assembleOptions,
  assistantItem,
  compactedPayload,
  customItem,
  userItem,
} from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";

test("convert_custom_and_summary_messages", async () => {
  const h = await harness();
  const custom = customItem(h.log, { content: "remember this", display: true });
  // custom item은 display와 상관없이 details 없이 user 메시지로 바뀐다
  const converted = itemToMessage(custom.item);
  expect(converted).toEqual({ role: "user", content: "remember this", timestamp: 3 });
  expect(Object.keys(converted)).not.toContain("details");
  expect(Object.keys(converted)).not.toContain("customType");

  // thread.compacted는 요약 메시지 하나로
  h.log.append("thread.started", {});
  const first = h.log.append("item.recorded", userItem(h.log, "old question"));
  h.log.append("item.recorded", assistantItem(h.log, "old answer"));
  const kept = h.log.append("item.recorded", userItem(h.log, "kept question"));
  const compacted = h.log.append("thread.compacted", compactedPayload(kept.id, "the summary"));
  const opts = assembleOptions(h.log.ids);
  const assembled = valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), opts));
  const summaries = assembled.messages.filter(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.some(
        (block) => block.type === "text" && block.text.startsWith(COMPACTION_SUMMARY_PREFIX),
      ),
  );
  expect(summaries).toHaveLength(1);
  expect(first.id).not.toBe(compacted.id);
  expect(present(summaries[0]).timestamp).toBe(compacted.recordedAt);
});

test("summary_messages_use_pi_text_format", () => {
  expect(compactionSummaryMessage("S", 7)).toEqual({
    role: "user",
    content: [
      {
        type: "text",
        text: `${COMPACTION_SUMMARY_PREFIX}S\n</summary>`,
      },
    ],
    timestamp: 7,
  });
  expect(branchSummaryMessage("B", 8)).toEqual({
    role: "user",
    content: [{ type: "text", text: `${BRANCH_SUMMARY_PREFIX}B</summary>` }],
    timestamp: 8,
  });
});

test("convert_to_llm_maps_custom_and_passes_the_rest", () => {
  const user: Message = { role: "user", content: "hi", timestamp: 1 };
  const custom: AgentMessage = {
    role: "custom",
    customType: "grp.helm.phase.note",
    content: [{ type: "text", text: "phase note" }],
    display: false,
    details: { hidden: true },
    timestamp: 2,
  };
  const out = convertToLlm([user, custom]);
  expect(out).toEqual([
    user,
    { role: "user", content: [{ type: "text", text: "phase note" }], timestamp: 2 },
  ]);
  expect(out[0]).toBe(user);
  expect(convertToLlm([])).toEqual([]);
  expect(customToUser(customItemMessage())).toEqual({ role: "user", content: "c", timestamp: 4 });
});

function customItemMessage() {
  return {
    role: "custom" as const,
    customType: "x.a.b.c",
    content: "c",
    display: true,
    details: null,
    timestamp: 4,
  };
}
