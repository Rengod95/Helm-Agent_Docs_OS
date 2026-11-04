import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import {
  ItemIdSchema,
  type ItemRecord,
  type ToolResultMessage,
} from "@fresnel/contracts/conversation";
import {
  renderItemMarkdown,
  renderMarkdownHeader,
  renderUnreadableMarkdown,
  TOOL_RESULT_CHAR_LIMIT,
} from "../../src/export/thread-markdown.ts";

// thread.export의 markdown 본문(F.wire-settings.spec §3.4.7 [제안]). 입력은 이미 가림을 거친 item이다.

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function itemId(n: number) {
  const parsed = parse(ItemIdSchema, `itm_${"0".repeat(22)}${String(n).padStart(4, "0")}`);
  if (!parsed.ok) throw new Error("bad test item id");
  return parsed.value;
}

function toolResult(text: string, isError = false): ItemRecord {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "run",
    content: [{ type: "text", text }],
    isError,
    timestamp: 1,
  };
  return { itemId: itemId(1), status: "completed", kind: "toolResult", effectId: null, message };
}

test("a thinking block is not exported and a failed assistant item carries a status line", () => {
  const item: ItemRecord = {
    itemId: itemId(2),
    status: "failed",
    kind: "assistant",
    partIds: [],
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "생각만 한다" },
        { type: "text", text: "답을 못 했다." },
      ],
      api: "test",
      provider: "test",
      model: "tape",
      usage: USAGE,
      stopReason: "error",
      errorMessage: "제공자 오류",
      timestamp: 1,
    },
  };
  expect(renderItemMarkdown(item)).toBe(
    "## Assistant\n\n_status: failed_\n\n답을 못 했다.\n\nerror: 제공자 오류\n\n",
  );
});

test("a tool result is fenced and cut after the character limit with a visible marker", () => {
  const long = "a".repeat(TOOL_RESULT_CHAR_LIMIT + 500);
  expect(renderItemMarkdown(toolResult(long))).toBe(
    `## Tool result: run\n\n\`\`\`\n${"a".repeat(TOOL_RESULT_CHAR_LIMIT)}\n\`\`\`\n\n_(truncated after 2000 characters)_\n\n`,
  );
});

test("a tool result at exactly the limit is not marked as cut", () => {
  const exact = "b".repeat(TOOL_RESULT_CHAR_LIMIT);
  expect(renderItemMarkdown(toolResult(exact, true))).toBe(
    `## Tool result: run (error)\n\n\`\`\`\n${exact}\n\`\`\`\n\n`,
  );
});

test("a fence is longer than any backtick run inside the text", () => {
  expect(renderItemMarkdown(toolResult("```js\ncode\n```"))).toBe(
    "## Tool result: run\n\n````\n```js\ncode\n```\n````\n\n",
  );
});

test("an empty tool result says so instead of printing an empty fence", () => {
  expect(renderItemMarkdown(toolResult(""))).toBe("## Tool result: run\n\n_(no result)_\n\n");
});

test("an image is one placeholder line with its MIME type and no data", () => {
  const item: ItemRecord = {
    itemId: itemId(3),
    status: "completed",
    kind: "user",
    requestId: null,
    message: {
      role: "user",
      content: [{ type: "image", data: "aGk=", mimeType: "image/jpeg" }],
      timestamp: 1,
    },
  };
  expect(renderItemMarkdown(item)).toBe("## User\n\n[image: image/jpeg]\n\n");
});

test("an extension message shows its custom type and not its details", () => {
  const item: ItemRecord = {
    itemId: itemId(4),
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType: "x.demo.note",
      content: "확장이 남긴 글",
      display: true,
      details: { secret: "not shown" },
      timestamp: 1,
    },
  };
  expect(renderItemMarkdown(item)).toBe("## Extension message: x.demo.note\n\n확장이 남긴 글\n\n");
});

test("an unreadable item keeps only its role heading and the placeholder", () => {
  expect(renderUnreadableMarkdown("toolResult")).toBe("## Tool result\n\n[unreadable item]\n\n");
  expect(renderUnreadableMarkdown("user")).toBe("## User\n\n[unreadable item]\n\n");
});

test("the document header is a title line, the thread id, and the item total", () => {
  expect(renderMarkdownHeader({ title: "회의 메모", threadId: "thr_x", itemTotal: 3 })).toBe(
    "# 회의 메모\n\n- Thread ID: thr_x\n- Items: 3\n\n",
  );
});
