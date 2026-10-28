import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { CallerIdSchema, ToolHintsSchema, ToolRiskSchema } from "../../src/capabilities/index.ts";
import {
  ToolCallPayloadSchema,
  ToolExecutionEndPayloadSchema,
  ToolResultPayloadSchema,
} from "../../src/extensions/index.ts";
import { rawId } from "../helpers/ids.ts";

const base = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };
const full = { ...base, risk: "write", hints: { destructive: true }, caller: "subagent:review" };

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

describe("ToolCallPayload risk, hints, caller (M3-REQ-04)", () => {
  test("a full payload parses and keeps the three fields", () => {
    const result = parse(ToolCallPayloadSchema, full);
    const value: unknown = result.ok ? result.value : undefined;
    expect(value).toEqual(full);
  });

  test("risk, caller and hints are optional until L1.tools fills them, and a payload without them still parses", () => {
    expect(accepts(ToolCallPayloadSchema, base)).toBe(true);
    expect(accepts(ToolCallPayloadSchema, { ...base, risk: "read", caller: "main" })).toBe(true);
    expect(accepts(ToolCallPayloadSchema, { ...base, caller: "main" })).toBe(true);
    expect(accepts(ToolCallPayloadSchema, { ...base, risk: "read" })).toBe(true);
    // 값이 있으면 검사한다
    expect(accepts(ToolCallPayloadSchema, { ...base, risk: undefined, caller: undefined })).toBe(
      true,
    );
  });

  test("rejects unknown risk, caller shapes and hint keys", () => {
    for (const risk of ["delete", "", 1]) {
      expect(accepts(ToolCallPayloadSchema, { ...full, risk })).toBe(false);
    }
    for (const caller of ["", "sub", "subagent:", "background", "ext:x", "Main"]) {
      expect(accepts(ToolCallPayloadSchema, { ...full, caller })).toBe(false);
    }
    expect(accepts(ToolCallPayloadSchema, { ...full, hints: { fast: true } })).toBe(false);
  });

  test("ToolResultPayload carries the same three fields", () => {
    expect(accepts(ToolResultPayloadSchema, full)).toBe(true);
    expect(accepts(ToolResultPayloadSchema, base)).toBe(true);
    expect(accepts(ToolResultPayloadSchema, { ...full, risk: "delete" })).toBe(false);
    expect(accepts(ToolResultPayloadSchema, { ...full, caller: "sub" })).toBe(false);
  });

  test("shared value schemas", () => {
    expect(["read", "write", "exec"].map((v) => accepts(ToolRiskSchema, v))).toEqual([
      true,
      true,
      true,
    ]);
    expect(accepts(CallerIdSchema, "subagent:review")).toBe(true);
    expect(accepts(ToolHintsSchema, {})).toBe(true);
  });
});

describe("ToolExecutionEndPayload input and stepId (M3-REQ-04)", () => {
  const end = {
    toolCallId: "call_1",
    toolName: "read",
    input: { path: "a" },
    stepId: rawId("stp", 1),
    result: "ok",
    isError: false,
  };

  test("parses with input and stepId", () => {
    const result = parse(ToolExecutionEndPayloadSchema, end);
    const value: unknown = result.ok ? result.value : undefined;
    expect(value).toEqual(end);
  });

  test("input and stepId are optional, but a given stepId must be an stp id and input an object", () => {
    const { toolCallId, toolName, result, isError } = end;
    expect(accepts(ToolExecutionEndPayloadSchema, { toolCallId, toolName, result, isError })).toBe(
      true,
    );
    expect(accepts(ToolExecutionEndPayloadSchema, { ...end, stepId: "step_1" })).toBe(false);
    expect(accepts(ToolExecutionEndPayloadSchema, { ...end, input: "a.txt" })).toBe(false);
  });
});
