import { describe, expect, test } from "bun:test";
import type { Message } from "@xeon/contracts/conversation";
import {
  assembleOptions,
  assistantItem,
  binding,
  customItem,
  systemItem,
  userItem,
} from "./support/builders.ts";
import { harness, type Harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";

// M2 마감 G2-01(감사 L2-05). 컴팩션이 첫 블록을 요약으로 접어도 스킬 색인과 메모리 스냅샷은 요약 뒤에 다시 놓인다.

const SMALL = { keepRecentTokens: 250, reserveTokens: 1024 };
const pad = "x".repeat(400);

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/** 접힐 범위에 색인 블록과 변경 메모, 재주입 대상이 아닌 custom을 두고, 남는 범위에 변경 메모 하나를 더 둔 대화 */
async function chatWithBlocks(h: Harness): Promise<void> {
  h.log.append("thread.started", {});
  const turn = h.log.ids.next("trn");
  h.log.append(
    "item.recorded",
    customItem(h.log, { customType: "knowledge.context", content: "SKILL INDEX AND MEMORY" }),
    { turnId: turn },
  );
  h.log.append("item.recorded", userItem(h.log, `question 0 ${pad}`), { turnId: turn });
  const first = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  h.log.append("item.recorded", systemItem(h.log, present(first.pendingItems[0]).message));
  h.log.append("item.recorded", assistantItem(h.log, `answer 0 ${pad}`), { turnId: turn });
  h.log.append(
    "item.recorded",
    customItem(h.log, { customType: "knowledge.index-delta", content: "DELTA ONE" }),
  );
  h.log.append(
    "item.recorded",
    customItem(h.log, { customType: "x.other.note", content: "NOT REINJECTED" }),
  );
  for (let i = 1; i < 6; i += 1) {
    const turnId = h.log.ids.next("trn");
    h.log.append("item.recorded", userItem(h.log, `question ${i} ${pad}`), { turnId });
    h.log.append("item.recorded", assistantItem(h.log, `answer ${i} ${pad}`), { turnId });
  }
  h.log.append(
    "item.recorded",
    customItem(h.log, { customType: "knowledge.index-delta", content: "DELTA KEPT" }),
  );
}

async function compactAndAssemble(h: Harness): Promise<readonly Message[]> {
  h.fake.replies.push({ kind: "text", text: "SUMMARY ONE" });
  valueOf(
    await h.service.compact(h.log.threadId, {
      reason: "manual",
      binding,
      contextWindow: 200_000,
      willRetry: false,
    }),
  );
  return valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)))
    .messages;
}

describe("reinjection after compaction", () => {
  test("the folded skill index, memory snapshot and index deltas follow the summary in order, once", async () => {
    const h = await harness({ settings: SMALL });
    await chatWithBlocks(h);
    const messages = await compactAndAssemble(h);
    const texts = messages.map(textOf);
    expect(texts.some((text) => text.includes("question 0"))).toBe(false);
    const summary = texts.findIndex((text) => text.includes("SUMMARY ONE"));
    expect(summary).toBe(1);
    expect(texts.slice(summary + 1, summary + 3)).toEqual(["SKILL INDEX AND MEMORY", "DELTA ONE"]);
    // 접힌 범위의 다른 custom은 다시 넣지 않고, 남은 범위의 메모는 한 번만 나온다
    expect(texts.filter((text) => text === "NOT REINJECTED")).toEqual([]);
    expect(texts.filter((text) => text === "DELTA KEPT")).toHaveLength(1);
    expect(texts.filter((text) => text === "SKILL INDEX AND MEMORY")).toHaveLength(1);
  });

  test("with an empty allow list nothing is reinjected", async () => {
    const h = await harness({ settings: SMALL, reinjectCustomTypes: [] });
    await chatWithBlocks(h);
    const texts = (await compactAndAssemble(h)).map(textOf);
    expect(texts).not.toContain("SKILL INDEX AND MEMORY");
    expect(texts).not.toContain("DELTA ONE");
  });

  test("without a compaction the blocks stay where they were recorded", async () => {
    const h = await harness({ settings: SMALL });
    await chatWithBlocks(h);
    const messages = valueOf(
      await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
    ).messages;
    const texts = messages.map(textOf);
    expect(texts.filter((text) => text === "SKILL INDEX AND MEMORY")).toHaveLength(1);
    expect(texts.indexOf("SKILL INDEX AND MEMORY")).toBeLessThan(
      texts.findIndex((text) => text.startsWith("question 0")),
    );
  });
});
