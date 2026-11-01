#!/usr/bin/env bun
// caustic 부품 간극 표 검사 (review.m4-plan T-CAU1, 종료 조건 Y13). docs/xeon/L4/desktop-ux/spec.md §9 표의 C-NN 행마다
// 상태 칸이 비지 않고 허용된 값으로 시작하는지 본다. 허용 값은 `caustic 반영`, `앱 조합`, `M5`, `caustic 대기`(아직 caustic에 안 들어간 제안, 맡은 트랙을 괄호에 적음)이고 뒤에 괄호 메모를 붙일 수 있다.
//   caustic-gaps [--file <spec path>]
// 종료 코드: 0 모든 행이 유효, 1 문제가 있음(stderr에 목록), 2 환경(파일을 읽을 수 없음).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const GAP_STATUSES: readonly string[] = ["caustic 반영", "caustic 대기", "앱 조합", "M5"];
const SPEC_PATH = "../../docs/xeon/L4/desktop-ux/spec.md";
const SECTION_START = /^## 9\. /;
const SECTION_END = /^## /;
const GAP_ID = /^C-\d{2}$/;
const STATUS_HEADER = "상태";

export interface GapRow {
  readonly id: string;
  readonly line: number;
  /** 상태 칸이 비었거나 표에 상태 열이 없으면 빈 문자열 */
  readonly status: string;
}

export type GapProblem =
  | { readonly kind: "missing_status"; readonly id: string; readonly line: number }
  | {
      readonly kind: "unknown_status";
      readonly id: string;
      readonly line: number;
      readonly status: string;
    }
  | { readonly kind: "duplicate_id"; readonly id: string; readonly line: number }
  | { readonly kind: "gap_in_ids"; readonly id: string; readonly line: number };

export interface GapScan {
  readonly rows: readonly GapRow[];
  readonly problems: readonly GapProblem[];
}

/** 표 한 줄을 칸으로 나눈다. `\|`는 칸 안에 두고 바깥 빈 칸은 버린다. */
export function cellsOf(line: string): readonly string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (ch === "\\" && line.charAt(i + 1) === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells.slice(1, line.trimEnd().endsWith("|") ? -1 : undefined);
}

/** 상태 값이 허용된 값으로 시작하고, 뒤에는 공백과 괄호 메모만 오는지 */
export function isAllowedStatus(status: string): boolean {
  return GAP_STATUSES.some(
    (allowed) => status === allowed || (status.startsWith(`${allowed} (`) && status.endsWith(")")),
  );
}

export function scanGaps(text: string): Result<GapScan, string> {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => SECTION_START.test(line));
  if (start < 0) return { ok: false, error: "§9 caustic 부품 간극 절(## 9.)이 없습니다" };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (SECTION_END.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  let statusColumn = -1;
  const rows: GapRow[] = [];
  const problems: GapProblem[] = [];
  const seen = new Set<string>();
  let previous = 0;
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i] ?? "";
    if (!line.startsWith("|")) continue;
    const cells = cellsOf(line);
    if (cells[0] === "id") {
      statusColumn = cells.indexOf(STATUS_HEADER);
      continue;
    }
    const id = cells[0] ?? "";
    if (!GAP_ID.test(id)) continue;
    const status = statusColumn < 0 ? "" : (cells[statusColumn] ?? "");
    const lineNo = i + 1;
    rows.push({ id, line: lineNo, status });
    const duplicate = seen.has(id);
    if (duplicate) problems.push({ kind: "duplicate_id", id, line: lineNo });
    seen.add(id);
    const num = Number(id.slice(2));
    if (!duplicate && num !== previous + 1) problems.push({ kind: "gap_in_ids", id, line: lineNo });
    previous = num;
    if (status === "") problems.push({ kind: "missing_status", id, line: lineNo });
    else if (!isAllowedStatus(status))
      problems.push({ kind: "unknown_status", id, line: lineNo, status });
  }
  if (statusColumn < 0) return { ok: false, error: "§9 표에 `상태` 열이 없습니다" };
  if (rows.length === 0) return { ok: false, error: "§9 표에 C-NN 행이 없습니다" };
  return { ok: true, value: { rows, problems } };
}

export function describeProblem(problem: GapProblem): string {
  const where = `${problem.id} (줄 ${String(problem.line)})`;
  if (problem.kind === "missing_status") return `${where}: 상태 칸이 비었습니다`;
  if (problem.kind === "unknown_status")
    return `${where}: 상태 \`${problem.status}\`는 허용 값(${GAP_STATUSES.join(", ")})이 아닙니다`;
  if (problem.kind === "duplicate_id") return `${where}: id가 겹칩니다`;
  return `${where}: id가 앞 행에서 하나씩 이어지지 않습니다`;
}

export function countStatuses(rows: readonly GapRow[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const base =
      GAP_STATUSES.find((s) => row.status === s || row.status.startsWith(`${s} (`)) ?? row.status;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return [...counts.entries()].toSorted(([a], [b]) => a.localeCompare(b));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { file: { type: "string" } } });
  const path =
    values.file === undefined ? resolve(import.meta.dir, SPEC_PATH) : resolve(values.file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    process.stderr.write(
      `caustic-gaps: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
  const scanned = scanGaps(text);
  if (!scanned.ok) {
    process.stderr.write(`caustic-gaps: ${path}: ${scanned.error}\n`);
    process.exit(1);
  }
  const { rows, problems } = scanned.value;
  const counts = countStatuses(rows)
    .map(([status, count]) => `  ${status}\t${String(count)}`)
    .join("\n");
  process.stdout.write(
    `caustic-gaps: ${String(rows.length)} C rows, ${String(problems.length)} problems\n${counts}\n`,
  );
  if (problems.length > 0) {
    process.stderr.write(problems.map((p) => `caustic-gaps: ${describeProblem(p)}\n`).join(""));
    process.exit(1);
  }
  process.exit(0);
}
