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
//   xeon/type-unsafe     `Type.Unsafe` call outside the TY-26 allowlist: not wrapping `Type.String(...)` (brand), not wrapping
//                         `Type.Unknown()`/`Type.Record(Type.String(), Type.Unknown())` (JSON passthrough), without
//                         `satisfies SchemaProof<...>`/`SchemaSound<...>` (compile-time proof), and not in a row-U2/U3/U4 file
//   xeon/switch-default-never a `switch` whose `default` block has no `assertNever` call (TY-14)
//   xeon/catch-swallow    `.catch(() => undefined)`, `.catch(() => {})`, `.catch(noop)` or `void <caught>` (TY-25)
//   xeon/no-void-promise  `void <call>` (and `void (async ...)()`) in non-test code: a Promise and its Result are dropped (TY-22).
//                         Use `detach(promise, onFailure)` or await it. Tests may start a call and await it later
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

/** TY-26 `Type.Unsafe` 허용 파일. 파일 밖의 호출은 인자 모양(브랜드, JSON 통과, 증명)으로만 허용한다. 가이드 표와 같이 고친다 */
const TYPE_UNSAFE_FILES: Readonly<Record<string, (path: string) => boolean>> = {
  // U2: 외부(pi-ai) 타입을 얕은 형상으로 거울처럼 비춘 스키마
  U2: (path) =>
    path === "packages/contracts/src/conversation/message-schema.ts" ||
    path === "packages/contracts/src/conversation/agent-schema.ts",
  // U3: 정적 타입 없이 JSON 스키마를 그대로 통과시키는 호출
  U3: (path) => path === "packages/contracts/src/wire-settings/settings/validate-value.ts",
  // U4: 시험 코드와 시험 지원 코드
  U4: (path) => isTestPath(path),
};

const EXPECTED_WORDS =
  /\b(io|busy|disk_full|read_only|timeout|cancelled|not_found|corrupt|ownership_lost|lease_lost|row_invalid|row_corrupt|read_failed|commit_failed|name_conflict|setup_failed)\b/;
/** `${result.error.kind}` 같은 보간: Result의 오류 종류를 Bug 메시지에 싣는다 */
const ERROR_INTERPOLATION = /\$\{[^}]*\.error(?:\.(?:kind|code))?\s*\}/;
/** `if (!x.ok)` 바로 뒤의 `throw new Bug(`: Result 실패를 Bug로 바꾸는 모양 */
const RESULT_TO_BUG = /if\s*\(\s*!\s*[\w.?]+\.ok\s*\)\s*\{?\s*throw\s+$/;
/** `void foo.bar(`, `void this.#flush(`, `void (async`: 식 연산자 `void`가 호출식을 버린다. 타입 자리의 `void`(`=> void`, `<void>`)는 뒤에 식별자와 `(`가 오지 않아 걸리지 않는다 */
const VOID_CALL =
  /\bvoid[ \t]+(?:[A-Za-z_$#][\w$#?]*(?:\??\.[A-Za-z_$#][\w$#]*)*[ \t]*\(|\([ \t]*async\b)/g;
const ASSERTION_RULES = /(?:consistent-type-assertions|no-unsafe-type-assertion)/;
const SCAN_DISABLE = /\/\/ xeon-disable-next-line (xeon\/[a-z-]+) -- (.+)$/;
/** 포크 코드의 억제 사유로 인정하지 않는 말. 업스트림 병합 비용은 예외 사유가 아니다(eng.typescript.guide 1절 포크 코드). */
const MERGE_COST_REASON =
  /upstream shape|keep upstream|merge cost|업스트림[^.]*(?:모양|병합)|원본[^.]*(?:모양|병합)|포크 코드의 모양|병합 비용/i;

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

/**
 * 주석, 문자열, 템플릿, 정규식 리터럴의 내용을 공백으로 바꾼 사본. 줄 번호와 글자 위치는 그대로다.
 * 괄호 짝 맞추기가 문자열 안의 `{`나 `"`에 속지 않게 한다
 */
function blank(ch: string): string {
  return ch === "\n" ? "\n" : " ";
}

function maskCode(text: string): string {
  const out: string[] = [];
  let index = 0;
  let previous = "";
  while (index < text.length) {
    const ch = text.charAt(index);
    const next = text.charAt(index + 1);
    if (ch === "/" && next === "/") {
      while (index < text.length && text.charAt(index) !== "\n") {
        out.push(" ");
        index += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out.push("  ");
      index += 2;
      while (
        index < text.length &&
        !(text.charAt(index) === "*" && text.charAt(index + 1) === "/")
      ) {
        out.push(blank(text.charAt(index)));
        index += 1;
      }
      out.push("  ");
      index += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      out.push(ch);
      index += 1;
      while (index < text.length && text.charAt(index) !== ch) {
        if (text.charAt(index) === "\\") {
          out.push(" ");
          index += 1;
        }
        out.push(blank(text.charAt(index)));
        index += 1;
      }
      out.push(ch);
      index += 1;
      previous = ch;
      continue;
    }
    if (ch === "/" && /[(,=:[!&|?{};]|^$/.test(previous)) {
      // 정규식 리터럴: 닫는 /까지(문자 클래스 안의 /는 건너뛴다)
      out.push("/");
      index += 1;
      let inClass = false;
      while (index < text.length && text.charAt(index) !== "\n") {
        const c = text.charAt(index);
        if (c === "\\") {
          out.push("  ");
          index += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        out.push(" ");
        index += 1;
      }
      out.push("/");
      index += 1;
      previous = "/";
      continue;
    }
    out.push(ch);
    if (!/\s/.test(ch)) previous = ch;
    index += 1;
  }
  return out.join("");
}

/** `switch` 하나의 본문 범위(여는 중괄호 다음부터 닫는 중괄호 앞). 괄호가 맞지 않으면 undefined */
function switchBody(code: string, switchAt: number): { start: number; end: number } | undefined {
  let index = code.indexOf("(", switchAt);
  if (index < 0) return undefined;
  let depth = 0;
  for (; index < code.length; index += 1) {
    const ch = code.charAt(index);
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const open = code.indexOf("{", index);
  if (open < 0) return undefined;
  depth = 0;
  for (let at = open; at < code.length; at += 1) {
    const ch = code.charAt(at);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start: open + 1, end: at };
    }
  }
  return undefined;
}

const JSON_PASSTHROUGH =
  /^(?:Type\.Unknown\(\)|Type\.Record\(\s*Type\.String\(\)\s*,\s*Type\.Unknown\(\)\s*\))$/;

/**
 * TY-26: `Type.Unsafe`는 정적 타입을 스키마에 얹을 뿐 검사를 더하지 않는다. 허용하는 모양은 넷이다.
 * 브랜드(`Type.String(...)`을 감싼다), JSON 통과(`Type.Unknown()` 등), 컴파일 시점 증명(`satisfies SchemaProof<...>`·`SchemaSound<...>`),
 * 허용 파일(U2~U4). 그 밖은 실제 `Type.Object` 스키마를 쓰거나 이유를 단 예외 주석을 단다
 */
function scanTypeUnsafe(
  text: string,
  path: string,
  add: (rule: string, line: number, message: string) => void,
): void {
  if (Object.values(TYPE_UNSAFE_FILES).some((covers) => covers(path))) return;
  const code = maskCode(text);
  for (const match of code.matchAll(/\bType\.Unsafe\b/g)) {
    let at = match.index + match[0].length;
    if (code.charAt(at) === "<") {
      let depth = 0;
      for (; at < code.length; at += 1) {
        const ch = code.charAt(at);
        if (ch === "<") depth += 1;
        else if (ch === ">") {
          depth -= 1;
          if (depth === 0) {
            at += 1;
            break;
          }
        }
      }
    }
    if (code.charAt(at) !== "(") continue;
    const args = callArguments(text, at).trim().replace(/,$/, "").trim();
    const allowed =
      args.startsWith("Type.String(") ||
      JSON_PASSTHROUGH.test(args) ||
      /\bsatisfies\s+Schema(?:Proof|Sound)</.test(args);
    if (!allowed) {
      add(
        "xeon/type-unsafe",
        lineOf(text, match.index),
        "Type.Unsafe needs a brand (Type.String), a JSON passthrough, a `satisfies SchemaProof<...>` proof or a TY-26 allowlist row",
      );
    }
  }
}

/**
 * TY-14: 모든 switch의 default 블록은 assertNever를 부른다. default 블록은 default 절부터 같은 switch의
 * 다음 case(또는 switch의 끝)까지다. 예외는 default 줄 위나 default 블록 안의 `xeon-disable-next-line xeon/switch-default-never` 주석이다
 */
function scanSwitchDefaults(
  text: string,
  add: (rule: string, line: number, message: string) => void,
  exemptedIn: (from: number, to: number) => boolean,
): void {
  const code = maskCode(text);
  for (const match of code.matchAll(/\bswitch\s*\(/g)) {
    const body = switchBody(code, match.index);
    if (body === undefined) continue;
    let depth = 0;
    let defaultAt = -1;
    let blockEnd = body.end;
    for (let at = body.start; at < body.end; at += 1) {
      const ch = code.charAt(at);
      if (ch === "{" || ch === "(" || ch === "[") depth += 1;
      else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
      else if (depth === 0 && /[a-z]/.test(ch) && !/\w/.test(code.charAt(at - 1))) {
        const word = /^(?:default|case)\b/.exec(code.slice(at, at + 8))?.[0];
        if (word === "default" && defaultAt < 0) {
          defaultAt = at;
        } else if (word === "case" && defaultAt >= 0) {
          blockEnd = at;
          break;
        }
      }
    }
    if (defaultAt < 0) continue;
    if (
      !/\bassertNever\s*\(/.test(code.slice(defaultAt, blockEnd)) &&
      !exemptedIn(lineOf(text, defaultAt), lineOf(text, blockEnd))
    ) {
      add(
        "xeon/switch-default-never",
        lineOf(text, defaultAt),
        "the default block of a switch must call assertNever (TY-14)",
      );
    }
  }
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
      if (MERGE_COST_REASON.test(scanDisable[2] ?? "")) {
        add(
          "xeon/directive-format",
          line,
          "upstream merge cost is not a reason for an exception (guide section 1, fork code)",
        );
      }
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
      if (MERGE_COST_REASON.test(reason)) {
        add(
          "xeon/directive-format",
          line,
          "upstream merge cost is not a reason for an exception (guide section 1, fork code)",
        );
      }
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
  if (!isTestSupport(file.path)) {
    const code = maskCode(file.text);
    for (const match of code.matchAll(VOID_CALL)) {
      add(
        "xeon/no-void-promise",
        lineOf(file.text, match.index),
        "`void <call>` drops a Promise and its Result; use detach(promise, onFailure) or await it (TY-22)",
      );
    }
  }
  scanTypeUnsafe(file.text, file.path, add);
  scanSwitchDefaults(file.text, add, (from, to) => {
    for (let at = from; at <= to; at += 1) {
      if (exempt.get(at)?.has("xeon/switch-default-never") === true) return true;
    }
    return false;
  });
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
