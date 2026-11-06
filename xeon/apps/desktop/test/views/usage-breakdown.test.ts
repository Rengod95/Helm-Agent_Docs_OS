import { describe, expect, test } from "bun:test";
import type { MeasureRow, UsageGauge } from "@fresnel/contracts/wire";
import { totalsOf, turnBreakdownOf } from "../../src/views/usage-breakdown.tsx";

function gauge(unit: UsageGauge["unit"], used: number, providerId = "anthropic"): UsageGauge {
  return {
    id: `${providerId}::session:${unit}`,
    providerId,
    account: null,
    window: "session",
    unit,
    used,
    limit: null,
    resetsAt: null,
  };
}

const callRow = (startedAt: number, durationMs: number): MeasureRow => ({
  at: startedAt + durationMs,
  kind: "call",
  metrics: { startedAt, durationMs },
  tags: { role: "main", model: "haiku" },
});

describe("totalsOf", () => {
  test("sums the session gauges by unit across providers", () => {
    expect(
      totalsOf([
        gauge("tokens", 13_010),
        gauge("tokens", 513, "other"),
        gauge("usd", 0.000449),
        gauge("requests", 2),
        gauge("cacheRead", 12_000),
        gauge("cacheWrite", 642),
      ]),
    ).toEqual({ tokens: 13_523, usd: 0.000449, requests: 2, cacheRead: 12_000, cacheWrite: 642 });
  });
});

describe("turnBreakdownOf", () => {
  test("reads tokens from the turn row and the call and wait times from the call rows", () => {
    const turn: MeasureRow = {
      at: 1,
      kind: "turn",
      metrics: {
        steps: 2,
        input: 900,
        output: 120,
        cacheRead: 12_000,
        cacheWrite: 642,
        totalTokens: 13_662,
        usd: 0.0008,
      },
      tags: { status: "completed" },
    };
    expect(
      turnBreakdownOf({
        enabled: true,
        rows: [turn, callRow(10_000, 2800), callRow(38_000, 2200)],
      }),
    ).toEqual({
      input: 900,
      output: 120,
      cacheRead: 12_000,
      cacheWrite: 642,
      usd: 0.0008,
      calls: 2,
      modelMs: 5000,
      waitMs: 25_200,
    });
  });

  test("measurement off or no turn row gives no turn line", () => {
    expect(turnBreakdownOf({ enabled: false, rows: [] })).toBeNull();
    expect(turnBreakdownOf({ enabled: true, rows: [callRow(1, 2)] })).toBeNull();
  });
});
