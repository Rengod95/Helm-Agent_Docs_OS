import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cellsOf,
  countStatuses,
  describeProblem,
  scanLedger,
  type LedgerProblem,
  type LedgerScan,
} from "./req-ledger.ts";

const HEADER = "| ID | 층 | 바꿀 내용 | 순서 | 상태 |\n|---|---|---|---|---|";
const CARRY_HEADER = "| 이월 항목 | 트랙 id |\n|---|---|";

function scanOk(text: string): LedgerScan {
  const scanned = scanLedger(text);
  if (!scanned.ok) throw new Error(`scan failed: ${scanned.error}`);
  return scanned.value;
}

test("cells keep an escaped pipe inside their cell and drop the outer empties", () => {
  expect(cellsOf("| a | b\\|c | d |")).toEqual(["a", "b\\|c", "d"]);
});

test("the status column is read even when an earlier cell holds an escaped pipe", () => {
  const scanned = scanOk(`${HEADER}\n| M3-REQ-03 | F | safe\\|unsafe 유지 | 0 | M3a |\n`);
  expect(scanned.requirements).toEqual([{ id: "M3-REQ-03", line: 3, status: "M3a" }]);
  expect(scanned.problems).toEqual([]);
});

test("a row without a status is a missing_status problem with its line", () => {
  const scanned = scanOk(`${HEADER}\n| M3-REQ-05 | F | x | 0 |  |\n`);
  expect(scanned.problems).toEqual([{ kind: "missing_status", id: "M3-REQ-05", line: 3 }]);
});

test("an M3b status without a track id is missing_track; an unknown word is unknown_status", () => {
  const scanned = scanOk(
    `${HEADER}\n| M3-REQ-06 | F | x | 0 | M3b: |\n| M3-REQ-07 | F | x | 0 | M5 |\n`,
  );
  expect(scanned.problems).toEqual([
    { kind: "missing_track", id: "M3-REQ-06", line: 3, status: "M3b:" },
    { kind: "unknown_status", id: "M3-REQ-07", line: 4, status: "M5" },
  ]);
});

test("M3a, M4 and M3b with a track id are all valid, and counts keep the status names", () => {
  const scanned = scanOk(
    `${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n| M3-REQ-02 | F | x | 0 | M4 |\n| M3-REQ-03 | F | x | 0 | M3b:B3-L1M |\n| M3-REQ-04 | F | x | 0 | M3b:B3-L1M |\n`,
  );
  expect(scanned.problems).toEqual([]);
  expect(countStatuses(scanned.requirements)).toEqual([
    ["M3a", 1],
    ["M3b:B3-L1M", 2],
    ["M4", 1],
  ]);
});

test("a repeated M3-REQ id is a duplicate_id problem", () => {
  const scanned = scanOk(
    `${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n| M3-REQ-01 | F | x | 0 | M3a |\n`,
  );
  expect(scanned.problems).toEqual([{ kind: "duplicate_id", id: "M3-REQ-01", line: 4 }]);
});

test("a carry-over row needs a track id; a filled row is valid", () => {
  const scanned = scanOk(
    `${CARRY_HEADER}\n| 입력 출처 칸 | B0-F |\n| 빈 트랙 항목 |  |\n\n${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n`,
  );
  expect(scanned.carryover).toEqual([
    { item: "입력 출처 칸", line: 3, track: "B0-F" },
    { item: "빈 트랙 항목", line: 4, track: "" },
  ]);
  expect(scanned.problems).toEqual([
    { kind: "carryover_missing_track", item: "빈 트랙 항목", line: 4, track: "" },
  ]);
});

test("tables without a 상태 or 트랙 id column are ignored; text with no M3-REQ rows is an error", () => {
  expect(scanLedger("| 트랙 | 요구 행 |\n|---|---|\n| L3 Helm | F 01 |\n")).toEqual({
    ok: false,
    error: "no M3-REQ rows found",
  });
});

test("each problem kind names the row and its line", () => {
  const problems: readonly LedgerProblem[] = [
    { kind: "missing_status", id: "M3-REQ-05", line: 3 },
    { kind: "missing_track", id: "M3-REQ-06", line: 4, status: "M3b:" },
  ];
  expect(problems.map(describeProblem)).toEqual([
    "M3-REQ-05 has no status (line 3)",
    'M3-REQ-06 has status "M3b:" (line 4) without a track id',
  ]);
});

test("the repository ledger has a valid status on all 112 rows and a track on every carry-over item", () => {
  const text = readFileSync(
    join(import.meta.dir, "../../docs/xeon/review/m3-lower-requirements.md"),
    "utf8",
  );
  const scanned = scanOk(text);
  expect(scanned.requirements.length).toBe(112);
  expect(scanned.problems).toEqual([]);
  expect(scanned.carryover.length).toBeGreaterThan(0);
  const byId = new Map(scanned.requirements.map((row) => [row.id, row.status]));
  expect(byId.get("M3-REQ-112")).toBe("M3b:B4-I18N");
  expect(byId.get("M3-REQ-33")).toBe("M3a");
});
