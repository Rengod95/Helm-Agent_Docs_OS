import { expect, test } from "bun:test";
import { NO_EFFECTS, replayDrive } from "../src/testing/index.ts";
import {
  badDriveGroup,
  doubledEffectGroup,
  goodDriveGroup,
  onceEffectGroup,
  silentDriveGroup,
} from "./fixtures/drive-groups.ts";
import { createReplayHarness } from "./support/replay-harness.ts";

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
    expectEffects: { turn: 3, spawn: 3, delegate: 3, post: 3, capabilityWrite: 0 },
  });
  expect(report.failure).toBeUndefined();
  expect(report.effects).toEqual({ turn: 3, spawn: 3, delegate: 3, capabilityWrite: 0, post: 3 });
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
