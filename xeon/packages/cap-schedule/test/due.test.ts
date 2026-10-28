import { expect, test } from "bun:test";
import { planDue } from "../src/index.ts";

const policy = { lateGraceMs: 120_000, maxCatchUpMs: 24 * 3_600_000 };
const EVERY = 300_000;

test("a due that is on time fires once and is not marked missed", () => {
  const plan = planDue(1_000_000, EVERY, 1_000_000 + 5_000, policy);
  expect(plan).toEqual({
    fire: { dueAt: 1_000_000, missed: false },
    skipped: null,
    nextDueAt: 1_000_000 + EVERY,
  });
});

test("a due in the future does nothing", () => {
  expect(planDue(2_000_000, EVERY, 1_000_000, policy)).toEqual({
    fire: null,
    skipped: null,
    nextDueAt: 2_000_000,
  });
});

test("after a long gap only the latest due runs, as one missed catch-up; earlier dues are skipped as missed", () => {
  // 10번의 기한이 밀렸고 가장 늦은 기한은 130초 전이다
  const now = 1_000_000 + 10 * EVERY + 130_000;
  const plan = planDue(1_000_000, EVERY, now, policy);
  expect(plan.fire).toEqual({ dueAt: 1_000_000 + 10 * EVERY, missed: true });
  expect(plan.skipped).toEqual({ count: 10, firstDueAt: 1_000_000, reason: "missed" });
  expect(plan.nextDueAt).toBe(1_000_000 + 11 * EVERY);
});

test("when the latest due is on time, the older dues are skipped and the run is not marked missed", () => {
  const now = 1_000_000 + 3 * EVERY + 10_000;
  const plan = planDue(1_000_000, EVERY, now, policy);
  expect(plan.fire).toEqual({ dueAt: 1_000_000 + 3 * EVERY, missed: false });
  expect(plan.skipped).toEqual({ count: 3, firstDueAt: 1_000_000, reason: "missed" });
});

test("a single due older than the catch-up window is skipped as too_old and nothing runs", () => {
  const now = 1_000_000 + 25 * 3_600_000;
  expect(planDue(1_000_000, null, now, policy)).toEqual({
    fire: null,
    skipped: { count: 1, firstDueAt: 1_000_000, reason: "too_old" },
    nextDueAt: null,
  });
});

test("a repeating due is never too_old because its latest due is always within one period of now", () => {
  const now = 1_000_000 + 400 * EVERY + 200_000;
  const plan = planDue(1_000_000, EVERY, now, policy);
  expect(plan.fire).toEqual({ dueAt: 1_000_000 + 400 * EVERY, missed: true });
  expect(plan.nextDueAt).toBeGreaterThan(now);
});

test("a single missed due without repeat catches up once and has no next due", () => {
  const plan = planDue(1_000_000, null, 1_000_000 + 10 * 60_000, policy);
  expect(plan).toEqual({
    fire: { dueAt: 1_000_000, missed: true },
    skipped: null,
    nextDueAt: null,
  });
});
