import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { NO_EFFECTS, replayDrive } from "../src/testing/index.ts";
import {
  badDriveGroup,
  doubledEffectGroup,
  goodDriveGroup,
  onceEffectGroup,
  silentDriveGroup,
} from "./fixtures/drive-groups.ts";
import {
  createReplayHarness,
  threadMismatches,
  type CountingReplayHarness,
} from "./support/replay-harness.ts";

/**
 * 실행마다 `harness.thread()`를 기록하는 하니스. `threadOf(실행 번호, 실제 thread)`가 기록할 값을 정한다.
 * 기본은 실제 값을 그대로 적는 것이고, 시험은 한 실행의 값을 바꿔 검사가 그것을 잡는지 본다.
 */
function recordingHarness(threadOf: (run: number, actual: ThreadId) => ThreadId): {
  readonly harness: CountingReplayHarness;
  readonly threads: ThreadId[];
} {
  const base = createReplayHarness();
  const threads: ThreadId[] = [];
  const harness: CountingReplayHarness = {
    ...base,
    async run(group, restore) {
      const result = await base.run(group, restore);
      const actual = base.thread();
      if (actual !== undefined) threads.push(threadOf(threads.length, actual));
      return result;
    },
  };
  return { harness, threads };
}

test("replay.every-run-uses-the-baseline-thread-id", async () => {
  const { harness, threads } = recordingHarness((_run, actual) => actual);
  const report = await replayDrive({ group: goodDriveGroup(), harness });
  expect(report.ok).toBe(true);
  // 기준 실행 하나와 절단 실행 커밋 수만큼, 모두 같은 thread id를 써야 한다
  expect(threads).toHaveLength(report.commits + 1);
  expect(threads[0]).toMatch(/^thr_[0-9A-Z]{26}$/);
  expect(threadMismatches(threads)).toEqual([]);
});

test("replay.thread-check-reports-a-run-on-another-thread", async () => {
  const other = fixedIdFactory(1000).next("thr");
  const { harness, threads } = recordingHarness((run, actual) => (run === 2 ? other : actual));
  const report = await replayDrive({ group: goodDriveGroup(), harness });
  // 이벤트열 비교는 ID를 자리표시자로 바꾸므로 이 실행도 통과한다. thread 검사만 세 번째 실행(번호 2)을 잡는다
  expect(report.ok).toBe(true);
  expect(threadMismatches(threads)).toEqual([2]);
});

test("replay.thread-check-lists-every-run-that-differs-from-the-first", () => {
  expect(threadMismatches(["thr_a", "thr_a", "thr_a"])).toEqual([]);
  expect(threadMismatches(["thr_a", "thr_b", "thr_a", "thr_c"])).toEqual([1, 3]);
});

test("replay.cut-at-every-commit-yields-same-events", async () => {
  const report = await replayDrive({ group: goodDriveGroup(), harness: createReplayHarness() });
  expect(report.failure).toBeUndefined();
  expect(report.commits).toBe(3);
  expect(report.cuts.map((cut) => cut.commitIndex)).toEqual([1, 2, 3]);
  expect(report.cuts.every((cut) => cut.equal && cut.firstDiff === null)).toBe(true);
  expect(report.cuts.every((cut) => cut.digest === report.baselineDigest)).toBe(true);
  expect(report.ok).toBe(true);
});

test("replay.detects-closure-state", async () => {
  const report = await replayDrive({ group: badDriveGroup(), harness: createReplayHarness() });
  expect(report.ok).toBe(false);
  const bad = report.cuts.filter((cut) => !cut.equal);
  expect(bad.length).toBeGreaterThan(0);
  for (const cut of bad) expect(typeof cut.firstDiff).toBe("number");
});

test("replay.fails-when-the-run-has-nothing-to-cut", async () => {
  const report = await replayDrive({ group: silentDriveGroup(), harness: createReplayHarness() });
  expect(report).toMatchObject({ ok: false, failure: "no-commits", commits: 0, cuts: [] });
});

test("replay.fails-above-the-commit-limit", async () => {
  const report = await replayDrive({
    group: goodDriveGroup(),
    harness: createReplayHarness(),
    maxCommits: 2,
  });
  expect(report).toMatchObject({ ok: false, failure: "max-commits-exceeded", commits: 3 });
});

test("replay.counts-effects-and-asserts-each-happened-once", async () => {
  const harness = createReplayHarness();
  const report = await replayDrive({
    group: onceEffectGroup(harness),
    harness,
    expectEffects: { turn: 3, spawn: 3, delegate: 3, post: 3 },
  });
  expect(report.failure).toBeUndefined();
  expect(report.effects).toEqual({ turn: 3, spawn: 3, delegate: 3, post: 3 });
  expect(report.cuts.map((cut) => cut.effects)).toEqual([NO_EFFECTS, NO_EFFECTS, NO_EFFECTS]);
  expect(report.cuts.every((cut) => cut.equal)).toBe(true);
  expect(report.ok).toBe(true);
});

test("replay.fails-with-effects-doubled-when-events-match-but-effects-repeat", async () => {
  const harness = createReplayHarness();
  const report = await replayDrive({ group: doubledEffectGroup(harness), harness });
  // 가짜 루프·큐·위임 서비스는 이벤트를 쓰지 않으므로 이벤트열 비교만으로는 통과한다
  expect(report.cuts.every((cut) => cut.equal)).toBe(true);
  expect(report).toMatchObject({ ok: false, failure: "effects-doubled" });
  const repeated = report.cuts.map((cut) => cut.effects?.turn);
  expect(repeated.some((count) => count !== undefined && count > 0)).toBe(true);
});

test("replay.fails-with-effects-mismatch-when-the-baseline-count-is-not-as-expected", async () => {
  const harness = createReplayHarness();
  const report = await replayDrive({
    group: onceEffectGroup(harness),
    harness,
    expectEffects: { delegate: 1 },
  });
  expect(report).toMatchObject({ ok: false, failure: "effects-mismatch" });
  expect(report.effects?.delegate).toBe(3);
});
