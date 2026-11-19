import { describe, expect, test } from "bun:test";
import type { Finding, MetricValue, MetricsQueryResult } from "@fresnel/contracts/wire";
import {
  cellOf,
  contextOf,
  countCellOf,
  dailyOf,
  dayKeyOf,
  foldSlices,
  insightGroupsOf,
  metricFilterOf,
  pluginRowsOf,
  sortPluginRows,
} from "../../../src/views/craft/metrics/model.ts";

const exact = (value: number, n: number, denom?: number): MetricValue => ({
  value,
  n,
  state: "exact",
  ...(denom === undefined ? {} : { denom }),
});

function finding(id: string, unit: Finding["impact"]["unit"], value: number): Finding {
  return {
    id,
    ruleId: "unused_tools",
    ruleVersion: 1,
    subject: { kind: "tool", plugin: "p", ref: null },
    impact: { unit, value },
    metrics: {},
    evidence: [],
    evidenceTotal: 0,
    next: [],
    state: "open",
  };
}

describe("metric filter", () => {
  test("test-run records stay out unless the user includes them: scopes are always explicit", () => {
    expect(metricFilterOf({ days: 7, profileId: null, includeTests: false })).toEqual({
      period: { days: 7 },
      scopes: ["live", "overlay_reviewed"],
    });
    expect(metricFilterOf({ days: 30, profileId: "review", includeTests: true })).toEqual({
      period: { days: 30 },
      scopes: ["live", "overlay_reviewed", "overlay_draft", "test", "craft"],
      profileId: "review",
    });
  });
});

describe("cells", () => {
  test("a missing, thin or unavailable value is never drawn as zero", () => {
    expect(cellOf(undefined)).toEqual({ kind: "absent", reason: null });
    expect(cellOf({ value: null, n: 3, state: "insufficient_sample" })).toEqual({
      kind: "sample",
      n: 3,
    });
    expect(cellOf({ value: null, n: 0, state: "unavailable", reason: "not_recorded" })).toEqual({
      kind: "absent",
      reason: "not_recorded",
    });
    expect(cellOf({ value: 12, n: 40, state: "approx" })).toEqual({
      kind: "value",
      value: 12,
      approx: true,
      n: 40,
    });
  });

  test("a ratio with a denominator reads back as a count", () => {
    expect(countCellOf(exact(0.25, 40, 40))).toEqual({
      kind: "value",
      value: 10,
      approx: false,
      n: 40,
    });
    expect(countCellOf(exact(0.25, 40))).toEqual({
      kind: "value",
      value: 0.25,
      approx: false,
      n: 40,
    });
  });
});

describe("plugin rows and context", () => {
  const result: MetricsQueryResult = {
    window: { from: 0, to: 1 },
    notes: [],
    rows: [
      {
        key: { plugin: "small" },
        values: { "cost.always": exact(100, 30), "hook.outcomes.blocked": exact(0.5, 30, 4) },
      },
      {
        key: { plugin: "big" },
        values: { "cost.always": exact(900, 30), "cost.drive": exact(300, 30) },
      },
      {
        key: { plugin: "thin" },
        values: { "cost.always": { value: null, n: 2, state: "insufficient_sample" } },
      },
      { key: {}, values: { "cost.always": exact(5, 30) } },
    ],
  };

  test("rows sort by known context, unnamed rows drop, blocked reads as a count", () => {
    const rows = pluginRowsOf(result);
    expect(rows.map((r) => [r.plugin, r.context])).toEqual([
      ["big", 1200],
      ["small", 100],
      ["thin", null],
    ]);
    expect(rows[1]?.blocked).toEqual({ kind: "value", value: 2, approx: false, n: 30 });
    expect(sortPluginRows(rows, "blocked").map((r) => r.plugin)).toEqual(["small", "big", "thin"]);
  });

  test("context breakdown sums by part and lists plugins without a value apart", () => {
    const ctx = contextOf(pluginRowsOf(result));
    expect(ctx.totals).toEqual({ always: 1000, drive: 300, onDemand: 0 });
    expect(ctx.total).toBe(1300);
    expect(ctx.slices.map((s) => s.plugin)).toEqual(["big", "small"]);
    expect(ctx.missing).toEqual(["thin"]);
    const folded = foldSlices(ctx.slices, 1);
    expect([folded.shown.map((s) => [s.plugin, s.total]), folded.rest]).toEqual([
      [["big", 1200]],
      { count: 1, total: 100 },
    ]);
  });
});

describe("daily", () => {
  test("every day of the window gets a point and a day without rows has zero turns", () => {
    const from = Date.parse("2026-11-17T00:00:00Z");
    const result: MetricsQueryResult = {
      window: { from, to: from + 3 * 86_400_000 },
      notes: [],
      rows: [
        {
          key: { day: "2026-11-18" },
          values: {
            "block.time_split": exact(4000, 12),
            "hook.outcomes.blocked": exact(0.5, 12, 6),
          },
        },
      ],
    };
    expect(dayKeyOf(from)).toBe("2026-11-17");
    expect(dailyOf(result)).toEqual([
      { day: "2026-11-17", turns: 0, calls: 0, blocked: 0, asked: 0 },
      { day: "2026-11-18", turns: 12, calls: null, blocked: 3, asked: null },
      { day: "2026-11-19", turns: 0, calls: 0, blocked: 0, asked: 0 },
    ]);
  });
});

describe("insights", () => {
  test("insights group by impact unit, biggest first, empty groups dropped", () => {
    const groups = insightGroupsOf([
      finding("a", "hits", 3),
      finding("b", "turns", 1),
      finding("c", "hits", 9),
    ]);
    expect(groups.map((g) => [g.unit, g.items.map((f) => f.id)])).toEqual([
      ["hits", ["c", "a"]],
      ["turns", ["b"]],
    ]);
  });
});
