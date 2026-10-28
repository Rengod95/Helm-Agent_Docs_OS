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

  test("risk and caller are required, hints is optional", () => {
    expect(accepts(ToolCallPayloadSchema, { ...base, risk: "read", caller: "main" })).toBe(true);
    expect(accepts(ToolCallPayloadSchema, { ...base, caller: "main" })).toBe(false);
    expect(accepts(ToolCallPayloadSchema, { ...base, risk: "read" })).toBe(false);
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
    expect(accepts(ToolResultPayloadSchema, base)).toBe(false);
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

  test("input and stepId are required, stepId must be an stp id", () => {
    const noInput = { ...end, input: undefined };
    const noStep = { ...end, stepId: undefined };
    expect(accepts(ToolExecutionEndPayloadSchema, noInput)).toBe(false);
    expect(accepts(ToolExecutionEndPayloadSchema, noStep)).toBe(false);
    expect(accepts(ToolExecutionEndPayloadSchema, { ...end, stepId: "step_1" })).toBe(false);
  });
});
