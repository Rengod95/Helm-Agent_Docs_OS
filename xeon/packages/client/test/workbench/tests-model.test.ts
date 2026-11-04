import { describe, expect, test } from "bun:test";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import {
  ALL_TESTS,
  CUT_STRIP_LIMIT,
  cutStripOf,
  draftErrorsOf,
  effectRowsOf,
  INITIAL_TESTS_UI,
  NEW_TEST_DEFAULT,
  newTestItemsOf,
  replayVerdictOf,
  reportJsonOf,
  runControlsOf,
  submitPlanOf,
  testRowsOf,
  testsUiReducer,
  type NewTestDraft,
  type TestRowVM,
} from "../../src/workbench/index.ts";

/** 커밋 `commits`개의 절단 칸. `diffs`에 든 커밋 번호(1부터)의 칸만 다르다 */
const cutsOf = (commits: number, diffs: readonly number[] = []): ReplayReport["cuts"] =>
  Array.from({ length: commits }, (_, index) => {
    const commitIndex = index + 1;
    const equal = !diffs.includes(commitIndex);
    return { commitIndex, equal, firstDiff: equal ? null : 212 };
  });

const report = (over: Partial<ReplayReport> = {}): ReplayReport => ({
  ok: true,
  commits: 41,
  passed: 41,
  firstDiff: null,
  cuts: cutsOf(41),
  effects: { turn: 0, spawn: 0, delegate: 0, post: 1 },
  failure: null,
  ...over,
});

const record = (over: Partial<ExtTestRecord> = {}): ExtTestRecord => ({
  testId: "t-1",
  kind: "replay",
  target: "review",
  state: "passed",
  startedAt: "2026-11-04T09:00:00.000Z",
  durationMs: 18000,
  threadId: null,
  replay: report(),
  ...over,
});

const rowOf = (over: Partial<TestRowVM> = {}): TestRowVM => ({
  testId: "t-run",
  kind: "testRun",
  target: "helm",
  state: "running",
  startedMs: 1,
  durationMs: null,
  threadId: "thr_1",
  replay: null,
  ...over,
});

const draft = (over: Partial<NewTestDraft> = {}): NewTestDraft => ({
  ...NEW_TEST_DEFAULT,
  kind: "replay",
  target: "review",
  ...over,
});

describe("P-19 테스트 모델", () => {
  test("test-run.dev-only-locked: outside dev mode replay, benchmark and core diff are locked by the dev badge, Test run and the list stay open", () => {
    const items = newTestItemsOf(false);
    const byKind = (kind: string) => items.find((item) => item.kind === kind);
    expect(byKind("replay")?.lock).toBe("devMode");
    expect(byKind("benchmark")?.lock).toBe("devMode");
    expect(byKind("coreDiff")?.lock).toBe("devMode");
    expect(byKind("testRun")?.lock).toBeNull();
    expect(byKind("testRun")?.startable).toBe(true);
    expect(submitPlanOf(draft({ kind: "replay" }), false)).toEqual({
      kind: "locked",
      lock: "devMode",
    });
    // 목록 읽기는 개발 모드와 상관없이 거르기만 하므로 기록이 있으면 늘 보인다
    expect(testRowsOf([record()], ALL_TESTS, null)).toHaveLength(1);
  });

  test("test-run.dev-only-locked: inside dev mode replay is enabled and startable, while benchmark and core diff stay unwired and the abCompare stays isolation-locked", () => {
    const items = newTestItemsOf(true);
    const byKind = (kind: string) => items.find((item) => item.kind === kind);
    expect(byKind("replay")?.lock).toBeNull();
    expect(byKind("replay")?.startable).toBe(true);
    expect(byKind("benchmark")?.lock).toBeNull();
    expect(byKind("benchmark")?.startable).toBe(false);
    expect(byKind("coreDiff")?.lock).toBeNull();
    expect(byKind("coreDiff")?.startable).toBe(false);
    expect(byKind("abCompare")?.lock).toBe("isolation");
    expect(byKind("abCompare")?.startable).toBe(false);
    expect(submitPlanOf(draft({ kind: "replay" }), true)).toEqual({
      kind: "run",
      params: { kind: "replay", target: "review", options: { maxCommits: 200 } },
      confirm: false,
    });
    expect(submitPlanOf(draft({ kind: "benchmark" }), true)).toEqual({ kind: "unwired" });
  });

  test("testRowsOf keeps the kind and status filters, the conversation scope, and puts the newest first", () => {
    const records = [
      record({ testId: "old", startedAt: "2026-11-01T00:00:00.000Z" }),
      record({ testId: "new", startedAt: "2026-11-03T00:00:00.000Z", state: "failed" }),
      record({ testId: "run", kind: "testRun", state: "running", threadId: "thr_9", replay: null }),
    ];
    expect(testRowsOf(records, ALL_TESTS, null).map((row) => row.testId)).toEqual([
      "run",
      "new",
      "old",
    ]);
    expect(
      testRowsOf(records, { kind: "replay", status: "all" }, null).map((row) => row.testId),
    ).toEqual(["new", "old"]);
    expect(
      testRowsOf(records, { kind: "all", status: "failed" }, null).map((row) => row.testId),
    ).toEqual(["new"]);
    expect(testRowsOf(records, ALL_TESTS, "thr_9").map((row) => row.testId)).toEqual(["run"]);
    expect(testRowsOf([], ALL_TESTS, null)).toEqual([]);
  });

  test("replayVerdictOf reads the failure kind first, then digest differs when the cuts do not all match", () => {
    expect(replayVerdictOf(report())).toEqual({ kind: "same" });
    expect(
      replayVerdictOf(
        report({ ok: false, passed: 39, firstDiff: 212, cuts: cutsOf(41, [40, 41]) }),
      ),
    ).toEqual({
      kind: "digest-differs",
    });
    expect(replayVerdictOf(report({ ok: false, failure: "effects-doubled" }))).toEqual({
      kind: "failure",
      failure: "effects-doubled",
    });
  });

  test("cutStripOf paints each commit by its own cut, same or differs, in commit order", () => {
    const strip = cutStripOf(report({ commits: 3, passed: 2, ok: false, cuts: cutsOf(3, [2]) }));
    expect(strip.cells).toEqual([
      { commitIndex: 1, cell: "same" },
      { commitIndex: 2, cell: "differs" },
      { commitIndex: 3, cell: "same" },
    ]);
    expect(strip.hidden).toBe(0);
  });

  test("cutStripOf caps the drawn cells and counts the rest as hidden", () => {
    const commits = CUT_STRIP_LIMIT + 5;
    const long = cutStripOf(report({ commits, passed: commits, cuts: cutsOf(commits) }));
    expect(long.cells).toHaveLength(CUT_STRIP_LIMIT);
    expect(long.cells.at(-1)).toEqual({ commitIndex: CUT_STRIP_LIMIT, cell: "same" });
    expect(long.hidden).toBe(5);
  });

  test("cutStripOf counts commits without a cut as hidden and draws nothing for a report with no commits", () => {
    const short = cutStripOf(report({ commits: 10, passed: 4, cuts: cutsOf(4, [3]) }));
    expect(short.cells.map((cell) => cell.cell)).toEqual(["same", "same", "differs", "same"]);
    expect(short.hidden).toBe(6);
    const none = cutStripOf(
      report({ commits: 0, passed: 0, ok: false, cuts: [], failure: "no-commits" }),
    );
    expect(none).toEqual({ commits: 0, passed: 0, cells: [], hidden: 0 });
  });

  test("effectRowsOf keeps the wire order turn, spawn, delegate, post", () => {
    expect(effectRowsOf(report()).map((row) => `${row.key}:${row.value}`)).toEqual([
      "turn:0",
      "spawn:0",
      "delegate:0",
      "post:1",
    ]);
  });

  test("reportJsonOf copies the report as it is, pretty printed", () => {
    const value = report({ ok: false, passed: 39, firstDiff: 212, cuts: cutsOf(41, [40, 41]) });
    expect(reportJsonOf(value)).toBe(JSON.stringify(value, null, 2));
    expect(JSON.parse(reportJsonOf(value))).toEqual(value);
  });

  test("runControlsOf offers pause on a running Test run, resume and one boundary only while paused, and nothing for replay", () => {
    expect(runControlsOf(rowOf(), false)).toEqual(["pause"]);
    expect(runControlsOf(rowOf(), true)).toEqual(["resume", "step"]);
    expect(runControlsOf(rowOf({ state: "passed" }), false)).toEqual([]);
    expect(runControlsOf(rowOf({ kind: "replay", threadId: null }), false)).toEqual([]);
  });

  test("draftErrorsOf checks the target, the replay commit limit and the benchmark runs", () => {
    expect(draftErrorsOf(draft({ target: "  " }))).toEqual([
      { field: "target", reason: "required" },
    ]);
    expect(draftErrorsOf(draft({ maxCommits: "0" }))).toEqual([
      { field: "maxCommits", reason: "range" },
    ]);
    expect(draftErrorsOf(draft({ maxCommits: "100001" }))).toEqual([
      { field: "maxCommits", reason: "range" },
    ]);
    expect(draftErrorsOf(draft({ maxCommits: "200" }))).toEqual([]);
    expect(draftErrorsOf(draft({ kind: "benchmark", runs: "51" }))).toEqual([
      { field: "runs", reason: "range" },
    ]);
    expect(draftErrorsOf(draft({ kind: "testRun", target: "" }))).toEqual([]);
  });

  test("the screen reducer keeps pause state per Test run and resets the sheet on close", () => {
    const paused = testsUiReducer(INITIAL_TESTS_UI, {
      type: "controlDone",
      threadId: "thr_1",
      paused: true,
    });
    expect(paused.paused["thr_1"]).toBe(true);
    const opened = testsUiReducer(paused, { type: "sheetOpen" });
    expect(opened.sheet).toEqual(NEW_TEST_DEFAULT);
    const closed = testsUiReducer(opened, { type: "sheetClose" });
    expect(closed.sheet).toBeNull();
    expect(closed.paused["thr_1"]).toBe(true);
  });
});
