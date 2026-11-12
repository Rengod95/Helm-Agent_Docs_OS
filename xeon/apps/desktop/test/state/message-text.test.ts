import { describe, expect, test } from "bun:test";
import type { AssistantMessage, ItemRecord, UserMessage } from "@fresnel/contracts/conversation";
import { messageCopyText } from "../../src/state/engine/message-text.ts";
import { itm, prt, userItem } from "./helpers.ts";

// 메시지 복사용 원문: 사용자·어시스턴트 메시지의 글 파트만 줄바꿈으로 이어 붙인다. 값은 `toEqual`로 비교한다.

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantItem(n: number, content: AssistantMessage["content"]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    message: {
      role: "assistant",
      content,
      api: "anthropic-messages",
      provider: "anthropic",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 0,
    },
    partIds: content.map((_, i) => prt(n * 10 + i)),
  };
}

function userWithBlocks(n: number, content: UserMessage["content"]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "user",
    message: { role: "user", content, timestamp: 0 },
    requestId: null,
  };
}

describe("messageCopyText", () => {
  test("a plain user message copies its text as it is", () => {
    expect(messageCopyText(userItem(1, "안녕하세요"))).toBe("안녕하세요");
  });

  test("an empty user message has nothing to copy", () => {
    expect(messageCopyText(userItem(1, ""))).toBeNull();
  });

  test("a user message with text and images copies the text parts only", () => {
    const item = userWithBlocks(1, [
      { type: "text", text: "첫째" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "text", text: "둘째" },
    ]);
    expect(messageCopyText(item)).toBe("첫째\n둘째");
  });

  test("an image-only user message has nothing to copy", () => {
    const item = userWithBlocks(1, [{ type: "image", data: "AAAA", mimeType: "image/png" }]);
    expect(messageCopyText(item)).toBeNull();
  });

  test("an assistant reply joins its text blocks and leaves out thinking and tool calls", () => {
    const item = assistantItem(2, [
      { type: "thinking", thinking: "생각 중" },
      { type: "text", text: "먼저 확인한다." },
      { type: "toolCall", id: "c1", name: "read", arguments: {} },
      { type: "text", text: "끝났다." },
    ]);
    expect(messageCopyText(item)).toBe("먼저 확인한다.\n끝났다.");
  });

  test("an assistant reply with only a tool call or only thinking has nothing to copy", () => {
    const onlyTool = assistantItem(2, [
      { type: "toolCall", id: "c1", name: "read", arguments: {} },
    ]);
    const onlyThinking = assistantItem(3, [{ type: "thinking", thinking: "생각" }]);
    expect(messageCopyText(onlyTool)).toBeNull();
    expect(messageCopyText(onlyThinking)).toBeNull();
  });

  test("system, tool result, and custom items are not copied", () => {
    const system: ItemRecord = {
      itemId: itm(4),
      status: "completed",
      kind: "system",
      message: { role: "system", content: "지침", timestamp: 0 },
    };
    const toolResult: ItemRecord = {
      itemId: itm(5),
      status: "completed",
      kind: "toolResult",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "결과" }],
        isError: false,
        timestamp: 0,
      },
      effectId: null,
    };
    const custom: ItemRecord = {
      itemId: itm(6),
      status: "completed",
      kind: "custom",
      message: {
        role: "custom",
        customType: "x.demo.note.line",
        content: "기록",
        display: true,
        details: null,
        timestamp: 0,
      },
    };
    expect(messageCopyText(system)).toBeNull();
    expect(messageCopyText(toolResult)).toBeNull();
    expect(messageCopyText(custom)).toBeNull();
  });
});
