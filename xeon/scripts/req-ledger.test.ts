import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cellsOf,
  countCarryover,
  countStatuses,
  declaredTracks,
  describeProblem,
  scanLedger,
  type DeclaredTracks,
  type LedgerProblem,
  type LedgerScan,
} from "./req-ledger.ts";

const HEADER = "| ID | 층 | 바꿀 내용 | 순서 | 상태 |\n|---|---|---|---|---|";
const CARRY_HEADER = "| 이월 항목 | 트랙 id |\n|---|---|";
/** 단위 시험이 쓰는 선언된 트랙. 실제 목록은 아래 저장소 시험이 m3b-plan과 m4-plan에서 읽는다 */
const TEST_TRACKS: DeclaredTracks = {
  m3b: new Set(["B0-F", "B1-NTF", "B3-L1M", "B4-GRP"]),
  m4: new Set(["T-LED", "T-RT1", "T-I18N"]),
};

function scanOk(text: string, tracks: DeclaredTracks = TEST_TRACKS): LedgerScan {
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

test("an M4 status names a track of m4-plan only: M4:T-RT1 is valid, M4:B3-L1M, M3b:T-RT1 and M4: are problems", () => {
  const scanned = scanOk(
    `${HEADER}\n| M3-REQ-01 | F | x | 0 | M4:T-RT1 |\n| M3-REQ-02 | F | x | 0 | M4:B3-L1M |\n| M3-REQ-03 | F | x | 0 | M3b:T-RT1 |\n| M3-REQ-04 | F | x | 0 | M4: |\n`,
  );
  expect(scanned.problems).toEqual([
    { kind: "unknown_track", id: "M3-REQ-02", line: 4, status: "M4:B3-L1M", track: "B3-L1M" },
    { kind: "unknown_track", id: "M3-REQ-03", line: 5, status: "M3b:T-RT1", track: "T-RT1" },
    { kind: "missing_track", id: "M3-REQ-04", line: 6, status: "M4:" },
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

test("a carry-over cell takes a track id of either plan, M4, or M5 and 삭제 with a reason", () => {
  const scanned = scanOk(
    `${CARRY_HEADER}\n| M4 항목 | T-RT1 |\n| M3b 항목 | B0-F |\n| 완료 항목 | M4 |\n| 이월 항목 | M5: 사용자 묶음 |\n| 지운 항목 | 삭제: 다른 항목과 중복 |\n| 사유 없는 이월 | M5: |\n| 사유 없는 삭제 | 삭제: |\n| 줄인 이월 | M5 |\n| 없는 트랙 | T-NOPE |\n\n${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n`,
  );
  expect(scanned.problems).toEqual([
    { kind: "carryover_missing_reason", item: "사유 없는 이월", line: 8, track: "M5:" },
    { kind: "carryover_missing_reason", item: "사유 없는 삭제", line: 9, track: "삭제:" },
    { kind: "carryover_unknown_track", item: "줄인 이월", line: 10, track: "M5" },
    { kind: "carryover_unknown_track", item: "없는 트랙", line: 11, track: "T-NOPE" },
  ]);
});

test("a carry-over cell also takes M4 after a merge, a user decision and will not do, each with its detail", () => {
  const scanned = scanOk(
    `${CARRY_HEADER}\n| 합류 대기 | M4: after audit2 merge |\n| 합류 대기 설명 | M4: after audit3 merge (owner gap: audit3 does not fix it) |\n| 사용자 결정 | user decision: sheet A1 |\n| 권고 | user decision: recommend option 2 |\n| 하지 않음 | will not do: no CLI surface |\n| 합류 대상 없음 | M4: after merge |\n| 사유 없는 결정 | user decision: |\n| 사유 없는 불가 | will not do: |\n\n${HEADER}\n| M3-REQ-01 | F | x | 0 | M3a |\n`,
  );
  expect(scanned.problems).toEqual([
    { kind: "carryover_unknown_track", item: "합류 대상 없음", line: 8, track: "M4: after merge" },
    { kind: "carryover_missing_reason", item: "사유 없는 결정", line: 9, track: "user decision:" },
    { kind: "carryover_missing_reason", item: "사유 없는 불가", line: 10, track: "will not do:" },
  ]);
});

test("countCarryover counts the owner-wait, user decision and will-not-do cells under their own words", () => {
  expect(
    countCarryover([
      { item: "a", line: 1, track: "M4: after audit2 merge" },
      { item: "b", line: 2, track: "M4: after safe3 merge" },
      { item: "c", line: 3, track: "user decision: sheet A1" },
      { item: "d", line: 4, track: "will not do: no CLI surface" },
    ]),
  ).toEqual([
    ["M4 (after merge)", 2],
    ["user decision", 1],
    ["will not do", 1],
  ]);
});

test("countCarryover counts a track id under itself and M5 and 삭제 under their words", () => {
  expect(
    countCarryover([
      { item: "a", line: 1, track: "T-RT1" },
      { item: "b", line: 2, track: "M5: 사유" },
      { item: "c", line: 3, track: "삭제: 사유" },
      { item: "d", line: 4, track: "T-RT1" },
      { item: "e", line: 5, track: "" },
    ]),
  ).toEqual([
    ["(none)", 1],
    ["M5", 1],
    ["T-RT1", 2],
    ["삭제", 1],
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

test("declaredTracks reads the T- headings of an M4 plan section 2 as well", () => {
  const plan = [
    "## 2. 트랙",
    "**T-LED 요구 장부와 종료 조건** · Haiku xhigh · 문서·`scripts` · S",
    "**T-F F 계약 M4 묶음** · Sonnet medium · `contracts`만 · L",
    "## 3. 대기열",
    "**T-LATE 뒤의 절** · S",
  ].join("\n");
  const declared = declaredTracks(plan);
  expect(declared.ok && [...declared.value]).toEqual(["T-LED", "T-F"]);
});

test("a plan section 2 with no track headings is an error, not an empty track set", () => {
  expect(declaredTracks("## 2. 차수와 트랙\n\n본문만 있다\n")).toEqual({
    ok: false,
    error: "no track headings (**B<n>-<ID> or **T-<ID>) in section 2",
  });
});

test("the repository plan declares the 27 tracks of sections B0 to B5 and the follow-ups", () => {
  const declared = declaredTracks(readRepoFile("docs/xeon/review/m3b-plan.md"));
  expect(declared.ok && declared.value.size).toBe(27);
  expect(declared.ok && declared.value.has("B0-F")).toBe(true);
  expect(declared.ok && declared.value.has("B5-DOC")).toBe(true);
  expect(declared.ok && declared.value.has("B9-X")).toBe(false);
});

test("the repository m4-plan declares the 26 tracks of section 2 and no M3b track", () => {
  const declared = declaredTracks(readRepoFile("docs/xeon/review/m4-plan.md"));
  expect(declared.ok && declared.value.size).toBe(26);
  expect(declared.ok && declared.value.has("T-LED")).toBe(true);
  expect(declared.ok && declared.value.has("T-CLN")).toBe(true);
  expect(declared.ok && declared.value.has("B0-F")).toBe(false);
});

test("each problem kind names the row and its line", () => {
  const problems: readonly LedgerProblem[] = [
    { kind: "missing_status", id: "M3-REQ-05", line: 3 },
    { kind: "missing_track", id: "M3-REQ-06", line: 4, status: "M3b:" },
    { kind: "unknown_track", id: "M3-REQ-08", line: 5, status: "M3b:B9-X", track: "B9-X" },
    { kind: "unknown_track", id: "M3-REQ-09", line: 6, status: "M4:T-NOPE", track: "T-NOPE" },
    { kind: "carryover_missing_reason", item: "항목", line: 7, track: "M5:" },
  ];
  expect(problems.map(describeProblem)).toEqual([
    "M3-REQ-05 has no status (line 3)",
    'M3-REQ-06 has status "M3b:" (line 4) without a track id',
    'M3-REQ-08 has status "M3b:B9-X" (line 5), but m3b-plan §2 declares no track B9-X',
    'M3-REQ-09 has status "M4:T-NOPE" (line 6), but m4-plan §2 declares no track T-NOPE',
    'carry-over item "항목" has "M5:" without a reason (line 7)',
  ]);
});

test("the repository ledger has a valid status on all 112 rows, and every carry-over item has a track, M4, M5 or 삭제", () => {
  const m3b = declaredTracks(readRepoFile("docs/xeon/review/m3b-plan.md"));
  if (!m3b.ok) throw new Error(`m3b-plan scan failed: ${m3b.error}`);
  const m4 = declaredTracks(readRepoFile("docs/xeon/review/m4-plan.md"));
  if (!m4.ok) throw new Error(`m4-plan scan failed: ${m4.error}`);
  const scanned = scanOk(readRepoFile("docs/xeon/review/m3-lower-requirements.md"), {
    m3b: m3b.value,
    m4: m4.value,
  });
  expect(scanned.requirements.length).toBe(112);
  expect(scanned.problems).toEqual([]);
  // §9 holds the 37 M3a carry-over items on M3b tracks; §11 holds the 134 review.m3-plan §9.3 items and M4 additions.
  expect(scanned.carryover.length).toBe(171);
  expect(scanned.carryover.filter((row) => row.track.startsWith("M5:")).length).toBe(43);
  expect(scanned.carryover.filter((row) => row.track.startsWith("삭제:")).length).toBe(2);
  expect(scanned.carryover.filter((row) => row.track.startsWith("user decision:")).length).toBe(9);
  expect(scanned.carryover.filter((row) => row.track.startsWith("will not do:")).length).toBe(1);
  expect(scanned.carryover.filter((row) => row.track.startsWith("M4: after ")).length).toBe(6);
  const byId = new Map(scanned.requirements.map((row) => [row.id, row.status]));
  expect(byId.get("M3-REQ-112")).toBe("M4:T-I18N");
  expect(byId.get("M3-REQ-33")).toBe("M3a");
  expect(scanned.requirements.filter((row) => row.status.startsWith("M4:")).length).toBe(10);
});
