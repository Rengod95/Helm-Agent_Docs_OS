import { describe, expect, test } from "bun:test";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { TestRunPhaseResult } from "@fresnel/contracts/extensions";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import {
  boundaryLogOf,
  guardChipOf,
  lastResultsOf,
  LAST_RESULTS_LIMIT,
  lockBarOf,
  replayLockOf,
} from "../../src/workbench/index.ts";

const phaseOf = (over: Partial<TestRunPhaseResult> = {}): TestRunPhaseResult => ({
  phase: "review",
  group: "helm",
  seq: 7,
  paused: false,
  lock: { holder: "helm", status: "active", epoch: 3 },
  guardHits: 0,
  traceEnabled: true,
  boundaries: [],
  ...over,
});

const cutsOf = (commits: number): ReplayReport["cuts"] =>
  Array.from({ length: commits }, (_, index) => ({
    commitIndex: index + 1,
    equal: true,
    firstDiff: null,
  }));

const replayOf = (over: Partial<ReplayReport> = {}): ReplayReport => ({
  ok: true,
  commits: 2,
  passed: 2,
  firstDiff: null,
  cuts: cutsOf(2),
  effects: { turn: 0, spawn: 0, delegate: 0, post: 0 },
  failure: null,
  ...over,
});

const recordOf = (over: Partial<ExtTestRecord> = {}): ExtTestRecord => ({
  testId: "t-1",
  kind: "replay",
  target: "helm",
  state: "passed",
  startedAt: "2026-11-04T09:00:00.000Z",
  durationMs: 1200,
  threadId: null,
  replay: replayOf(),
  ...over,
});

describe("드라이브 락 줄", () => {
  test("active is held, releasing is releasing, none is none with no holder", () => {
    expect(lockBarOf(phaseOf())).toEqual({ kind: "held", holder: "helm" });
    expect(lockBarOf(phaseOf({ lock: { holder: "helm", status: "releasing", epoch: 3 } }))).toEqual(
      { kind: "releasing", holder: "helm" },
    );
    expect(lockBarOf(phaseOf({ lock: { holder: null, status: "none", epoch: null } }))).toEqual({
      kind: "none",
      holder: null,
    });
  });

  test("none drops a holder the wire still names, so the bar never shows a lead that is not there", () => {
    expect(lockBarOf(phaseOf({ lock: { holder: "helm", status: "none", epoch: 3 } }))).toEqual({
      kind: "none",
      holder: null,
    });
  });
});

describe("가드 칩", () => {
  test("a positive count with tracing on is hits, zero with tracing on is none", () => {
    expect(guardChipOf(phaseOf({ guardHits: 4, traceEnabled: true }))).toEqual({
      kind: "hits",
      count: 4,
    });
    expect(guardChipOf(phaseOf({ guardHits: 0, traceEnabled: true }))).toEqual({ kind: "none" });
  });

  test("tracing off is off whatever the count says, because the count was not measured", () => {
    expect(guardChipOf(phaseOf({ guardHits: 0, traceEnabled: false }))).toEqual({ kind: "off" });
    expect(guardChipOf(phaseOf({ guardHits: 2, traceEnabled: false }))).toEqual({ kind: "off" });
  });
});

describe("단계 사이 기록", () => {
  test("the wire gives oldest first, the log shows newest first and keeps seq, phase and paused", () => {
    const rows = boundaryLogOf([
      { seq: 5, phase: "classify", paused: false },
      { seq: 6, phase: null, paused: true },
      { seq: 7, phase: "review", paused: false },
    ]);
    expect(rows).toEqual([
      { seq: 7, phase: "review", paused: false },
      { seq: 6, phase: null, paused: true },
      { seq: 5, phase: "classify", paused: false },
    ]);
  });

  test("no boundaries is an empty log", () => {
    expect(boundaryLogOf([])).toEqual([]);
  });
});

describe("그룹의 지난 결과", () => {
  test("keeps only replay records of this group, newest first, with the verdict of each report", () => {
    const records = [
      recordOf({ testId: "old", startedAt: "2026-11-01T00:00:00.000Z" }),
      recordOf({
        testId: "new",
        startedAt: "2026-11-03T00:00:00.000Z",
        state: "failed",
        replay: replayOf({
          ok: false,
          passed: 1,
          firstDiff: 2,
          cuts: [
            { commitIndex: 1, equal: true, firstDiff: null },
            { commitIndex: 2, equal: false, firstDiff: 2 },
          ],
        }),
      }),
      recordOf({ testId: "other", target: "review" }),
      recordOf({
        testId: "run",
        kind: "testRun",
        state: "running",
        replay: null,
        threadId: "thr_1",
      }),
    ];
    const { rows, latest } = lastResultsOf(records, "helm");
    expect(rows.map((row) => [row.testId, row.verdict])).toEqual([
      ["new", { kind: "digest-differs" }],
      ["old", { kind: "same" }],
    ]);
    expect(latest?.testId).toBe("new");
    expect(rows[0]?.durationMs).toBe(1200);
  });

  test("a replay that is still running or has no report has no verdict", () => {
    const { rows } = lastResultsOf(
      [recordOf({ testId: "busy", state: "running", replay: null, durationMs: null })],
      "helm",
    );
    expect(rows).toEqual([
      {
        testId: "busy",
        state: "running",
        startedMs: Date.parse("2026-11-04T09:00:00.000Z"),
        durationMs: null,
        verdict: null,
      },
    ]);
  });

  test("a failure report carries its failure kind as the verdict", () => {
    const { rows } = lastResultsOf(
      [
        recordOf({
          replay: replayOf({ ok: false, failure: "no-commits", commits: 0, passed: 0, cuts: [] }),
        }),
      ],
      "helm",
    );
    expect(rows[0]?.verdict).toEqual({ kind: "failure", failure: "no-commits" });
  });

  test("shows at most the limit, and latest is still the newest of all of them", () => {
    const many = Array.from({ length: LAST_RESULTS_LIMIT + 2 }, (_, index) =>
      recordOf({
        testId: `t-${String(index)}`,
        startedAt: `2026-11-0${String(index + 1)}T00:00:00.000Z`,
      }),
    );
    const { rows, latest } = lastResultsOf(many, "helm");
    expect(rows).toHaveLength(LAST_RESULTS_LIMIT);
    expect(rows[0]?.testId).toBe(`t-${String(LAST_RESULTS_LIMIT + 1)}`);
    expect(latest?.testId).toBe(`t-${String(LAST_RESULTS_LIMIT + 1)}`);
  });

  test("no records for the group is empty and has no latest", () => {
    expect(lastResultsOf([recordOf({ target: "review" })], "helm")).toEqual({
      rows: [],
      latest: null,
    });
  });
});

describe("다시 돌려 검사의 잠김", () => {
  test("offline wins over dev mode, a released app is dev mode locked, dev mode online is open", () => {
    expect(replayLockOf(true, false)).toBe("offline");
    expect(replayLockOf(false, false)).toBe("offline");
    expect(replayLockOf(false, true)).toBe("devMode");
    expect(replayLockOf(true, true)).toBeNull();
  });
});
