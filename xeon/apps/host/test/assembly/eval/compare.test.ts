import { expect, test } from "bun:test";
import {
  compareRuns,
  exactSignTest,
  isNoisy,
  planRuns,
  type CasePair,
} from "../../../src/assembly/eval/compare.ts";

// T-TEST-AB: 기획서 §6 표의 값(p ≈ 0.063, 0.031, 0.070, 0.039, 0.039)과 판정.

function near(value: number, expected: number): void {
  expect(Math.abs(value - expected)).toBeLessThan(0.0006);
}

test("the exact sign test gives the planning table's p values", () => {
  near(exactSignTest(5, 0), 0.0625);
  near(exactSignTest(6, 0), 0.03125);
  near(exactSignTest(7, 1), 0.0703);
  near(exactSignTest(8, 1), 0.0391);
  near(exactSignTest(10, 2), 0.0386);
  expect(exactSignTest(0, 0)).toBe(1);
  expect(exactSignTest(3, 3)).toBe(1);
});

/** 통과 횟수만 다른 케이스 묶음: better는 b만 통과, worse는 a만 통과, same은 둘 다 통과 */
function pairs(better: number, worse: number, same: number): CasePair[] {
  const out: CasePair[] = [];
  for (let i = 0; i < better; i += 1)
    out.push({ id: `b${String(i)}`, a: [false, false], b: [true, false] });
  for (let i = 0; i < worse; i += 1)
    out.push({ id: `w${String(i)}`, a: [true, true], b: [false, true] });
  for (let i = 0; i < same; i += 1)
    out.push({ id: `s${String(i)}`, a: [true, false], b: [false, true] });
  return out;
}

test("verdicts: 5 better of 20 stay indistinguishable, 6 better with 0 worse improve, 8 vs 1 improve, a mirror regresses", () => {
  expect(compareRuns(pairs(5, 0, 15))).toMatchObject({
    better: 5,
    worse: 0,
    same: 15,
    cases: 20,
    verdict: "indistinguishable",
  });
  expect(compareRuns(pairs(6, 0, 14)).verdict).toBe("improved");
  expect(compareRuns(pairs(8, 1, 11)).verdict).toBe("improved");
  expect(compareRuns(pairs(0, 6, 14)).verdict).toBe("regressed");
  expect(compareRuns(pairs(5, 1, 14))).toMatchObject({ verdict: "indistinguishable" });
  expect(compareRuns([])).toMatchObject({ cases: 0, pValue: 1, verdict: "indistinguishable" });
});

test("a same-profile comparison that is not indistinguishable marks the case set as noisy", () => {
  expect(isNoisy(compareRuns(pairs(1, 1, 18)))).toBe(false);
  expect(isNoisy(compareRuns(pairs(7, 0, 13)))).toBe(true);
});

test("the plan is 120 runs for 20 cases, 3 repeats, both sides, plus 60 for the first noise measurement", () => {
  expect(
    planRuns({ cases: 20, repeats: 3, needsAA: true, perRunUsd: { low: 0.05, high: 0.5 } }),
  ).toEqual({
    comparisonRuns: 120,
    aaRuns: 60,
    totalRuns: 180,
    costUsd: { low: 9, high: 90 },
  });
  expect(
    planRuns({ cases: 20, repeats: 3, needsAA: false, perRunUsd: { low: 0.1, high: 0.1 } }),
  ).toMatchObject({ aaRuns: 0, totalRuns: 120 });
});
