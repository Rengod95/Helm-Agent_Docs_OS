import { describe, expect, test } from "bun:test";
import type { MeasureRow, MeasureTurnResult } from "@fresnel/contracts/wire";
import { changesOf, perfViewOf } from "../../src/workbench/index.ts";

const day = (d: string, count: number, sum: number) => ({ day: d, count, sum, min: 0, max: sum });

const turnRow = (totalTokens: number): MeasureRow => ({
  at: 1,
  kind: "turn",
  metrics: { steps: 1, totalTokens, usd: totalTokens / 1000 },
  tags: { status: "completed" },
});
const hook = (reg: string, ms: number, result: string, seq = 1): MeasureRow => ({
  at: 1,
  kind: "hook",
  metrics: { ms, seq, step: 0 },
  tags: { hook: "context", registrationId: reg, result },
});
const turn = (
  turnId: string,
  rows: readonly MeasureRow[],
): { turnId: string; result: MeasureTurnResult } => ({
  turnId,
  result: { enabled: true, rows },
});

describe("changesOf", () => {
  test("compares the latest day mean with the mean of earlier days", () => {
    const out = changesOf([
      {
        kind: "turn",
        metric: "totalTokens",
        days: [day("2026-11-02", 2, 200), day("2026-11-03", 2, 200), day("2026-11-04", 1, 300)],
      },
      {
        kind: "call",
        metric: "firstTokenMs",
        days: [day("2026-11-03", 1, 100), day("2026-11-04", 1, 105)],
      },
      { kind: "turn", metric: "usd", days: [day("2026-11-04", 1, 1)] },
    ]);
    expect(out).toEqual([
      {
        kind: "turn",
        metric: "totalTokens",
        day: "2026-11-04",
        latest: 300,
        before: 100,
        ratio: 2,
        direction: "up",
      },
      {
        kind: "call",
        metric: "firstTokenMs",
        day: "2026-11-04",
        latest: 105,
        before: 100,
        ratio: 0.05,
        direction: "same",
      },
    ]);
  });
});

describe("perfViewOf", () => {
  test("off and empty", () => {
    expect(perfViewOf([], [{ turnId: "a", result: { enabled: false, rows: [] } }])).toEqual({
      kind: "off",
    });
    expect(perfViewOf([], [])).toEqual({ kind: "empty" });
  });

  test("finds the heavy and failing turns, the burden rows and the curve", () => {
    const state = perfViewOf(
      [],
      [
        turn("t1", [turnRow(100), hook("acme", 10, "passed")]),
        turn("t2", [turnRow(110), hook("acme", 900, "failed"), hook("helm", 5, "passed", 2)]),
        turn("t3", [turnRow(90), hook("acme", 20, "passed")]),
        turn("t4", [
          turnRow(500),
          {
            at: 1,
            kind: "cache",
            metrics: { step: 0 },
            tags: { code: "tools_deferred", owner: "tools" },
          },
        ]),
      ],
    );
    if (state.kind !== "ready") throw new Error("expected ready");
    const { view } = state;
    expect(view.signals).toEqual([
      { kind: "problem", turnId: "t2", number: 2, count: 1 },
      { kind: "cacheBreak", turnId: "t4", number: 4, count: 1 },
      { kind: "heavy", turnId: "t4", number: 4, count: 500 },
    ]);
    expect(view.toRead).toEqual([
      { turnId: "t4", number: 4, signals: ["cacheBreak", "heavy"], totalTokens: 500 },
      { turnId: "t2", number: 2, signals: ["problem"], totalTokens: 110 },
    ]);
    expect(view.burden).toEqual([
      {
        owner: "acme",
        turns: 3,
        sectionTokens: 0,
        tokensPerTurn: 0,
        tokensEstimated: false,
        hookMs: 930,
        msPerTurn: 310,
        problems: 1,
        cacheEvents: 0,
        costUsd: null,
        worstTurnId: "t2",
      },
      {
        owner: "helm",
        turns: 1,
        sectionTokens: 0,
        tokensPerTurn: 0,
        tokensEstimated: false,
        hookMs: 5,
        msPerTurn: 5,
        problems: 0,
        cacheEvents: 0,
        costUsd: null,
        worstTurnId: "t2",
      },
    ]);
    expect(view.curve.map((p) => [p.number, p.totalTokens])).toEqual([
      [1, 100],
      [2, 110],
      [3, 90],
      [4, 500],
    ]);
  });

  test("no heavy signal under four turns", () => {
    const state = perfViewOf([], [turn("a", [turnRow(1)]), turn("b", [turnRow(1000)])]);
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.view.signals).toEqual([]);
  });
});
