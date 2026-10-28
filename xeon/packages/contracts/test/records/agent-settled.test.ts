import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { AgentSettledEventPayloadSchema } from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

const settled = {
  childThreadId: rawId("thr", 2),
  requestId: "learning:review:3",
  status: "completed",
  report: null,
  answerItemId: null,
  usage: null,
  error: null,
};

describe("agent.settled owner and limitHit (M3-REQ-103, REQ-LN-02)", () => {
  test("old records without the new fields still parse", () => {
    expect(accepts(AgentSettledEventPayloadSchema, settled)).toBe(true);
  });

  test("carries the delegating owner and keeps it", () => {
    const owner = { kind: "scope", scopeId: "learning" };
    const parsed = parse(AgentSettledEventPayloadSchema, { ...settled, owner });
    const value: unknown = parsed.ok ? parsed.value.owner : undefined;
    expect(value).toEqual(owner);
    for (const ok of [
      { kind: "tool", turnId: rawId("trn", 1), toolCallId: "call_1" },
      { kind: "drive", turnId: null, scopeId: "helm", leaseId: "lease-1" },
    ]) {
      expect(accepts(AgentSettledEventPayloadSchema, { ...settled, owner: ok })).toBe(true);
    }
    expect(accepts(AgentSettledEventPayloadSchema, { ...settled, owner: { kind: "scope" } })).toBe(
      false,
    );
    expect(accepts(AgentSettledEventPayloadSchema, { ...settled, owner: { kind: "user" } })).toBe(
      false,
    );
  });

  test("limitHit is steps, tokens or null and status keeps its three values", () => {
    for (const limitHit of ["steps", "tokens", null]) {
      expect(accepts(AgentSettledEventPayloadSchema, { ...settled, limitHit })).toBe(true);
    }
    for (const limitHit of ["time", "", 1]) {
      expect(accepts(AgentSettledEventPayloadSchema, { ...settled, limitHit })).toBe(false);
    }
    expect(accepts(AgentSettledEventPayloadSchema, { ...settled, status: "budget" })).toBe(false);
    expect(
      accepts(AgentSettledEventPayloadSchema, {
        ...settled,
        status: "aborted",
        limitHit: "tokens",
      }),
    ).toBe(true);
  });
});
