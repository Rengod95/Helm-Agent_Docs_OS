import { expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { saltAssistantMessage, saltStreamEvent, toolCallSalt } from "../src/loop/tool-call-ids.ts";
import { createHarness } from "./support/harness.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// L1.loop.spec §3.3 규칙 7: 제공자가 응답마다 같은 도구 호출 id를 다시 쓰면 단계 id 끝 8자를 붙여 대화 안에서 유일하게 만든다.

const text = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

const callRead = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } }],
  stopReason: "toolUse",
});

/** 학습 제안 id 유도(group-learning/src/review/propose.ts)와 같은 식: `prop_` + sha256 hex 앞 26자 대문자 */
function proposalIdOf(toolCallId: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(toolCallId).digest("hex");
  return `prop_${digest.slice(0, 26).toUpperCase()}`;
}

test("a_provider_id_reused_in_two_turns_reaches_the_tool_as_two_distinct_salted_ids", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [callRead("dup"), text("first done"), callRead("dup"), text("second done")],
  });
  await h.loop.admit({ threadId: h.threadId, content: "one", via: "interactive" });
  await h.settle();
  await h.loop.admit({ threadId: h.threadId, content: "two", via: "interactive" });
  await h.settle();

  const ids = h.tools.executed;
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) {
    expect(id.startsWith("dup_")).toBe(true);
    expect(id).toMatch(/^dup_[0-9A-Z]{8}$/);
  }
  // 두 호출 id에서 만든 학습 제안 id는 겹치지 않는다(충돌 0)
  expect(new Set(ids.map(proposalIdOf)).size).toBe(ids.length);
});

const SALT = "ABCD2345";

function usageOf(total: number) {
  return {
    input: total,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: total,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantWith(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "fake-api",
    provider: "fake",
    model: "fake-1",
    usage: usageOf(0),
    stopReason: "toolUse",
    timestamp: 0,
  };
}

test("tool_call_salt_is_the_last_eight_characters_of_the_step_id", () => {
  const stepId = fixedIdFactory(7).next("stp");
  expect(toolCallSalt(stepId)).toBe(stepId.slice(-8));
  expect(toolCallSalt(stepId)).toMatch(/^[0-9A-Z]{8}$/);
});

test("salt_assistant_message_keeps_non_tool_call_blocks_and_salts_only_tool_calls", () => {
  const message = assistantWith([
    { type: "text", text: "hi" },
    { type: "thinking", thinking: "hmm" },
    { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.txt" } },
  ]);
  const salted = saltAssistantMessage(message, SALT);
  expect(salted.content).toEqual([
    { type: "text", text: "hi" },
    { type: "thinking", thinking: "hmm" },
    { type: "toolCall", id: `c1_${SALT}`, name: "read", arguments: { path: "a.txt" } },
  ]);
  // 원본 메시지는 바뀌지 않는다
  expect(message.content).toContainEqual({
    type: "toolCall",
    id: "c1",
    name: "read",
    arguments: { path: "a.txt" },
  });
});

test("salt_assistant_message_returns_a_message_without_tool_calls_as_it_is", () => {
  const message = assistantWith([{ type: "text", text: "plain" }]);
  expect(saltAssistantMessage(message, SALT)).toBe(message);
});

test("salt_assistant_message_does_not_add_the_salt_twice", () => {
  const message = assistantWith([{ type: "toolCall", id: "c1", name: "read", arguments: {} }]);
  const once = saltAssistantMessage(message, SALT);
  const twice = saltAssistantMessage(once, SALT);
  expect(twice).toEqual(once);
  expect(twice.content).toEqual([
    { type: "toolCall", id: `c1_${SALT}`, name: "read", arguments: {} },
  ]);
});

test("salt_stream_event_salts_toolcall_end_and_its_partial_message", () => {
  const toolCall = { type: "toolCall" as const, id: "c1", name: "read", arguments: {} };
  const partial = assistantWith([toolCall]);
  const event: AssistantMessageEvent = { type: "toolcall_end", contentIndex: 0, toolCall, partial };
  expect(saltStreamEvent(event, SALT)).toEqual({
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { type: "toolCall", id: `c1_${SALT}`, name: "read", arguments: {} },
    partial: assistantWith([{ type: "toolCall", id: `c1_${SALT}`, name: "read", arguments: {} }]),
  });
});

test("salt_stream_event_salts_the_partial_of_a_start_event_and_passes_done_through", () => {
  const partial = assistantWith([{ type: "toolCall", id: "c2", name: "read", arguments: {} }]);
  const start: AssistantMessageEvent = { type: "start", partial };
  expect(saltStreamEvent(start, SALT)).toEqual({
    type: "start",
    partial: assistantWith([{ type: "toolCall", id: `c2_${SALT}`, name: "read", arguments: {} }]),
  });
  const done: AssistantMessageEvent = { type: "done", reason: "stop", message: partial };
  expect(saltStreamEvent(done, SALT)).toBe(done);
});
