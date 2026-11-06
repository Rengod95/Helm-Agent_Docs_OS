import { expect, test } from "bun:test";
import type { AssistantMessage } from "@fresnel/contracts/conversation";
import { keepReceivedText } from "../src/loop/partial-content.ts";

function message(
  stopReason: AssistantMessage["stopReason"],
  content: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

test("an aborted response that lost the streamed text gets the received text back", () => {
  const partial = message("stop", [
    { type: "thinking", thinking: "hm" },
    { type: "text", text: "1\n2\n3" },
    { type: "toolCall", id: "c", name: "read", arguments: {} },
  ]);
  const final = message("aborted", [{ type: "thinking", thinking: "hm" }]);
  expect(keepReceivedText(final, partial).content).toEqual([
    { type: "thinking", thinking: "hm" },
    { type: "text", text: "1\n2\n3" },
  ]);
});

test("a complete aborted response and non-aborted responses are left alone", () => {
  const partial = message("stop", [{ type: "text", text: "ab" }]);
  const full = message("aborted", [{ type: "text", text: "abc" }]);
  expect(keepReceivedText(full, partial)).toBe(full);
  const ok = message("stop", []);
  expect(keepReceivedText(ok, partial)).toBe(ok);
  expect(keepReceivedText(full, null)).toBe(full);
});
