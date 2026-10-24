import { expect, test } from "bun:test";
import type { AgentToolCall, JsonObject } from "@xeon/contracts/conversation";
import { Type } from "typebox";
import { validateToolArguments } from "../src/validate.ts";

// adr.0009 §3.4, L1.loop.plan LP18 첫 시험. pi-ai 1.3.0 validateToolArguments의 TypeBox 경로와 같은 결과를 내는지
// 사례로 고정한다(선택 null 제거, 문자열 → 숫자·불리언 변환, 오류 문장, 입력 불변).

const SCHEMA = Type.Object({
  path: Type.String(),
  limit: Type.Optional(Type.Integer()),
  flag: Type.Optional(Type.Boolean()),
  tags: Type.Optional(Type.Array(Type.String())),
});

function callOf(args: JsonObject, extra: Partial<AgentToolCall> = {}): AgentToolCall {
  return { type: "toolCall", id: "c1", name: "read", arguments: args, ...extra };
}

test("string numbers and booleans are converted to the schema types", () => {
  const out = validateToolArguments(SCHEMA, callOf({ path: "a", limit: "5", flag: "true" }));
  expect(out.ok && out.value).toEqual({ path: "a", limit: 5, flag: true });
});

test("a null for an optional property that does not accept null is dropped", () => {
  const out = validateToolArguments(SCHEMA, callOf({ path: "a", limit: null, tags: null }));
  expect(out.ok && out.value).toEqual({ path: "a" });
});

test("a number for a string property is converted to its text", () => {
  const out = validateToolArguments(SCHEMA, callOf({ path: 7 }));
  expect(out.ok && out.value).toEqual({ path: "7" });
});

test("a missing required property is reported with the tool name and the received arguments", () => {
  const out = validateToolArguments(SCHEMA, callOf({ limit: 1 }));
  expect(out.ok).toBe(false);
  if (out.ok) return;
  expect(out.error.kind).toBe("invalid_arguments");
  expect(out.error.message).toContain('Validation failed for tool "read"');
  expect(out.error.message).toContain("Received arguments");
});

test("a value that cannot be converted is reported", () => {
  const out = validateToolArguments(SCHEMA, callOf({ path: "a", limit: "many" }));
  expect(out.ok).toBe(false);
});

test("argumentsError from the provider stream is reported before validation", () => {
  const out = validateToolArguments(
    SCHEMA,
    callOf({ path: "a" }, { argumentsError: "Unexpected end of JSON input" }),
  );
  expect(out.ok).toBe(false);
  if (out.ok) return;
  expect(out.error.message).toBe('Invalid arguments for tool "read": Unexpected end of JSON input');
});

test("the call arguments are never modified", () => {
  const args = { path: "a", limit: "5", extra: null };
  const call = callOf(args);
  validateToolArguments(SCHEMA, call);
  expect(call.arguments).toEqual({ path: "a", limit: "5", extra: null });
});

test("nested optional nulls inside arrays of objects are dropped too", () => {
  const nested = Type.Object({
    items: Type.Array(Type.Object({ id: Type.String(), note: Type.Optional(Type.String()) })),
  });
  const out = validateToolArguments(
    nested,
    callOf({
      items: [
        { id: "x", note: null },
        { id: "y", note: "kept" },
      ],
    }),
  );
  expect(out.ok && out.value).toEqual({ items: [{ id: "x" }, { id: "y", note: "kept" }] });
});
