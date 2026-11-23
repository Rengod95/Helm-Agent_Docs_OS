import { describe, expect, test } from "bun:test";
import type {
  Finding,
  MetricValue,
  MetricsQueryResult,
  TurnSummary,
} from "@fresnel/contracts/wire";
import {
  CURVE_TURNS_MAX,
  cellOf,
  contextOf,
  countCellOf,
  coveredDays,
  curveThreadOf,
  dailyOf,
  dayKeyOf,
  changeOf,
  dailyContextOf,
  dayWindowOf,
  evidenceTurnsOf,
  foldSlices,
  insightGroupsOf,
  isPartialTurn,
  mergeFirstPage,
  metricFilterOf,
  periodTotalsOf,
  pluginRowsOf,
  previousWindowOf,
  promotionCandidatesOf,
  rawDecisionsOf,
  recentParamsOf,
  sampleStatusOf,
  shareOf,
  sortPluginRows,
  sumCells,
  sharingCountOf,
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

function row(id: string): { turn: TurnSummary; title: string | null } {
  return { turn: summary("a", id, T0), title: null };
}

function approx(value: number): MetricValue {
  return { value, n: 30, state: "approx" };
}

describe("recent turns", () => {
  const filter = { days: 7, profileId: null, includeTests: false, plugin: null } as const;

  test("the engine list takes the period start, or one UTC day, with tests and profile kept out unless chosen", () => {
    expect([
      recentParamsOf(filter, T0, null, false),
      recentParamsOf(
        { ...filter, includeTests: true, profileId: "p2", plugin: "g" },
        T0,
        null,
        true,
      ),
      recentParamsOf({ ...filter, plugin: "g" }, T0, "2026-11-18", false),
    ]).toEqual([
      { from: T0 - 7 * DAY, scopes: ["live", "overlay_reviewed"] },
      {
        from: T0 - 7 * DAY,
        scopes: ["live", "overlay_reviewed", "overlay_draft", "test", "craft"],
        profileId: "p2",
        plugin: "g",
      },
      {
        from: Date.UTC(2026, 10, 18),
        to: Date.UTC(2026, 10, 19),
        scopes: ["live", "overlay_reviewed"],
      },
    ]);
    expect(dayWindowOf("2026-11-18")).toEqual({
      from: Date.UTC(2026, 10, 18),
      to: Date.UTC(2026, 10, 19),
    });
  });

  test("a reread first page goes on top and the rows read further down stay, without repeats", () => {
    expect(
      mergeFirstPage([row("new"), row("1"), row("2")], [row("1"), row("2"), row("3")]).map(
        (r) => r.turn.turnId,
      ),
    ).toEqual(["new", "1", "2", "3"]);
  });

  test("evidence points at each turn once, in order, and replayed turns are left out", () => {
    expect(
      evidenceTurnsOf([
        { kind: "call", threadId: "a", turnId: "1", toolCallId: "c1" },
        { kind: "backtest", backtestRunId: "run" },
        { kind: "hook", threadId: "a", turnId: "1", hookSeq: 2 },
        { kind: "turn", threadId: "b", turnId: "1" },
      ]),
    ).toEqual([
      { threadId: "a", turnId: "1" },
      { threadId: "b", turnId: "1" },
    ]);
  });

  test("a day counts as covered only when every turn of that day was read", () => {
    const turns = [summary("a", "1", T0), summary("a", "2", T0 - DAY)].map((turn) => ({
      turn,
      title: null,
    }));
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

describe("headline figures", () => {
  const window = { from: T0 - 7 * DAY, to: T0 };

  test("context per day adds the plugin parts it knows; a day nobody measured stays empty", () => {
    const result: MetricsQueryResult = {
      window,
      rows: [
        {
          key: { day: "2026-11-18", plugin: "a" },
          values: { "cost.always": approx(100), "cost.on_demand": approx(20) },
        },
        {
          key: { day: "2026-11-18", plugin: "b" },
          values: {
            "cost.always": approx(50),
            "cost.drive": { value: null, n: 2, state: "insufficient_sample" },
          },
        },
        {
          key: { day: "2026-11-19", plugin: "a" },
          values: { "cost.always": { value: null, n: 2, state: "insufficient_sample" } },
        },
      ],
      notes: [],
    };
    expect(dailyContextOf(result, ["2026-11-17", "2026-11-18", "2026-11-19"])).toEqual([
      { day: "2026-11-17", total: null },
      { day: "2026-11-18", total: 170 },
      { day: "2026-11-19", total: null },
    ]);
  });

  test("the previous period reads its turns from the time sample and sums the plugin counts", () => {
    const plugins: MetricsQueryResult = {
      window,
      rows: [
        {
          key: { plugin: "a" },
          values: {
            "cost.always": approx(400),
            "hook.outcomes.blocked": exact(0.1, 100, 100),
            "hook.outcomes.asked": exact(0.05, 100, 100),
            "inst.defied_calls": exact(4, 30),
          },
        },
        {
          key: { plugin: "b" },
          values: { "cost.always": approx(100), "inst.defied_calls": exact(1, 30) },
        },
      ],
      notes: [],
    };
    const blocks: MetricsQueryResult = {
      window,
      rows: [
        { key: {}, values: { "block.time_split": { value: 18_000, n: 120, state: "approx" } } },
      ],
      notes: [],
    };
    const expired: MetricsQueryResult = {
      window,
      rows: [
        {
          key: {},
          values: {
            "block.time_split": {
              value: null,
              n: 0,
              state: "unavailable",
              reason: "beyond_retention",
            },
          },
        },
      ],
      notes: [],
    };
    expect([
      periodTotalsOf(plugins, blocks),
      periodTotalsOf({ window, rows: [], notes: [] }, expired),
    ]).toEqual([
      { turns: 120, context: 500, blocked: 10, asked: 5, defied: 5 },
      { turns: null, context: null, blocked: null, asked: null, defied: null },
    ]);
  });

  test("a change needs both values and a non-zero past; a share stays between 0 and 1", () => {
    expect([changeOf(112, 100), changeOf(90, 100), changeOf(5, 0), changeOf(null, 10)]).toEqual([
      0.12,
      -0.1,
      null,
      null,
    ]);
    expect([shareOf(25, 100), shareOf(120, 100), shareOf(3, 0), shareOf(null, 9)]).toEqual([
      0.25,
      1,
      null,
      null,
    ]);
    expect(previousWindowOf(7, T0)).toEqual({ from: T0 - 14 * DAY, to: T0 - 7 * DAY });
  });

  test("summing plugin cells keeps known values and marks a partial sum as approximate", () => {
    const rows = pluginRowsOf({
      window,
      rows: [
        { key: { plugin: "a" }, values: { "inst.defied_calls": exact(3, 10) } },
        {
          key: { plugin: "b" },
          values: { "inst.defied_calls": { value: null, n: 2, state: "insufficient_sample" } },
        },
      ],
      notes: [],
    });
    expect([sumCells(rows, (r) => r.defied), sumCells(rows.slice(1), (r) => r.defied)]).toEqual([
      { kind: "value", value: 3, approx: true, n: 0 },
      { kind: "sample", n: 2 },
    ]);
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

/** 곡선 시험의 최근 턴 하나(시작은 `minute`분 뒤) */
function at(threadId: string, turnId: string, minute: number, title: string | null = null) {
  return { turn: summary(threadId, turnId, T0 + minute * 60_000), title };
}

describe("turn curve", () => {
  test("no turns means no conversation to draw", () => {
    expect([curveThreadOf([], CURVE_TURNS_MAX), CURVE_TURNS_MAX]).toEqual([null, 20]);
  });

  test("the conversation with the most turns is drawn, with its title", () => {
    const turns = [
      at("a", "a1", 1, "A"),
      at("b", "b1", 2, "B"),
      at("b", "b2", 3, "B"),
      at("a", "a2", 4, "A"),
      at("b", "b3", 5, "B"),
    ];
    expect(curveThreadOf(turns, 20)).toEqual({
      threadId: "b",
      title: "B",
      turnIds: ["b1", "b2", "b3"],
      capped: false,
    });
  });

  test("on a tie the conversation whose newest turn started last wins", () => {
    const turns = [at("a", "a1", 5), at("a", "a2", 6), at("b", "b1", 1), at("b", "b2", 7)];
    expect(curveThreadOf(turns, 20)).toEqual({
      threadId: "b",
      title: null,
      turnIds: ["b1", "b2"],
      capped: false,
    });
  });

  test("turn ids run oldest first, and only the latest max are kept", () => {
    const turns = [at("a", "a3", 30), at("a", "a1", 10), at("a", "a4", 40), at("a", "a2", 20)];
    expect([curveThreadOf(turns, 3), curveThreadOf(turns, 4)]).toEqual([
      { threadId: "a", title: null, turnIds: ["a2", "a3", "a4"], capped: true },
      { threadId: "a", title: null, turnIds: ["a1", "a2", "a3", "a4"], capped: false },
    ]);
  });
});

describe("shared tools", () => {
  const candidates = [
    { tool: "search", owner: "docs", consumers: ["review", "notes"], userCalls: 4 },
    { tool: "lint", owner: "style", consumers: ["notes"], userCalls: 1 },
  ];

  test("the plugin focus keeps a candidate whose owner or a consumer is that plugin", () => {
    expect([
      promotionCandidatesOf(candidates, null).map((c) => c.tool),
      promotionCandidatesOf(candidates, "notes").map((c) => c.tool),
      promotionCandidatesOf(candidates, "docs").map((c) => c.tool),
      promotionCandidatesOf(candidates, "other"),
    ]).toEqual([["search", "lint"], ["search", "lint"], ["search"], []]);
  });
});

describe("sharingCountOf", () => {
  test("counts the owner and the consumers once each", () => {
    expect([
      sharingCountOf({ tool: "t", owner: "a", consumers: ["b", "c"], userCalls: 0 }),
      sharingCountOf({ tool: "t", owner: "a", consumers: ["a", "b"], userCalls: 0 }),
      sharingCountOf({ tool: "t", owner: "a", consumers: [], userCalls: 0 }),
    ]).toEqual([3, 2, 1]);
  });
});
