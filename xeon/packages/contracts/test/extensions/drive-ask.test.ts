import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  AskRequestSchema,
  REPLAY_EFFECT_TABLE,
  isEffectAllowed,
  type AskOutcome,
  type AskRequest,
  type LoopHandle,
} from "../../src/extensions/index.ts";
import { LeaseReleasedPayloadSchema } from "../../src/records/index.ts";

const card = {
  questions: [
    {
      id: "approve",
      header: "Apply",
      text: "Apply the plan?",
      options: [
        { id: "yes", label: "Yes", recommended: true },
        { id: "no", label: "No" },
      ],
      multiSelect: false,
      allowFreeText: true,
    },
  ],
};

describe("LoopHandle.ask (X-17)", () => {
  test("AskRequest round trips by value, title optional", () => {
    const withTitle = { requestId: "helm:gate:1", card, title: "Confirm" };
    const parsed = parse(AskRequestSchema, withTitle);
    expect(parsed).toEqual({ ok: true, value: withTitle });
    const bare = { requestId: "helm:gate:1", card };
    expect(parse(AskRequestSchema, bare)).toEqual({ ok: true, value: bare });
  });

  test("rejects a missing or oversized requestId, empty or too many questions, extra keys", () => {
    expect(parse(AskRequestSchema, { card }).ok).toBe(false);
    expect(parse(AskRequestSchema, { requestId: "", card }).ok).toBe(false);
    expect(parse(AskRequestSchema, { requestId: "x".repeat(65), card }).ok).toBe(false);
    expect(parse(AskRequestSchema, { requestId: "r", card: { questions: [] } }).ok).toBe(false);
    const five = { questions: Array.from({ length: 5 }, () => card.questions[0]) };
    expect(parse(AskRequestSchema, { requestId: "r", card: five }).ok).toBe(false);
    expect(parse(AskRequestSchema, { requestId: "r", card, extra: 1 }).ok).toBe(false);
  });

  test("a drive function can type the whole call; outcomes are a closed union", async () => {
    const outcomes: AskOutcome[] = [
      { status: "answered", answer: { approve: { selected: ["yes"] } } },
      { status: "denied", resolvedBy: "expired" },
      { status: "denied", resolvedBy: "user", feedback: "not now" },
    ];
    const seen: AskRequest[] = [];
    const ask: LoopHandle["ask"] = async (request) => {
      seen.push(request);
      const next = outcomes[seen.length - 1];
      if (next === undefined) throw new Error("no outcome");
      return next;
    };
    const request: AskRequest = { requestId: "r", card };
    const first: unknown = await ask(request);
    const second: unknown = await ask(request);
    expect(first).toEqual({ status: "answered", answer: { approve: { selected: ["yes"] } } });
    expect(second).toEqual({ status: "denied", resolvedBy: "expired" });
    expect(seen).toEqual([request, request]);
  });

  test("loop.ask is a drive-only effect that needs a requestId", () => {
    expect(REPLAY_EFFECT_TABLE["loop.ask"]).toEqual({
      on: "n/a",
      drive: "allowed",
      guarantor: "X",
      requestId: "required",
    });
    expect(isEffectAllowed("loop.ask", "on")).toBe(false);
    expect(isEffectAllowed("loop.ask", "drive")).toBe(true);
  });

  test("lease.released accepts the new reason waiting", () => {
    const payload = { leaseId: "lock-1", scopeId: "helm", reason: "waiting" } as const;
    expect(parse(LeaseReleasedPayloadSchema, payload)).toEqual({ ok: true, value: payload });
  });
});
