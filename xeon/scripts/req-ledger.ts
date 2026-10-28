#!/usr/bin/env bun
// M3 requirement ledger check (review.m3b-plan 3.3, track B0-LED). Reads the 상태 column of the M3-REQ tables in
// docs/xeon/review/m3-lower-requirements.md and the 트랙 id column of its carry-over table. Fails when an M3-REQ row has no
// status, when an `M3b:` status names no track id, or when a carry-over item names no track id. Prints the counts per status.
//   req-ledger [--file <ledger path>]
// Exit codes: 0 every row and carry-over item is valid, 1 at least one problem (listed on stderr), 2 environment (the
// ledger cannot be read).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Statuses that take no track: done in M3a, or moved to M4. The third form is `M3b:<track id>`. */
export const PLAIN_STATUSES: readonly string[] = ["M3a", "M4"];
const M3B_PREFIX = "M3b:";
const TRACK_ID = /^B\d-[A-Z0-9]+$/;
const REQ_ID = /^M3-REQ-\d{2,3}$/;
const STATUS_HEADER = "상태";
const TRACK_HEADER = "트랙 id";
/** Relative to xeon/scripts, the directory this file runs from by default. */
const LEDGER_PATH = "../../docs/xeon/review/m3-lower-requirements.md";

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
  | { readonly kind: "duplicate_id"; readonly id: string; readonly line: number }
  | {
      readonly kind: "carryover_missing_track";
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

function statusProblem(id: string, line: number, status: string): LedgerProblem | undefined {
  if (status === "") return { kind: "missing_status", id, line };
  if (PLAIN_STATUSES.includes(status)) return undefined;
  if (status.startsWith(M3B_PREFIX)) {
    const track = status.slice(M3B_PREFIX.length);
    return TRACK_ID.test(track) ? undefined : { kind: "missing_track", id, line, status };
  }
  return { kind: "unknown_status", id, line, status };
}

/**
 * Reads every markdown table of the ledger. A table whose header has a 상태 column contributes its M3-REQ rows; a table whose
 * header has a 트랙 id column contributes its carry-over rows. Other tables are ignored.
 */
export function scanLedger(text: string): Result<LedgerScan, string> {
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
      const problem = statusProblem(first, number, status);
      if (problem !== undefined) problems.push(problem);
    } else if (statusColumn < 0 && trackColumn >= 0 && first !== "") {
      const track = cells[trackColumn] ?? "";
      carryover.push({ item: first, line: number, track });
      if (!TRACK_ID.test(track)) {
        problems.push({ kind: "carryover_missing_track", item: first, line: number, track });
      }
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

export function describeProblem(problem: LedgerProblem): string {
  switch (problem.kind) {
    case "missing_status":
      return `${problem.id} has no status (line ${String(problem.line)})`;
    case "unknown_status":
      return `${problem.id} has status "${problem.status}" (line ${String(problem.line)}), expected M3a, M4 or M3b:<track id>`;
    case "missing_track":
      return `${problem.id} has status "${problem.status}" (line ${String(problem.line)}) without a track id`;
    case "duplicate_id":
      return `${problem.id} appears twice (line ${String(problem.line)})`;
    case "carryover_missing_track":
      return `carry-over item "${problem.item}" has no track id (line ${String(problem.line)})`;
    default:
      return assertNever(problem);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected value ${JSON.stringify(value)}`);
}

function readLedger(path: string): Result<string, string> {
  try {
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { file: { type: "string" } },
  });
  const path = resolve(values.file ?? join(import.meta.dir, LEDGER_PATH));
  const read = readLedger(path);
  if (!read.ok) {
    process.stderr.write(`req-ledger: cannot read ${path}: ${read.error}\n`);
    process.exit(2);
  }
  const scanned = scanLedger(read.value);
  if (!scanned.ok) {
    process.stderr.write(`req-ledger: ${path}: ${scanned.error}\n`);
    process.exit(1);
  }
  const { requirements, carryover, problems } = scanned.value;
  const counts = countStatuses(requirements)
    .map(([status, count]) => `  ${status}\t${String(count)}`)
    .join("\n");
  process.stdout.write(
    `req-ledger: ${String(requirements.length)} M3-REQ rows\n${counts}\n` +
      `req-ledger: ${String(carryover.length)} carry-over items, ${String(problems.length)} problems\n`,
  );
  if (problems.length > 0) {
    process.stderr.write(
      problems.map((problem) => `req-ledger: ${describeProblem(problem)}\n`).join(""),
    );
    process.exit(1);
  }
  process.exit(0);
}
