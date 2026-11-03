#!/usr/bin/env bun
// Requirement ledger check for M3 and M4 (review.m3b-plan 3.3 B0-LED, review.m4-plan T-LED). Reads the 상태 column of the
// M3-REQ tables in docs/xeon/review/m3-lower-requirements.md and the 트랙 id column of its carry-over tables. A status
// `M3b:<id>` must name a track that section 2 of docs/xeon/review/m3b-plan.md declares (`**B<n>-<ID>`), and `M4:<id>` one
// that section 2 of docs/xeon/review/m4-plan.md declares (`**T-<ID>`). A carry-over item takes a declared track id, `M4`
// (done in M4), `M5: <reason>` or `삭제: <reason>`. Fails on any other value and prints the counts per status.
//   req-ledger [--file <ledger path>] [--plan <m3b-plan path>] [--m4-plan <m4-plan path>]
// Exit codes: 0 every row and carry-over item is valid, 1 at least one problem (listed on stderr), 2 environment (the
// ledger or a plan cannot be read).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Statuses that take no track: done in M3a, done in M3b (closed at B6), or done in M4. The open forms are `M3b:<track id>` and `M4:<track id>`. */
export const PLAIN_STATUSES: readonly string[] = ["M3a", "M3b", "M4"];
const M3B_PREFIX = "M3b:";
const M4_PREFIX = "M4:";
/** Carry-over cells besides a track id: `M4` (done in M4), and `M5: <reason>` or `삭제: <reason>` with the reason after the colon. */
const DONE_IN_M4 = "M4";
const DEFERRED_PREFIX = "M5:";
const DELETED_PREFIX = "삭제:";
/** `M4: after <track> merge`: M4 work that waits for another running track's merge (an owner gap is stated in the row). */
const OWNER_WAIT = /^M4: after [a-z0-9-]+ merge(?:\b.*)?$/;
/** `user decision: <sheet number or recommended option>`: waits for a user decision; `will not do: <reason>`: closed as out of product scope. */
const USER_DECISION_PREFIX = "user decision:";
const WONT_DO_PREFIX = "will not do:";
const REQ_ID = /^M3-REQ-\d{2,3}$/;
const STATUS_HEADER = "상태";
const TRACK_HEADER = "트랙 id";
/** Relative to xeon/scripts, the directory this file runs from by default. */
const LEDGER_PATH = "../../docs/xeon/review/m3-lower-requirements.md";
const M3B_PLAN_PATH = "../../docs/xeon/review/m3b-plan.md";
const M4_PLAN_PATH = "../../docs/xeon/review/m4-plan.md";
/** `## 2. 차수와 트랙` and `## 2. 트랙` start the sections that declare the tracks. The next `## ` heading ends it. */
const PLAN_TRACK_SECTION = /^## 2\. /;
/** A track heading in that section: `**B0-F F 계약 M3b 묶음** · …` or `**T-LED 요구 장부 …`. The id is the first word after `**`. */
const TRACK_HEADING = /^\*\*((?:B\d+|T)-[A-Z0-9]+)(?=[\s*])/;

/** Track ids each plan declares. An `M3b:` status names a track of m3b-plan, an `M4:` status a track of m4-plan. */
export interface DeclaredTracks {
  readonly m3b: ReadonlySet<string>;
  readonly m4: ReadonlySet<string>;
}

export interface RequirementRow {
  readonly id: string;
  readonly line: number;
  /** Empty when the cell is empty or the table has no 상태 column. */
  readonly status: string;
}

export interface CarryoverRow {
  readonly item: string;
  readonly line: number;
  readonly track: string;
}

export type LedgerProblem =
  | { readonly kind: "missing_status"; readonly id: string; readonly line: number }
  | {
      readonly kind: "unknown_status";
      readonly id: string;
      readonly line: number;
      readonly status: string;
    }
  | {
      readonly kind: "missing_track";
      readonly id: string;
      readonly line: number;
      readonly status: string;
    }
  /** `M3b:<track>` names a track that m3b-plan §2 does not declare (a typo such as `B9-X`); `M4:<track>` the same for m4-plan §2 */
  | {
      readonly kind: "unknown_track";
      readonly id: string;
      readonly line: number;
      readonly status: string;
      readonly track: string;
    }
  | { readonly kind: "duplicate_id"; readonly id: string; readonly line: number }
  | {
      readonly kind: "carryover_missing_track";
      readonly item: string;
      readonly line: number;
      readonly track: string;
    }
  | {
      readonly kind: "carryover_unknown_track";
      readonly item: string;
      readonly line: number;
      readonly track: string;
    }
  /** `M5:` or `삭제:` with nothing after the colon */
  | {
      readonly kind: "carryover_missing_reason";
      readonly item: string;
      readonly line: number;
      readonly track: string;
    };

export interface LedgerScan {
  readonly requirements: readonly RequirementRow[];
  readonly carryover: readonly CarryoverRow[];
  readonly problems: readonly LedgerProblem[];
}

/** Cells of one markdown table row, trimmed. An escaped pipe (`\|`) stays inside its cell. */
export function cellsOf(line: string): readonly string[] {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  return /^\|(\s*:?-+:?\s*\|)+$/.test(line);
}

/**
 * Track ids declared by the bold headings in section 2 of a plan (`**B<n>-<ID>` or `**T-<ID>`). Fails when the section declares
 * none, so a plan that moved or lost its headings cannot make every track look valid.
 */
export function declaredTracks(planText: string): Result<ReadonlySet<string>, string> {
  const tracks = new Set<string>();
  let inSection = false;
  for (const raw of planText.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      inSection = PLAN_TRACK_SECTION.test(line);
      continue;
    }
    if (!inSection) continue;
    const id = TRACK_HEADING.exec(line)?.[1];
    if (id !== undefined) tracks.add(id);
  }
  if (tracks.size === 0) {
    return { ok: false, error: "no track headings (**B<n>-<ID> or **T-<ID>) in section 2" };
  }
  return { ok: true, value: tracks };
}

function prefixedProblem(
  id: string,
  line: number,
  status: string,
  prefix: string,
  declared: ReadonlySet<string>,
): LedgerProblem | undefined {
  const track = status.slice(prefix.length);
  if (track === "") return { kind: "missing_track", id, line, status };
  return declared.has(track) ? undefined : { kind: "unknown_track", id, line, status, track };
}

function statusProblem(
  id: string,
  line: number,
  status: string,
  tracks: DeclaredTracks,
): LedgerProblem | undefined {
  if (status === "") return { kind: "missing_status", id, line };
  if (PLAIN_STATUSES.includes(status)) return undefined;
  if (status.startsWith(M3B_PREFIX)) {
    return prefixedProblem(id, line, status, M3B_PREFIX, tracks.m3b);
  }
  if (status.startsWith(M4_PREFIX)) {
    return prefixedProblem(id, line, status, M4_PREFIX, tracks.m4);
  }
  return { kind: "unknown_status", id, line, status };
}

/** A carry-over track cell: a track id that either plan declares, `M4`, `M4: after <track> merge`, or `M5:` / `삭제:` / `user decision:` / `will not do:` with a reason. */
function carryoverProblem(
  item: string,
  line: number,
  track: string,
  tracks: DeclaredTracks,
): LedgerProblem | undefined {
  if (track === "") return { kind: "carryover_missing_track", item, line, track };
  if (track === DONE_IN_M4) return undefined;
  if (OWNER_WAIT.test(track)) return undefined;
  if (
    track.startsWith(DEFERRED_PREFIX) ||
    track.startsWith(DELETED_PREFIX) ||
    track.startsWith(USER_DECISION_PREFIX) ||
    track.startsWith(WONT_DO_PREFIX)
  ) {
    const reason = track.slice(track.indexOf(":") + 1).trim();
    return reason === "" ? { kind: "carryover_missing_reason", item, line, track } : undefined;
  }
  if (tracks.m3b.has(track) || tracks.m4.has(track)) return undefined;
  return { kind: "carryover_unknown_track", item, line, track };
}

/**
 * Reads every markdown table of the ledger. A table whose header has a 상태 column contributes its M3-REQ rows; a table whose
 * header has a 트랙 id column contributes its carry-over rows. Other tables are ignored. `tracks` are the ids the two plans
 * declare in section 2.
 */
export function scanLedger(text: string, tracks: DeclaredTracks): Result<LedgerScan, string> {
  const requirements: RequirementRow[] = [];
  const carryover: CarryoverRow[] = [];
  const problems: LedgerProblem[] = [];
  const seen = new Set<string>();
  let candidate: readonly string[] | undefined;
  let header: readonly string[] | undefined;
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    const number = index + 1;
    if (!line.startsWith("|")) {
      candidate = undefined;
      header = undefined;
      continue;
    }
    if (header === undefined) {
      // The first row of a table is its header only when the next row is the separator.
      if (candidate !== undefined && isSeparator(line)) {
        header = candidate;
        candidate = undefined;
      } else {
        candidate = cellsOf(line);
      }
      continue;
    }
    if (isSeparator(line)) continue;
    const cells = cellsOf(line);
    const first = cells[0] ?? "";
    const statusColumn = header.indexOf(STATUS_HEADER);
    const trackColumn = header.indexOf(TRACK_HEADER);
    if (REQ_ID.test(first)) {
      const status = statusColumn < 0 ? "" : (cells[statusColumn] ?? "");
      requirements.push({ id: first, line: number, status });
      if (seen.has(first)) problems.push({ kind: "duplicate_id", id: first, line: number });
      seen.add(first);
      const problem = statusProblem(first, number, status, tracks);
      if (problem !== undefined) problems.push(problem);
    } else if (statusColumn < 0 && trackColumn >= 0 && first !== "") {
      const track = cells[trackColumn] ?? "";
      carryover.push({ item: first, line: number, track });
      const problem = carryoverProblem(first, number, track, tracks);
      if (problem !== undefined) problems.push(problem);
    }
  }
  if (requirements.length === 0) return { ok: false, error: "no M3-REQ rows found" };
  return { ok: true, value: { requirements, carryover, problems } };
}

/** Rows per status, the status of a row without one shown as `(none)`. */
export function countStatuses(
  rows: readonly RequirementRow[],
): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.status === "" ? "(none)" : row.status;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].toSorted(([a], [b]) => a.localeCompare(b));
}

/** Carry-over rows per status: a track id counts under itself, `M5` and `삭제` under their words, an empty cell as `(none)`. */
export function countCarryover(
  rows: readonly CarryoverRow[],
): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = carryoverKey(row.track);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].toSorted(([a], [b]) => a.localeCompare(b));
}

function carryoverKey(track: string): string {
  if (track === "") return "(none)";
  if (track.startsWith(DEFERRED_PREFIX)) return "M5";
  if (track.startsWith(DELETED_PREFIX)) return "삭제";
  if (OWNER_WAIT.test(track)) return "M4 (after merge)";
  if (track.startsWith(USER_DECISION_PREFIX)) return "user decision";
  if (track.startsWith(WONT_DO_PREFIX)) return "will not do";
  return track;
}

/** The plan that declares the track an `M3b:` or `M4:` status names. */
function planOf(status: string): string {
  return status.startsWith(M4_PREFIX) ? "m4-plan §2" : "m3b-plan §2";
}

export function describeProblem(problem: LedgerProblem): string {
  switch (problem.kind) {
    case "missing_status":
      return `${problem.id} has no status (line ${String(problem.line)})`;
    case "unknown_status":
      return `${problem.id} has status "${problem.status}" (line ${String(problem.line)}), expected M3a, M3b, M4, M3b:<track id> or M4:<track id>`;
    case "missing_track":
      return `${problem.id} has status "${problem.status}" (line ${String(problem.line)}) without a track id`;
    case "unknown_track":
      return `${problem.id} has status "${problem.status}" (line ${String(problem.line)}), but ${planOf(problem.status)} declares no track ${problem.track}`;
    case "duplicate_id":
      return `${problem.id} appears twice (line ${String(problem.line)})`;
    case "carryover_missing_track":
      return `carry-over item "${problem.item}" has no track id (line ${String(problem.line)})`;
    case "carryover_unknown_track":
      return `carry-over item "${problem.item}" names track ${problem.track} (line ${String(problem.line)}), but no track of m3b-plan §2 or m4-plan §2 has that id`;
    case "carryover_missing_reason":
      return `carry-over item "${problem.item}" has "${problem.track}" without a reason (line ${String(problem.line)})`;
    default:
      return assertNever(problem);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected value ${JSON.stringify(value)}`);
}

function readText(path: string): Result<string, string> {
  try {
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      file: { type: "string" },
      plan: { type: "string" },
      "m4-plan": { type: "string" },
    },
  });
  const path = resolve(values.file ?? join(import.meta.dir, LEDGER_PATH));
  const read = readText(path);
  if (!read.ok) {
    process.stderr.write(`req-ledger: cannot read ${path}: ${read.error}\n`);
    process.exit(2);
  }
  const m3bPath = resolve(values.plan ?? join(import.meta.dir, M3B_PLAN_PATH));
  const m3bRead = readText(m3bPath);
  if (!m3bRead.ok) {
    process.stderr.write(`req-ledger: cannot read ${m3bPath}: ${m3bRead.error}\n`);
    process.exit(2);
  }
  const m4Path = resolve(values["m4-plan"] ?? join(import.meta.dir, M4_PLAN_PATH));
  const m4Read = readText(m4Path);
  if (!m4Read.ok) {
    process.stderr.write(`req-ledger: cannot read ${m4Path}: ${m4Read.error}\n`);
    process.exit(2);
  }
  const m3bDeclared = declaredTracks(m3bRead.value);
  if (!m3bDeclared.ok) {
    process.stderr.write(`req-ledger: ${m3bPath}: ${m3bDeclared.error}\n`);
    process.exit(1);
  }
  const m4Declared = declaredTracks(m4Read.value);
  if (!m4Declared.ok) {
    process.stderr.write(`req-ledger: ${m4Path}: ${m4Declared.error}\n`);
    process.exit(1);
  }
  const scanned = scanLedger(read.value, { m3b: m3bDeclared.value, m4: m4Declared.value });
  if (!scanned.ok) {
    process.stderr.write(`req-ledger: ${path}: ${scanned.error}\n`);
    process.exit(1);
  }
  const { requirements, carryover, problems } = scanned.value;
  const counts = countStatuses(requirements)
    .map(([status, count]) => `  ${status}\t${String(count)}`)
    .join("\n");
  const carryCounts = countCarryover(carryover)
    .map(([status, count]) => `  ${status}\t${String(count)}`)
    .join("\n");
  process.stdout.write(
    `req-ledger: ${String(requirements.length)} M3-REQ rows\n${counts}\n` +
      `req-ledger: ${String(carryover.length)} carry-over items, ${String(problems.length)} problems\n${carryCounts}\n`,
  );
  if (problems.length > 0) {
    process.stderr.write(
      problems.map((problem) => `req-ledger: ${describeProblem(problem)}\n`).join(""),
    );
    process.exit(1);
  }
  process.exit(0);
}
