import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  InputRequiredInfoSchema,
  ReplayPolicySchema,
  ResultStatusSchema,
  ToolResultRecordSchema,
  resultStatusOf,
  toReplayPolicy,
  toToolResultRecord,
} from "../../src/conversation/index.ts";
import { usage } from "./fixtures/pi-messages.ts";

describe("ResultStatus", () => {
  test("resultStatusOf defaults to complete", () => {
    expect(resultStatusOf({})).toBe("complete");
    expect(resultStatusOf({ status: "input_required" })).toBe("input_required");
    expect(parse(ResultStatusSchema, "error").ok).toBe(false);
  });
});

describe("toToolResultRecord", () => {
  test("maps absent optionals to null/false and passes the schema", () => {
    const record = toToolResultRecord({
      content: [{ type: "text", text: "ok" }],
      details: undefined,
    });
    expect(record).toEqual({
      content: [{ type: "text", text: "ok" }],
      details: null,
      structuredContent: null,
      isError: false,
      terminate: false,
      usage: null,
    });
    expect(parse(ToolResultRecordSchema, JSON.parse(JSON.stringify(record))).ok).toBe(true);
  });

  test("keeps the three channels and flags", () => {
    const record = toToolResultRecord({
      content: [{ type: "text", text: "model" }],
      details: { ui: 1 },
      structuredContent: { out: [1, 2] },
      usage,
      isError: true,
      terminate: true,
    });
    expect(record.details).toEqual({ ui: 1 });
    expect(record.structuredContent).toEqual({ out: [1, 2] });
    expect(record.isError).toBe(true);
    expect(record.terminate).toBe(true);
    expect(record.usage).toEqual(usage);
    expect(parse(ToolResultRecordSchema, record).ok).toBe(true);
  });

  test("input_required status carries its info", () => {
    const record = toToolResultRecord({ content: [], details: null });
    const tagged = {
      ...record,
      status: "input_required",
      inputRequired: { inputRequests: { q: 1 }, requestState: "s" },
    };
    expect(parse(ToolResultRecordSchema, tagged).ok).toBe(true);
    expect(parse(InputRequiredInfoSchema, { inputRequests: null, requestState: null }).ok).toBe(
      true,
    );
    expect(parse(ToolResultRecordSchema, { ...record, status: "weird" }).ok).toBe(false);
  });
});

describe("replay policy", () => {
  test("never and undefined are unsafe, safe is safe", () => {
    expect(toReplayPolicy("never")).toBe("unsafe");
    expect(toReplayPolicy(undefined)).toBe("unsafe");
    expect(toReplayPolicy("safe")).toBe("safe");
  });

  test("the schema accepts the two values only", () => {
    expect(parse(ReplayPolicySchema, "safe").ok).toBe(true);
    expect(parse(ReplayPolicySchema, "unsafe").ok).toBe(true);
    expect(parse(ReplayPolicySchema, "never").ok).toBe(false);
  });
});
