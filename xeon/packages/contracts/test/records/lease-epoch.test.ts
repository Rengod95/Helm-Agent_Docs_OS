import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { LeaseAcquiredPayloadSchema } from "../../src/records/index.ts";

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

describe("lease.acquired leaseEpoch (M3-REQ-08)", () => {
  const acquired = {
    leaseId: "lease-1",
    lineageId: "lease-1",
    scopeId: "helm",
    limits: { maxTurns: 4 },
  };

  test("accepts a positive integer and keeps it", () => {
    const result = parse(LeaseAcquiredPayloadSchema, { ...acquired, leaseEpoch: 3 });
    const value: unknown = result.ok ? result.value : undefined;
    expect(value).toEqual({ ...acquired, leaseEpoch: 3 });
  });

  test("is optional so old records still parse", () => {
    expect(accepts(LeaseAcquiredPayloadSchema, acquired)).toBe(true);
  });

  test("requires a lineageId and keeps it distinct from the leaseId", () => {
    const inherited = { ...acquired, leaseId: "lease-2", lineageId: "lease-1" };
    const result = parse(LeaseAcquiredPayloadSchema, inherited);
    const value: unknown = result.ok ? result.value : undefined;
    expect(value).toEqual(inherited);
    const { lineageId: _omitted, ...withoutLineage } = acquired;
    expect(accepts(LeaseAcquiredPayloadSchema, withoutLineage)).toBe(false);
    expect(accepts(LeaseAcquiredPayloadSchema, { ...acquired, lineageId: "" })).toBe(false);
  });

  test("rejects zero, negative, fractional and non-number epochs", () => {
    for (const leaseEpoch of [0, -1, 1.5, "1", null]) {
      expect(accepts(LeaseAcquiredPayloadSchema, { ...acquired, leaseEpoch })).toBe(false);
    }
  });
});
