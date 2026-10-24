import { describe, expect, test } from "bun:test";
import { WIRE_LIMITS, checkEnvelope } from "../../src/wire-settings/wire/index.ts";

const request = { jsonrpc: "2.0", id: "r1", method: "turn.start", params: {} };

/** 가장 바깥 객체를 1로 세어 depth만큼 중첩된 객체 */
function nested(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = {};
  for (let level = 1; level < depth; level += 1) node = { child: node };
  return node;
}

describe("checkEnvelope", () => {
  test("accepts the four message shapes", () => {
    expect(checkEnvelope(request).ok).toBe(true);
    expect(
      checkEnvelope({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: "r1" } }).ok,
    ).toBe(true);
    expect(checkEnvelope({ jsonrpc: "2.0", id: "r1", result: {} }).ok).toBe(true);
    const failure = {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: "m",
        data: { kind: "jsonrpc.invalidRequest", retryable: false },
      },
    };
    expect(checkEnvelope(failure).ok).toBe(true);
  });

  test("rejects batch", () => {
    const result = checkEnvelope([request]);
    expect(result).toEqual({ ok: false, errorCode: -32600, issue: { code: "batch" } });
    expect(checkEnvelope([]).ok).toBe(false);
  });

  test("rejects numeric id", () => {
    const result = checkEnvelope({ ...request, id: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe(-32600);
  });

  test("rejects null id on request", () => {
    const result = checkEnvelope({ ...request, id: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe(-32600);
  });

  test("rejects ids outside the allowed alphabet", () => {
    for (const id of ["", "a b", "x".repeat(65), "한글"]) {
      expect(checkEnvelope({ ...request, id }).ok).toBe(false);
    }
    expect(checkEnvelope({ ...request, id: "A.b_c:d-e" }).ok).toBe(true);
  });

  test("rejects array params", () => {
    const result = checkEnvelope({ ...request, params: [] });
    expect(result).toEqual({
      ok: false,
      errorCode: -32602,
      issue: { code: "schema", path: "/params", message: "params must be an object" },
    });
  });

  test("rejects other non-object params as invalid request", () => {
    const result = checkEnvelope({ ...request, params: "x" });
    expect(result.ok).toBe(false);
  });

  test("rejects depth 65", () => {
    const tooDeep = checkEnvelope({ ...request, params: nested(WIRE_LIMITS.maxDepth - 1) });
    // 바깥 envelope(1) + params 중첩 63 = 64
    expect(tooDeep.ok).toBe(true);
    const result = checkEnvelope({ ...request, params: nested(WIRE_LIMITS.maxDepth) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(-32600);
      expect(result.issue).toEqual({ code: "depth", depth: 65 });
    }
  });

  test("a cyclic value is rejected by the depth limit", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const result = checkEnvelope({ ...request, params: cyclic });
    expect(result.ok).toBe(false);
  });

  test("rejects long array", () => {
    const ok = checkEnvelope({
      ...request,
      params: { items: Array.from({ length: 10_000 }, () => 0) },
    });
    expect(ok.ok).toBe(true);
    const result = checkEnvelope({
      ...request,
      params: { items: Array.from({ length: 10_001 }, () => 0) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(-32600);
      expect(result.issue).toEqual({ code: "arrayLength", length: 10_001 });
    }
  });

  test("rejects extra envelope keys", () => {
    const result = checkEnvelope({ ...request, extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe(-32600);
    expect(checkEnvelope({ ...request, jsonrpc: "1.0" }).ok).toBe(false);
  });

  test("accepts empty params", () => {
    expect(checkEnvelope({ ...request, params: {} }).ok).toBe(true);
  });

  test("a request without params is invalid (params is always an object)", () => {
    expect(checkEnvelope({ jsonrpc: "2.0", id: "r1", method: "turn.start" }).ok).toBe(false);
  });

  test("result must be an object", () => {
    expect(checkEnvelope({ jsonrpc: "2.0", id: "r1", result: [] }).ok).toBe(false);
    expect(checkEnvelope({ jsonrpc: "2.0", id: "r1", result: "ok" }).ok).toBe(false);
  });

  test("rejects method names that break the rule", () => {
    const result = checkEnvelope({ ...request, method: "Turn.start" });
    expect(result).toEqual({
      ok: false,
      errorCode: -32600,
      issue: { code: "methodName", method: "Turn.start" },
    });
    expect(checkEnvelope({ jsonrpc: "2.0", method: "turn_start", params: {} }).ok).toBe(false);
  });

  test("non-object values are invalid requests", () => {
    for (const value of [null, 1, "x", true, undefined]) {
      const result = checkEnvelope(value);
      expect(result.ok).toBe(false);
    }
  });

  test("limits are the documented numbers", () => {
    expect(WIRE_LIMITS).toEqual({
      maxDepth: 64,
      maxArrayLength: 10_000,
      maxFrameBytes: 1_048_576,
      maxMethodNameLength: 96,
    });
  });
});
