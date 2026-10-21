import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  AgentMessageSchema,
  AssistantMessageEventSchema,
  AssistantMessageSchema,
  ImageContentSchema,
  MessageSchema,
  StopReasonSchema,
  TextContentSchema,
  ThinkingContentSchema,
  ToolCallSchema,
  ToolResultMessageSchema,
  UsageSchema,
  UserMessageSchema,
  SystemMessageSchema,
} from "../../src/conversation/index.ts";
import {
  ALL_MESSAGE_FIXTURES,
  assistantAborted,
  assistantArgumentsError,
  assistantStop,
  systemMessage,
  toolResult,
  usage,
  userText,
} from "./fixtures/pi-messages.ts";

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("Unsafe wrapping still validates (spec 3.3 assumption 4)", () => {
  test("a bare user role without content is rejected", () => {
    expect(parse(MessageSchema, { role: "user" }).ok).toBe(false);
  });
});

describe("fixture round trip", () => {
  for (const [index, fixture] of ALL_MESSAGE_FIXTURES.entries()) {
    test(`fixture ${index} (${fixture.role}) survives JSON round trip`, () => {
      expect(parse(MessageSchema, roundTrip(fixture)).ok).toBe(true);
      expect(parse(AgentMessageSchema, roundTrip(fixture)).ok).toBe(true);
    });
  }

  test("each role-specific schema accepts its own role only", () => {
    expect(parse(SystemMessageSchema, systemMessage).ok).toBe(true);
    expect(parse(UserMessageSchema, userText).ok).toBe(true);
    expect(parse(AssistantMessageSchema, assistantStop).ok).toBe(true);
    expect(parse(ToolResultMessageSchema, toolResult).ok).toBe(true);
    expect(parse(UserMessageSchema, toolResult).ok).toBe(false);
    expect(parse(ToolResultMessageSchema, assistantStop).ok).toBe(false);
  });

  test("argumentsError and aborted assistants are kept as-is", () => {
    expect(parse(MessageSchema, roundTrip(assistantArgumentsError)).ok).toBe(true);
    expect(parse(MessageSchema, roundTrip(assistantAborted)).ok).toBe(true);
  });
});

describe("discrimination", () => {
  test("unknown role fails", () => {
    expect(parse(MessageSchema, { ...assistantStop, role: "assistant2" }).ok).toBe(false);
  });

  test("deferred stop reason passes, unknown fails", () => {
    expect(parse(MessageSchema, { ...assistantStop, stopReason: "deferred" }).ok).toBe(true);
    expect(parse(MessageSchema, { ...assistantStop, stopReason: "unknown" }).ok).toBe(false);
  });

  test("custom role is only an AgentMessage", () => {
    const custom = {
      role: "custom",
      customType: "grp.helm.item.tagged",
      content: "x",
      display: true,
      details: null,
      timestamp: 1,
    };
    expect(parse(AgentMessageSchema, custom).ok).toBe(true);
    expect(parse(MessageSchema, custom).ok).toBe(false);
  });
});

describe("optional field tolerance", () => {
  test("unknown fields do not fail validation", () => {
    for (const fixture of ALL_MESSAGE_FIXTURES) {
      expect(parse(MessageSchema, { ...fixture, futureField: { a: 1 } }).ok).toBe(true);
    }
  });

  test("nested objects tolerate unknown fields too", () => {
    expect(
      parse(UsageSchema, { ...usage, newCounter: 1, cost: { ...usage.cost, extra: 1 } }).ok,
    ).toBe(true);
  });
});

describe("block schemas", () => {
  test("text, thinking, image, toolCall", () => {
    expect(parse(TextContentSchema, { type: "text", text: "a" }).ok).toBe(true);
    expect(parse(TextContentSchema, { type: "text" }).ok).toBe(false);
    expect(parse(ThinkingContentSchema, { type: "thinking", thinking: "a" }).ok).toBe(true);
    expect(parse(ImageContentSchema, { type: "image", data: "x", mimeType: "image/png" }).ok).toBe(
      true,
    );
    expect(parse(ToolCallSchema, { type: "toolCall", id: "", name: "n", arguments: {} }).ok).toBe(
      false,
    );
    expect(parse(ToolCallSchema, { type: "toolCall", id: "i", name: "n", arguments: {} }).ok).toBe(
      true,
    );
  });

  test("usage requires all counters", () => {
    expect(parse(UsageSchema, usage).ok).toBe(true);
    expect(parse(UsageSchema, { input: 1 }).ok).toBe(false);
  });

  test("stop reason and assistant events", () => {
    expect(parse(StopReasonSchema, "toolUse").ok).toBe(true);
    expect(parse(StopReasonSchema, "nope").ok).toBe(false);
    expect(parse(AssistantMessageEventSchema, { type: "text_delta", delta: "x" }).ok).toBe(true);
    expect(parse(AssistantMessageEventSchema, { type: "nope" }).ok).toBe(false);
  });
});
