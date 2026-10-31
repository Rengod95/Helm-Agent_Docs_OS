import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cellsOf,
  countStatuses,
  describeProblem,
  isAllowedStatus,
  scanGaps,
  type GapScan,
} from "./caustic-gaps.ts";

const HEADER =
  "## 9. caustic 부품 간극\n\n| id | 필요 | 쓰는 화면 | 지금 대용 | 권장 | 상태 |\n|---|---|---|---|---|---|";

function scanOk(text: string): GapScan {
  const scanned = scanGaps(text);
  if (!scanned.ok) throw new Error(`scan failed: ${scanned.error}`);
  return scanned.value;
}

test("cells keep an escaped pipe inside their cell", () => {
  expect(cellsOf("| a | b\\|c | d |")).toEqual(["a", "b|c", "d"]);
});

test("allowed statuses take an optional parenthesised note and nothing else", () => {
  expect(isAllowedStatus("caustic 반영")).toBe(true);
  expect(isAllowedStatus("앱 조합 (버튼 메뉴)")).toBe(true);
  expect(isAllowedStatus("M5")).toBe(true);
  expect(isAllowedStatus("caustic 대기 (T-CAU2)")).toBe(true);
  expect(isAllowedStatus("M5 나중에")).toBe(false);
  expect(isAllowedStatus("제안")).toBe(false);
});

test("a row without a status is a missing_status problem with its line", () => {
  const scanned = scanOk(`${HEADER}\n| C-01 | a | b | c | d |  |\n`);
  expect(scanned.problems).toEqual([{ kind: "missing_status", id: "C-01", line: 5 }]);
});

test("an unknown status, a repeated id and a skipped id are each reported", () => {
  const scanned = scanOk(
    `${HEADER}\n| C-01 | a | b | c | d | 제안 |\n| C-01 | a | b | c | d | M5 |\n| C-03 | a | b | c | d | M5 |\n`,
  );
  expect(scanned.problems.map((p) => p.kind)).toEqual([
    "unknown_status",
    "duplicate_id",
    "gap_in_ids",
  ]);
  expect(describeProblem(scanned.problems[0]!)).toContain("허용 값");
});

test("counts group a noted status under its base value", () => {
  const scanned = scanOk(
    `${HEADER}\n| C-01 | a | b | c | d | caustic 반영 |\n| C-02 | a | b | c | d | caustic 반영 (T-CAU2) |\n| C-03 | a | b | c | d | M5 |\n`,
  );
  expect(countStatuses(scanned.rows)).toEqual([
    ["caustic 반영", 2],
    ["M5", 1],
  ]);
});

test("a table without a 상태 column fails the scan", () => {
  const scanned = scanGaps("## 9. x\n\n| id | 필요 |\n|---|---|\n| C-01 | a |\n");
  expect(scanned.ok).toBe(false);
});

test("spec §9 gives every C item a status (Y13)", () => {
  const text = readFileSync(join(import.meta.dir, "../../docs/xeon/L4/desktop-ux/spec.md"), "utf8");
  const scanned = scanOk(text);
  expect(scanned.problems.map(describeProblem)).toEqual([]);
  expect(scanned.rows.length).toBe(39);
});
