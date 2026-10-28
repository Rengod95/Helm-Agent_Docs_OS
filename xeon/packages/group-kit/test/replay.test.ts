import { expect, test } from "bun:test";
import { replayDrive } from "../src/testing/index.ts";
import { badDriveGroup, goodDriveGroup, silentDriveGroup } from "./fixtures/drive-groups.ts";
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
