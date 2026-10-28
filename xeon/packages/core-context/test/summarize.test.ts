import { describe, expect, test } from "bun:test";
import type { Message } from "@xeon/contracts/conversation";
import {
  computeFileLists,
  extractFileOps,
  formatFileOperations,
  fileOpsFromDetails,
  serializeConversation,
} from "../src/compaction/summarize.ts";
import {
  SUMMARIZATION_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  TURN_PREFIX_SUMMARIZATION_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
} from "../src/compaction/prompts.ts";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantWith(content: Extract<Message, { role: "assistant" }>["content"]): Message {
  return {
    role: "assistant",
    content,
    api: "x",
    provider: "x",
    model: "x",
    usage,
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("serializeConversation", () => {
  test("writes a transcript, truncates long tool results and leaves system messages out", () => {
    const messages: Message[] = [
      { role: "system", content: "prompt state", timestamp: 0 },
      { role: "user", content: "hello", timestamp: 1 },
      assistantWith([
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "answer" },
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts", limit: 5 } },
      ]),
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "y".repeat(2500) }],
        isError: false,
        timestamp: 2,
      },
    ];
    const text = serializeConversation(messages);
    expect(text).not.toContain("prompt state");
    expect(text).toContain("[User]: hello");
    expect(text).toContain("[Assistant thinking]: hmm");
    expect(text).toContain("[Assistant]: answer");
    expect(text).toContain('[Assistant tool calls]: read(path="a.ts", limit=5)');
    expect(text).toContain("[... 500 more characters truncated]");
    expect(text.indexOf("[User]")).toBeLessThan(text.indexOf("[Assistant]:"));
  });
});

describe("file operations", () => {
  test("read and modified paths come from tool calls and a modified file leaves the read list", () => {
    const ops = extractFileOps(
      [
        assistantWith([
          { type: "toolCall", id: "1", name: "read", arguments: { path: "a.ts" } },
          { type: "toolCall", id: "2", name: "read", arguments: { path: "b.ts" } },
          { type: "toolCall", id: "3", name: "edit", arguments: { path: "b.ts" } },
          { type: "toolCall", id: "4", name: "write", arguments: { path: "c.ts" } },
          { type: "toolCall", id: "5", name: "bash", arguments: { path: "ignored" } },
          { type: "toolCall", id: "6", name: "read", arguments: {} },
        ]),
      ],
      { read: ["old.ts"], modified: [] },
    );
    expect(computeFileLists(ops)).toEqual({
      readFiles: ["a.ts", "old.ts"],
      modifiedFiles: ["b.ts", "c.ts"],
    });
    expect(formatFileOperations(["a.ts"], ["b.ts"])).toBe(
      "\n\n<read-files>\na.ts\n</read-files>\n\n<modified-files>\nb.ts\n</modified-files>",
    );
    expect(formatFileOperations([], [])).toBe("");
  });

  test("details from an earlier compaction are read defensively", () => {
    expect(fileOpsFromDetails({ readFiles: ["a"], modifiedFiles: ["b", 3] })).toEqual({
      read: ["a"],
      modified: ["b"],
    });
    expect(fileOpsFromDetails(null)).toEqual({ read: [], modified: [] });
    expect(fileOpsFromDetails([1])).toEqual({ read: [], modified: [] });
  });
});

describe("prompts", () => {
  test("the pi prompts are copied with their section headings", () => {
    expect(SUMMARIZATION_SYSTEM_PROMPT).toStartWith("You are a context summarization assistant.");
    expect(SUMMARIZATION_PROMPT).toContain("## Goal");
    expect(SUMMARIZATION_PROMPT).toContain("## Critical Context");
    expect(UPDATE_SUMMARIZATION_PROMPT).toContain("<previous-summary>");
    expect(UPDATE_SUMMARIZATION_PROMPT).toContain("PRESERVE all existing information");
    expect(TURN_PREFIX_SUMMARIZATION_PROMPT).toContain("## Original Request");
  });
});
