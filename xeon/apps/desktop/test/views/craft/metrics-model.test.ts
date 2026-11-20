import { describe, expect, test } from "bun:test";
import type {
  Finding,
  MetricValue,
  MetricsQueryResult,
  TurnSummary,
} from "@fresnel/contracts/wire";
import {
  cellOf,
  contextOf,
  countCellOf,
  coveredDays,
  dailyOf,
  dayKeyOf,
  eligibleThreadsOf,
  foldSlices,
  insightGroupsOf,
  isPartialTurn,
  mergeRecent,
  metricFilterOf,
  pluginRowsOf,
  rawDecisionsOf,
  sampleStatusOf,
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
    expect(metricFilterOf({ days: 7, profileId: null, includeTests: false, plugin: null })).toEqual(
      {
        period: { days: 7 },
        scopes: ["live", "overlay_reviewed"],
      },
    );
    expect(
      metricFilterOf({ days: 30, profileId: "review", includeTests: true, plugin: null }),
    ).toEqual({
      period: { days: 30 },
      scopes: ["live", "overlay_reviewed", "overlay_draft", "test", "craft"],
      profileId: "review",
    });
  });

  test("a focused plugin narrows only the queries that ask for it", () => {
    const filter = { days: 7, profileId: null, includeTests: false, plugin: "repo-guard" } as const;
    expect([metricFilterOf(filter), metricFilterOf(filter, true)]).toEqual([
      { period: { days: 7 }, scopes: ["live", "overlay_reviewed"] },
      { period: { days: 7 }, scopes: ["live", "overlay_reviewed"], plugin: "repo-guard" },
    ]);
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
      { day: "2026-11-17", turns: 0, calls: 0, blocked: 0, asked: 0, modified: 0 },
      { day: "2026-11-18", turns: 12, calls: null, blocked: 3, asked: null, modified: null },
      { day: "2026-11-19", turns: 0, calls: 0, blocked: 0, asked: 0, modified: 0 },
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

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-20T09:00:00Z");

function summary(
  threadId: string,
  turnId: string,
  startedAt: number,
  patch: Partial<TurnSummary> = {},
  flags: Partial<TurnSummary["flags"]> = {},
): TurnSummary {
  return {
    threadId,
    turnId,
    startedAt,
    endedAt: startedAt + 1000,
    status: "completed",
    scope: "live",
    complete: true,
    profileId: null,
    stepCount: 1,
    callCount: 0,
    flags: {
      blockedIntent: 0,
      blockedFault: 0,
      deniedPolicy: 0,
      deniedHuman: 0,
      deniedNoninteractive: 0,
      replaced: 0,
      cancelledAsk: 0,
      asked: 0,
      modified: 0,
      timedOut: 0,
      failed: 0,
      drive: false,
      cacheBreak: false,
      subagents: 0,
      truncatedMaterials: 0,
      draftActive: false,
      untrackedWrite: false,
      ...flags,
    },
    frameDepthMax: 0,
    childCount: 0,
    ...patch,
  };
}

describe("recent turns", () => {
  const filter = { days: 7, profileId: null, includeTests: false, plugin: null } as const;

  test("threads are picked by recent activity inside the period, tests and other profiles left out", () => {
    const threads = [
      { threadId: "old", title: null, updatedAt: T0 - 9 * DAY, profileId: null, test: false },
      { threadId: "a", title: "A", updatedAt: T0 - DAY, profileId: null, test: false },
      { threadId: "b", title: "B", updatedAt: T0 - 60_000, profileId: "p2", test: false },
      { threadId: "t", title: "T", updatedAt: T0, profileId: null, test: true },
    ];
    expect([
      eligibleThreadsOf(threads, filter, T0).map((th) => th.threadId),
      eligibleThreadsOf(threads, { ...filter, includeTests: true }, T0).map((th) => th.threadId),
      eligibleThreadsOf(threads, { ...filter, profileId: "p2" }, T0).map((th) => th.threadId),
    ]).toEqual([["b", "a"], ["t", "b", "a"], ["b"]]);
  });

  test("pages merge newest first and turns outside the period drop", () => {
    const merged = mergeRecent(
      [
        { title: "A", items: [summary("a", "a1", T0 - 2 * DAY), summary("a", "a0", T0 - 8 * DAY)] },
        { title: null, items: [summary("b", "b1", T0 - DAY)] },
      ],
      filter,
      T0,
    );
    expect(merged.map((r) => [r.turn.turnId, r.title])).toEqual([
      ["b1", null],
      ["a1", "A"],
    ]);
  });

  test("a day counts as covered only when every turn of that day was read", () => {
    const turns = mergeRecent(
      [{ title: null, items: [summary("a", "1", T0), summary("a", "2", T0 - DAY)] }],
      filter,
      T0,
    );
    const daily = [
      { day: dayKeyOf(T0 - DAY), turns: 1, calls: 0, blocked: null, asked: null, modified: null },
      { day: dayKeyOf(T0), turns: 3, calls: 0, blocked: null, asked: null, modified: null },
    ];
    expect([...coveredDays(daily, turns)]).toEqual([dayKeyOf(T0 - DAY)]);
  });

  test("raw decisions add the turn flags as they are, faults counted apart", () => {
    expect(
      rawDecisionsOf([
        summary("a", "1", T0, {}, { blockedIntent: 2, asked: 1, timedOut: 1 }),
        summary("a", "2", T0, {}, { modified: 3, blockedFault: 1 }),
      ]),
    ).toEqual({ blocked: 2, asked: 1, modified: 3, fault: 2 });
  });

  test("a resumed turn is partial, a running one is not judged yet", () => {
    expect([
      isPartialTurn(summary("a", "1", T0, { complete: false })),
      isPartialTurn(summary("a", "2", T0, { complete: false, status: "open" })),
      isPartialTurn(summary("a", "3", T0)),
    ]).toEqual([true, false, false]);
  });
});

describe("sample", () => {
  test("the screen says how many more turns the engine needs, or nothing when it cannot know", () => {
    expect([sampleStatusOf(6, 20), sampleStatusOf(25, 20), sampleStatusOf(6, null)]).toEqual([
      { turns: 6, min: 20, short: 14 },
      { turns: 25, min: 20, short: 0 },
      { turns: 6, min: null, short: null },
    ]);
  });
});
