import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  AssistantMessageSchema,
  DeepJsonValueSchema,
  SystemMessageSchema,
  ToolCallSchema,
  ToolResultMessageSchema,
} from "../../src/conversation/index.ts";
import { assistantStop, systemMessage, toolResult } from "./fixtures/pi-messages.ts";

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const call = { type: "toolCall", id: "c1", name: "read", arguments: { a: [1, { b: null }] } };

describe("deep pi message validation (M3-REQ-20)", () => {
  test("DeepJsonValueSchema checks nested values", () => {
    expect(parse(DeepJsonValueSchema, { a: [1, "x", null, { b: true }] }).ok).toBe(true);
    expect(parse(DeepJsonValueSchema, { a: [1, { b: undefined }] }).ok).toBe(false);
    expect(parse(DeepJsonValueSchema, { a: [Number.NaN] }).ok).toBe(false);
  });

  test("tool call arguments must be a JSON object all the way down", () => {
    expect(parse(ToolCallSchema, roundTrip(call)).ok).toBe(true);
    expect(parse(ToolCallSchema, { ...call, arguments: { a: () => 1 } }).ok).toBe(false);
    expect(parse(ToolCallSchema, { ...call, arguments: [] }).ok).toBe(false);
    expect(parse(ToolCallSchema, { ...call, thoughtSignature: 3 }).ok).toBe(false);
  });

  test("assistant optional fields are typed", () => {
    const ok = {
      ...assistantStop,
      diagnostics: [{ type: "retry", timestamp: 1, error: { message: "x", code: 5 } }],
      deferred: { provider: "p", modelId: "m", api: "a", id: "i", data: { k: [1] } },
      thinkingLevel: "high",
      durationMs: 12,
    };
    expect(parse(AssistantMessageSchema, roundTrip(ok)).ok).toBe(true);
    expect(parse(AssistantMessageSchema, { ...ok, diagnostics: [{ type: "retry" }] }).ok).toBe(
      false,
    );
    expect(parse(AssistantMessageSchema, { ...ok, deferred: { provider: "p" } }).ok).toBe(false);
    expect(parse(AssistantMessageSchema, { ...ok, thinkingLevel: "ultra" }).ok).toBe(false);
    expect(
      parse(AssistantMessageSchema, {
        ...ok,
        content: [{ type: "thinking", thinking: "t", redacted: "yes" }],
      }).ok,
    ).toBe(false);
  });

  test("system message tool declarations and sections are typed", () => {
    const ok = {
      ...systemMessage,
      toolsAdded: [{ name: "t", description: "d", parameters: { type: "object" } }],
      toolsRemoved: [{ name: "u" }],
    };
    expect(parse(SystemMessageSchema, roundTrip(ok)).ok).toBe(true);
    expect(parse(SystemMessageSchema, { ...ok, toolsAdded: [{ name: "t" }] }).ok).toBe(false);
    expect(parse(SystemMessageSchema, { ...ok, sections: { a: 1 } }).ok).toBe(false);
  });

  test("tool result details, usage and nested calls are typed", () => {
    const ok = {
      ...toolResult,
      details: { files: ["a"] },
      nestedCalls: { calls: [{ id: "n", name: "x", status: "ok" }], complete: true },
      durationMs: 3,
    };
    expect(parse(ToolResultMessageSchema, roundTrip(ok)).ok).toBe(true);
    expect(
      parse(ToolResultMessageSchema, {
        ...ok,
        nestedCalls: { calls: [{ id: "n", name: "x", status: "weird" }], complete: true },
      }).ok,
    ).toBe(false);
    expect(parse(ToolResultMessageSchema, { ...ok, details: { x: Number.NaN } }).ok).toBe(false);
    expect(parse(ToolResultMessageSchema, { ...ok, usage: { input: 1 } }).ok).toBe(false);
  });
});
