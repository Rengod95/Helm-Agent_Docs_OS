import { describe, expect, test } from "bun:test";
import type {
  AssistantMessage,
  ItemRecord,
  Message,
  ToolResultMessage,
  TurnId,
  Usage,
} from "@xeon/contracts/conversation";
import {
  assembleOptions,
  assistantItem,
  binding,
  systemItem,
  userItem,
} from "./support/builders.ts";
import { RECENT_FILE_MAX_CHARS } from "../src/recent-files.ts";
import { harness, type Harness } from "./support/harness.ts";
import type { MemoryLog } from "./support/log.ts";
import { present, valueOf } from "./support/result.ts";

// L1.context.spec §4.10 컴팩션 뒤 최근 읽은 파일 재주입(M3-REQ-86). 접힌 범위의 read 결과 가운데 마지막에 읽은 파일을
// `l1.context.reinjectRecentFiles`개까지 요약 바로 뒤에 user 메시지로 다시 놓는다.

const SMALL = { keepRecentTokens: 250, reserveTokens: 1024 };
const pad = "x".repeat(400);
const MARK = "[File re-injected after compaction:";

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface Read {
  readonly path: string;
  readonly text: string;
  readonly isError?: boolean;
}

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/** 도구 호출 하나를 담은 어시스턴트 item */
function callItem(
  log: MemoryLog,
  callId: string,
  name: string,
  path: string,
): { item: ItemRecord } {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name, arguments: { path } }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage,
    stopReason: "toolUse",
    timestamp: 2,
  };
  return {
    item: {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message,
      partIds: [],
    },
  };
}

/** 도구 결과 item. 본문은 텍스트 한 블록이다 */
function resultItem(
  log: MemoryLog,
  callId: string,
  name: string,
  text: string,
  isError: boolean,
): { item: ItemRecord } {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: name,
    content: [{ type: "text", text }],
    isError,
    timestamp: 3,
  };
  return {
    item: {
      itemId: log.ids.next("itm"),
      status: "completed",
      kind: "toolResult",
      message,
      effectId: null,
    },
  };
}

/** 호출 하나와 결과 하나를 같은 턴에 기록한다 */
function recordCall(h: Harness, turnId: TurnId, name: string, read: Read): void {
  const callId = h.log.ids.next("itm");
  h.log.append("item.recorded", callItem(h.log, callId, name, read.path), { turnId });
  h.log.append("item.recorded", resultItem(h.log, callId, name, read.text, read.isError ?? false), {
    turnId,
  });
}

/**
 * 시작 user, 접두 system, 접힐 도구 호출들, 그 뒤 여섯 턴의 여백. 호출들은 모두 접힌 범위에 든다.
 * `after`는 여백 뒤 남는 범위에 기록할 호출들이다.
 */
async function sessionWith(
  h: Harness,
  folded: readonly { readonly name: string; readonly read: Read }[],
  after: readonly { readonly name: string; readonly read: Read }[] = [],
): Promise<void> {
  h.log.append("thread.started", {});
  const turn = h.log.ids.next("trn");
  h.log.append("item.recorded", userItem(h.log, `start ${pad}`), { turnId: turn });
  const first = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  h.log.append("item.recorded", systemItem(h.log, present(first.pendingItems[0]).message));
  for (const call of folded) recordCall(h, turn, call.name, call.read);
  h.log.append("item.recorded", userItem(h.log, `after reads ${pad}`), { turnId: turn });
  for (let i = 1; i < 6; i += 1) {
    const turnId = h.log.ids.next("trn");
    h.log.append("item.recorded", userItem(h.log, `question ${i} ${pad}`), { turnId });
    h.log.append("item.recorded", assistantItem(h.log, `answer ${i} ${pad}`), { turnId });
  }
  if (after.length > 0) {
    const turnId = h.log.ids.next("trn");
    h.log.append("item.recorded", userItem(h.log, `again ${pad}`), { turnId });
    for (const call of after) recordCall(h, turnId, call.name, call.read);
    h.log.append("item.recorded", userItem(h.log, `done ${pad}`), { turnId });
  }
}

async function compactAndAssemble(h: Harness): Promise<readonly Message[]> {
  // 자른 자리가 턴 가운데면 턴 앞부분 요약이 한 번 더 불린다
  h.fake.replies.push({ kind: "text", text: "SUMMARY ONE" }, { kind: "text", text: "PREFIX ONE" });
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

const reinjected = (messages: readonly Message[]): string[] =>
  messages.map(textOf).filter((text) => text.startsWith(MARK));

describe("recent file re-injection after compaction", () => {
  test("the last two of three folded reads follow the summary as user messages in read order", async () => {
    const h = await harness({ settings: { ...SMALL, reinjectRecentFiles: 2 } });
    await sessionWith(h, [
      { name: "read", read: { path: "a.txt", text: "AAA body" } },
      { name: "read", read: { path: "b.txt", text: "BBB body" } },
      { name: "read", read: { path: "c.txt", text: "CCC body" } },
    ]);
    const messages = await compactAndAssemble(h);
    const texts = messages.map(textOf);
    const summary = texts.findIndex((text) => text.includes("SUMMARY ONE"));
    expect(summary).toBeGreaterThanOrEqual(0);
    // 요약 바로 뒤에 읽은 순서대로, user 메시지로 놓인다
    expect(texts.slice(summary + 1, summary + 3)).toEqual([
      `${MARK} b.txt]\nBBB body`,
      `${MARK} c.txt]\nCCC body`,
    ]);
    expect(messages.slice(summary + 1, summary + 3).map((message) => message.role)).toEqual([
      "user",
      "user",
    ]);
    expect(reinjected(messages)).toHaveLength(2);
  });

  test("with reinjectRecentFiles at zero nothing is re-injected", async () => {
    const h = await harness({ settings: { ...SMALL, reinjectRecentFiles: 0 } });
    await sessionWith(h, [
      { name: "read", read: { path: "a.txt", text: "AAA body" } },
      { name: "read", read: { path: "b.txt", text: "BBB body" } },
    ]);
    const messages = await compactAndAssemble(h);
    expect(messages.map(textOf).some((text) => text.includes("SUMMARY ONE"))).toBe(true);
    expect(reinjected(messages)).toEqual([]);
  });

  test("a file edited after it was read in the folded range is not re-injected", async () => {
    const h = await harness({ settings: { ...SMALL, reinjectRecentFiles: 5 } });
    await sessionWith(h, [
      { name: "read", read: { path: "a.txt", text: "AAA before edit" } },
      { name: "read", read: { path: "b.txt", text: "BBB body" } },
      { name: "edit", read: { path: "a.txt", text: "edited" } },
      { name: "read", read: { path: "c.txt", text: "CCC body" } },
    ]);
    const messages = await compactAndAssemble(h);
    expect(reinjected(messages)).toEqual([`${MARK} b.txt]\nBBB body`, `${MARK} c.txt]\nCCC body`]);
    expect(messages.map(textOf).some((text) => text.includes("AAA before edit"))).toBe(false);
  });

  test("a file read again in the kept range is not re-injected", async () => {
    const h = await harness({ settings: { ...SMALL, reinjectRecentFiles: 5 } });
    await sessionWith(
      h,
      [
        { name: "read", read: { path: "a.txt", text: "AAA body" } },
        { name: "read", read: { path: "b.txt", text: "BBB body" } },
        { name: "read", read: { path: "c.txt", text: "CCC body" } },
      ],
      [{ name: "read", read: { path: "b.txt", text: "BBB again" } }],
    );
    const messages = await compactAndAssemble(h);
    expect(reinjected(messages)).toEqual([`${MARK} a.txt]\nAAA body`, `${MARK} c.txt]\nCCC body`]);
  });

  test("a read result longer than 16000 characters is clipped with the omitted-characters marker", async () => {
    const h = await harness({ settings: { ...SMALL, reinjectRecentFiles: 5 } });
    expect(RECENT_FILE_MAX_CHARS).toBe(16_000);
    const body = `${"L".repeat(RECENT_FILE_MAX_CHARS)}${"T".repeat(300)}`;
    await sessionWith(h, [{ name: "read", read: { path: "big.txt", text: body } }]);
    const messages = await compactAndAssemble(h);
    expect(reinjected(messages)).toEqual([
      `${MARK} big.txt]\n${"L".repeat(RECENT_FILE_MAX_CHARS)}\n[... 300 more characters omitted]`,
    ]);
  });

  test("an errored read result is not re-injected", async () => {
    const h = await harness({ settings: { ...SMALL, reinjectRecentFiles: 5 } });
    await sessionWith(h, [
      { name: "read", read: { path: "a.txt", text: "AAA body" } },
      { name: "read", read: { path: "b.txt", text: "ENOENT", isError: true } },
      { name: "read", read: { path: "c.txt", text: "CCC body" } },
    ]);
    const messages = await compactAndAssemble(h);
    expect(reinjected(messages)).toEqual([`${MARK} a.txt]\nAAA body`, `${MARK} c.txt]\nCCC body`]);
  });
});
