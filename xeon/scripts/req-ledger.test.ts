import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cellsOf,
  countStatuses,
  declaredTracks,
  describeProblem,
  scanLedger,
  type LedgerProblem,
  type LedgerScan,
} from "./req-ledger.ts";

const HEADER = "| ID | 층 | 바꿀 내용 | 순서 | 상태 |\n|---|---|---|---|---|";
const CARRY_HEADER = "| 이월 항목 | 트랙 id |\n|---|---|";
/** 단위 시험이 쓰는 선언된 트랙. 실제 목록은 아래 저장소 시험이 m3b-plan에서 읽는다 */
const TEST_TRACKS: ReadonlySet<string> = new Set(["B0-F", "B1-NTF", "B3-L1M", "B4-GRP"]);

function scanOk(text: string, tracks: ReadonlySet<string> = TEST_TRACKS): LedgerScan {
  const scanned = scanLedger(text, tracks);
  if (!scanned.ok) throw new Error(`scan failed: ${scanned.error}`);
  return scanned.value;
}

function readRepoFile(relative: string): string {
  return readFileSync(join(import.meta.dir, "../..", relative), "utf8");
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

test("a track id the plan does not declare is unknown_track, so the typo B9-X fails", () => {
  const scanned = scanOk(`${HEADER}\n| M3-REQ-08 | F | x | 0 | M3b:B9-X |\n`);
  expect(scanned.problems).toEqual([
    {
      kind: "unknown_track",
      id: "M3-REQ-08",
      line: 3,
      status: "M3b:B9-X",
      track: "B9-X",
    },
  ]);
});

test("M3a, M3b, M4 and M3b with a declared track id are all valid, and counts keep the status names", () => {
  const scanned = scanOk(
    `${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n| M3-REQ-02 | F | x | 0 | M4 |\n| M3-REQ-03 | F | x | 0 | M3b:B3-L1M |\n| M3-REQ-04 | F | x | 0 | M3b:B3-L1M |\n| M3-REQ-05 | F | x | 0 | M3b |\n`,
  );
  expect(scanned.problems).toEqual([]);
  expect(countStatuses(scanned.requirements)).toEqual([
    ["M3a", 1],
    ["M3b", 1],
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

test("a carry-over row needs a declared track id; an empty or undeclared one is a problem", () => {
  const scanned = scanOk(
    `${CARRY_HEADER}\n| 입력 출처 칸 | B0-F |\n| 빈 트랙 항목 |  |\n| 오타 항목 | B9-X |\n\n${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n`,
  );
  expect(scanned.carryover).toEqual([
    { item: "입력 출처 칸", line: 3, track: "B0-F" },
    { item: "빈 트랙 항목", line: 4, track: "" },
    { item: "오타 항목", line: 5, track: "B9-X" },
  ]);
  expect(scanned.problems).toEqual([
    { kind: "carryover_missing_track", item: "빈 트랙 항목", line: 4, track: "" },
    { kind: "carryover_unknown_track", item: "오타 항목", line: 5, track: "B9-X" },
  ]);
});

test("tables without a 상태 or 트랙 id column are ignored; text with no M3-REQ rows is an error", () => {
  expect(scanLedger("| 트랙 | 요구 행 |\n|---|---|\n| L3 Helm | F 01 |\n", TEST_TRACKS)).toEqual({
    ok: false,
    error: "no M3-REQ rows found",
  });
});

test("declaredTracks reads the bold track headings of section 2 only", () => {
  const plan = [
    "## 1. 범위 요약",
    "**B9-OUT 범위 밖**",
    "## 2. 차수와 트랙",
    "### B0 준비 (병렬 4)",
    "",
    "**B0-F F 계약 M3b 묶음** · Sonnet medium · `contracts`만 · M",
    "**B1-SVC 공유 서비스 모드** · Sonnet medium · L",
    "## 3. 충돌과 병렬",
    "**B7-LATE 뒤의 절** · S",
  ].join("\n");
  const declared = declaredTracks(plan);
  expect(declared.ok && [...declared.value]).toEqual(["B0-F", "B1-SVC"]);
});

test("a plan section 2 with no track headings is an error, not an empty track set", () => {
  expect(declaredTracks("## 2. 차수와 트랙\n\n본문만 있다\n")).toEqual({
    ok: false,
    error: "no track headings (**B<n>-<ID>) in section 2",
  });
});

test("the repository plan declares the 27 tracks of sections B0 to B5 and the follow-ups", () => {
  const declared = declaredTracks(readRepoFile("docs/xeon/review/m3b-plan.md"));
  expect(declared.ok && declared.value.size).toBe(27);
  expect(declared.ok && declared.value.has("B0-F")).toBe(true);
  expect(declared.ok && declared.value.has("B5-DOC")).toBe(true);
  expect(declared.ok && declared.value.has("B9-X")).toBe(false);
});

test("each problem kind names the row and its line", () => {
  const problems: readonly LedgerProblem[] = [
    { kind: "missing_status", id: "M3-REQ-05", line: 3 },
    { kind: "missing_track", id: "M3-REQ-06", line: 4, status: "M3b:" },
    { kind: "unknown_track", id: "M3-REQ-08", line: 5, status: "M3b:B9-X", track: "B9-X" },
  ];
  expect(problems.map(describeProblem)).toEqual([
    "M3-REQ-05 has no status (line 3)",
    'M3-REQ-06 has status "M3b:" (line 4) without a track id',
    'M3-REQ-08 has status "M3b:B9-X" (line 5), but m3b-plan §2 declares no track B9-X',
  ]);
});

test("the repository ledger has a valid status on all 112 rows and a declared track on every carry-over item", () => {
  const declared = declaredTracks(readRepoFile("docs/xeon/review/m3b-plan.md"));
  if (!declared.ok) throw new Error(`plan scan failed: ${declared.error}`);
  const scanned = scanOk(readRepoFile("docs/xeon/review/m3-lower-requirements.md"), declared.value);
  expect(scanned.requirements.length).toBe(112);
  expect(scanned.problems).toEqual([]);
  expect(scanned.carryover.length).toBeGreaterThan(0);
  const byId = new Map(scanned.requirements.map((row) => [row.id, row.status]));
  expect(byId.get("M3-REQ-112")).toBe("M4");
  expect(byId.get("M3-REQ-33")).toBe("M3a");
});
