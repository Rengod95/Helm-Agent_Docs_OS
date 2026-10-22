#!/usr/bin/env bun
// TypeScript rule scan (engineering/typescript guide 3.2). Rules that oxlint and tsc do not cover.
// Prints one line per violation:
//   <file>:<line> <xeon/rule> <message>
// Exit codes: 0 pass, 1 violations, 2 tool error (unreadable source tree).
// Rules:
//   xeon/as-location      an assertion exception comment (consistent-type-assertions, no-unsafe-type-assertion) sits outside
//                         the TY-06 allowlist or does not name its row (A1..A6)
//   xeon/bug-for-expected `new Bug(...)` message names an expected failure (io, busy, disk_full, read_only, timeout, cancelled,
//                         not_found, corrupt, ownership_lost, lease_lost, row_invalid, row_corrupt, read_failed, commit_failed,
//                         name_conflict, setup_failed) or interpolates a Result error (`${x.error.kind}`), or sits directly
//                         under `if (!x.ok)` in non-test code: a Result failure converted to a Bug (TY-24)
//   xeon/catch-swallow    `.catch(() => undefined)`, `.catch(() => {})`, `.catch(noop)` or `void <caught>` (TY-25)
//   xeon/directive-format block disable comments, disable comments without ` -- <reason>`, ts-ignore, ts-nocheck and
//                         ts-expect-error comments outside tests (TY-08, guide 4.1)
// A line is exempt from a scan rule by `// xeon-disable-next-line xeon/<rule> -- <reason> (<issue url or doc id>)` above it.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface SourceFile {
  /** Path relative to the xeon root with forward slashes. */
  readonly path: string;
  readonly text: string;
}

export interface TsViolation {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface ExceptionRow {
  readonly file: string;
  readonly line: number;
  readonly kind: "oxlint" | "scan";
  readonly rule: string;
  readonly reason: string;
}

/** TY-06 allowlist rows: id -> where the row may appear. Keep in step with the table in the guide. */
const ALLOWLIST: Readonly<Record<string, (path: string) => boolean>> = {
  A1: (path) => path === "packages/contracts/src/base/parse.ts",
  A2: (path) => path === "packages/platform-os/src/ids.ts" || isTestPath(path),
  A3: (path) => path === "packages/ext-host/src/erase.ts",
  A4: (path) =>
    path === "packages/platform-secrets/src/redactor.ts" ||
    path === "packages/core-tools/src/testing/fake-secrets.ts",
  A5: (path) => path === "packages/contracts/src/wire-settings/settings/define.ts",
  A6: (path) => isTestPath(path),
};

const EXPECTED_WORDS =
  /\b(io|busy|disk_full|read_only|timeout|cancelled|not_found|corrupt|ownership_lost|lease_lost|row_invalid|row_corrupt|read_failed|commit_failed|name_conflict|setup_failed)\b/;
/** `${result.error.kind}` 같은 보간: Result의 오류 종류를 Bug 메시지에 싣는다 */
const ERROR_INTERPOLATION = /\$\{[^}]*\.error(?:\.(?:kind|code))?\s*\}/;
/** `if (!x.ok)` 바로 뒤의 `throw new Bug(`: Result 실패를 Bug로 바꾸는 모양 */
const RESULT_TO_BUG = /if\s*\(\s*!\s*[\w.?]+\.ok\s*\)\s*\{?\s*throw\s+$/;
const ASSERTION_RULES = /(?:consistent-type-assertions|no-unsafe-type-assertion)/;
const SCAN_DISABLE = /\/\/ xeon-disable-next-line (xeon\/[a-z-]+) -- (.+)$/;

function isTestPath(path: string): boolean {
  return (
    /(^|\/)test\//.test(path) ||
    path.endsWith(".test.ts") ||
    /(^|\/)testing\//.test(path) ||
    path.startsWith("scripts/")
  );
}

function isTestFile(path: string): boolean {
  return /(^|\/)test\//.test(path) || path.endsWith(".test.ts");
}

/** 시험 지원 코드(`testing/`)와 시험 파일. Result→Bug 변환 검사는 운영 코드만 본다 */
function isTestSupport(path: string): boolean {
  return isTestFile(path) || /(^|\/)testing\//.test(path);
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** String literal contents of `source`, in order. Template literals count with their text parts. */
function stringContents(source: string): string[] {
  const out: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const match of source.matchAll(pattern)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/** The text of the call arguments that start at `open` (index of "("), up to the matching ")". */
function callArguments(text: string, open: number): string {
  let depth = 0;
  let quote: string | undefined;
  for (let i = open; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== undefined) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

function exemptLines(lines: readonly string[]): Map<number, Set<string>> {
  const exempt = new Map<number, Set<string>>();
  lines.forEach((line, index) => {
    const match = SCAN_DISABLE.exec(line.trim());
    if (match === null) return;
    const target = index + 2;
    const rules = exempt.get(target) ?? new Set<string>();
    rules.add(match[1] ?? "");
    exempt.set(target, rules);
  });
  return exempt;
}

export function scanSource(file: SourceFile): {
  violations: TsViolation[];
  exceptions: ExceptionRow[];
} {
  const violations: TsViolation[] = [];
  const exceptions: ExceptionRow[] = [];
  const lines = file.text.split("\n");
  const exempt = exemptLines(lines);
  const test = isTestFile(file.path);
  const add = (rule: string, line: number, message: string): void => {
    if (exempt.get(line)?.has(rule) === true) return;
    violations.push({ rule, file: file.path, line, message });
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();

    const scanDisable = SCAN_DISABLE.exec(trimmed);
    if (scanDisable !== null) {
      exceptions.push({
        file: file.path,
        line,
        kind: "scan",
        rule: scanDisable[1] ?? "",
        reason: scanDisable[2] ?? "",
      });
    }

    const oxlint = /oxlint-disable(?:-next-line|-line)?\s+(.+?)(?:\s+--\s+(.*))?$/.exec(trimmed);
    if (/^\/\*\s*oxlint-(?:disable|enable)\b/.test(trimmed)) {
      add(
        "xeon/directive-format",
        line,
        "block disable comments are not allowed; use disable-next-line",
      );
    } else if (oxlint !== null && trimmed.includes("oxlint-disable")) {
      const rules = (oxlint[1] ?? "").trim();
      const reason = (oxlint[2] ?? "").trim();
      exceptions.push({ file: file.path, line, kind: "oxlint", rule: rules, reason });
      if (reason === "") {
        add(
          "xeon/directive-format",
          line,
          "oxlint disable comment needs ` -- <reason> (<issue or doc id>)`",
        );
      } else if (!/\([^()]*\)$/.test(reason)) {
        add(
          "xeon/directive-format",
          line,
          "oxlint disable reason must end with `(<issue url or doc id>)`",
        );
      }
      if (ASSERTION_RULES.test(rules)) {
        const row = /허용 목록 (A\d)\b/.exec(reason)?.[1];
        const allowed = row === undefined ? undefined : ALLOWLIST[row];
        if (row === undefined) {
          add(
            "xeon/as-location",
            line,
            "assertion exception must name its TY-06 allowlist row (허용 목록 A1..A6)",
          );
        } else if (allowed === undefined || !allowed(file.path)) {
          add("xeon/as-location", line, `allowlist row ${row} does not cover ${file.path}`);
        }
      }
    }

    if (/@ts-ignore|@ts-nocheck/.test(raw)) {
      add("xeon/directive-format", line, "@ts-ignore and @ts-nocheck are not allowed (TY-08)");
    }
    if (/@ts-expect-error/.test(raw) && !test) {
      add("xeon/directive-format", line, "@ts-expect-error is allowed only in tests (TY-08)");
    }

    const commentLine = /^(?:\/\/|\/\*|\*)/.test(trimmed);
    if (
      !commentLine &&
      /\.catch\(\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\}|null)\s*\)|\.catch\(\s*noop\s*\)/.test(raw)
    ) {
      add(
        "xeon/catch-swallow",
        line,
        "a rejection must be converted, logged or rethrown, not dropped (TY-25)",
      );
    }
    if (/^\s*void\s+(?:caught|error|err|cause|e)\s*;/.test(raw)) {
      add("xeon/catch-swallow", line, "`void <caught>` discards the caught value (TY-25)");
    }
  });

  if (!test) {
    for (const match of file.text.matchAll(/new Bug\(/g)) {
      const at = lines[lineOf(file.text, match.index) - 1]?.trim() ?? "";
      if (/^(?:\/\/|\/\*|\*)/.test(at)) continue;
      const open = match.index + "new Bug".length;
      const args = callArguments(file.text, open);
      const first = stringContents(args)[0] ?? "";
      const line = lineOf(file.text, match.index);
      if (EXPECTED_WORDS.test(first)) {
        add(
          "xeon/bug-for-expected",
          line,
          `Bug message names an expected failure (${first.slice(0, 60)}); return a typed error value (TY-24)`,
        );
      } else if (!isTestSupport(file.path) && ERROR_INTERPOLATION.test(args)) {
        add(
          "xeon/bug-for-expected",
          line,
          "Bug message interpolates a Result error; return a typed error value (TY-24)",
        );
      }
      if (
        !isTestSupport(file.path) &&
        RESULT_TO_BUG.test(file.text.slice(Math.max(0, match.index - 200), match.index))
      ) {
        add(
          "xeon/bug-for-expected",
          line,
          "a Result failure is converted to a Bug; return it or add a variant to your error union (TY-24)",
        );
      }
    }
  }
  return { violations, exceptions };
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "coverage", "vendor"]);

export function collectSources(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.startsWith("check-ts-rules")
      ) {
        const path = join(dir, entry.name);
        out.push({
          path: relative(root, path).split(sep).join("/"),
          text: readFileSync(path, "utf8"),
        });
      }
    }
  };
  for (const top of ["packages", "apps", "plugins", "scripts"]) {
    try {
      walk(join(root, top));
    } catch (caught) {
      if (top === "plugins") continue;
      throw caught;
    }
  }
  return out;
}

export function scanAll(files: readonly SourceFile[]): {
  violations: TsViolation[];
  exceptions: ExceptionRow[];
} {
  const violations: TsViolation[] = [];
  const exceptions: ExceptionRow[] = [];
  for (const file of files) {
    const scanned = scanSource(file);
    violations.push(...scanned.violations);
    exceptions.push(...scanned.exceptions);
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { violations, exceptions };
}

export function formatViolation(v: TsViolation): string {
  return `${v.file}:${v.line} ${v.rule} ${v.message}`;
}

/** One line per exception rule with its count: the guide 4.2 summary. */
export function summarizeExceptions(exceptions: readonly ExceptionRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of exceptions) {
    const key = `${row.kind}:${row.rule}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `exceptions ${key} ${count}`);
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    const listExceptions = args.includes("--exceptions");
    const rootArg = args.find((arg) => !arg.startsWith("--"));
    const root = rootArg === undefined ? resolve(import.meta.dir, "..") : resolve(rootArg);
    const files = collectSources(root);
    const { violations, exceptions } = scanAll(files);
    if (listExceptions) {
      for (const row of exceptions) {
        process.stdout.write(`${row.file}:${row.line}\t${row.kind}\t${row.rule}\t${row.reason}\n`);
      }
    }
    for (const line of summarizeExceptions(exceptions)) process.stdout.write(`${line}\n`);
    if (violations.length > 0) {
      for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
      process.stderr.write(
        `check-ts-rules: ${violations.length} violation(s) in ${files.length} files\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`check-ts-rules: ${files.length} files, 0 violations\n`);
  } catch (error) {
    process.stderr.write(
      `check-ts-rules: tool error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}
