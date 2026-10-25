#!/usr/bin/env bun
// Exit-condition tests (product.scope.spec 4.4.1, M2 closing G4-07). Runs the files listed in scripts/exit-tests.txt
// one line at a time under ../scripts/guard.sh run and fails when a listed file is missing, a test is skipped or a test
// fails. A test that skips because a binary is missing (sops, bwrap, socat) leaves its condition unchecked, so CI must
// not pass on it.
//   exit-tests [--list <file>]
// Exit codes: 0 every line ran without skips, 1 a line is missing, skipped or failed (or the list is invalid),
// 2 environment (guard.sh missing, bun cannot be started).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface ExitEntry {
  /** Condition label, e.g. E7. */
  readonly condition: string;
  /** Package directory relative to xeon/. */
  readonly dir: string;
  /** Test files or globs relative to the package directory. */
  readonly files: readonly string[];
  /** 1-based line in the list file. */
  readonly line: number;
}

export interface BunSummary {
  readonly pass: number;
  readonly skip: number;
  readonly fail: number;
}

export type Verdict =
  | { readonly kind: "ok"; readonly summary: BunSummary }
  | { readonly kind: "missing"; readonly patterns: readonly string[] }
  | { readonly kind: "skipped"; readonly summary: BunSummary }
  | {
      readonly kind: "failed";
      readonly exitCode: number;
      readonly summary: BunSummary | undefined;
    };

const CONDITION = /^[A-Z][A-Z0-9-]*$/;

/** Parses scripts/exit-tests.txt. Blank lines and `#` comments are skipped. */
export function parseExitList(text: string): Result<ExitEntry[], string> {
  const entries: ExitEntry[] = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [condition, dir, ...files] = trimmed.split(/\s+/);
    const line = index + 1;
    if (condition === undefined || !CONDITION.test(condition)) {
      return { ok: false, error: `line ${String(line)}: condition must look like E7 or M1` };
    }
    if (dir === undefined || files.length === 0) {
      return {
        ok: false,
        error: `line ${String(line)}: expected <condition> <package dir> <file...>`,
      };
    }
    if (dir.startsWith("/") || dir.includes("..") || files.some((file) => file.includes(".."))) {
      return { ok: false, error: `line ${String(line)}: paths must stay inside the package` };
    }
    entries.push({ condition, dir, files, line });
  }
  if (entries.length === 0) return { ok: false, error: "the list has no entries" };
  return { ok: true, value: entries };
}

/** Reads the `N pass`, `N skip`, `N fail` lines of `bun test` output. undefined when there is no pass line. */
export function summarizeBunOutput(output: string): BunSummary | undefined {
  const count = (word: string): number | undefined => {
    const matches = [...output.matchAll(new RegExp(`^\\s*(\\d+) ${word}\\s*$`, "gm"))];
    const last = matches.at(-1)?.[1];
    return last === undefined ? undefined : Number(last);
  };
  const pass = count("pass");
  if (pass === undefined) return undefined;
  return { pass, skip: count("skip") ?? 0, fail: count("fail") ?? 0 };
}

/** The verdict of one line: missing files first, then the bun exit code, then skips. */
export function judge(
  patterns: readonly string[],
  matched: readonly string[],
  run: { readonly exitCode: number; readonly output: string } | undefined,
): Verdict {
  if (matched.length === 0 || run === undefined) return { kind: "missing", patterns };
  const summary = summarizeBunOutput(run.output);
  if (run.exitCode !== 0 || summary === undefined || summary.fail > 0) {
    return { kind: "failed", exitCode: run.exitCode, summary };
  }
  if (summary.skip > 0) return { kind: "skipped", summary };
  return { kind: "ok", summary };
}

export function describeVerdict(entry: ExitEntry, verdict: Verdict): string {
  const head = `${entry.condition}\t${entry.dir}`;
  switch (verdict.kind) {
    case "ok":
      return `${head}\tok\tpass ${String(verdict.summary.pass)}, skip 0`;
    case "missing":
      return `${head}\tmissing\tno file matches ${verdict.patterns.join(" ")}`;
    case "skipped":
      return `${head}\tskipped\tpass ${String(verdict.summary.pass)}, skip ${String(verdict.summary.skip)}: a skipped exit-condition test leaves the condition unchecked (install the binary it needs)`;
    case "failed":
      return `${head}\tfailed\texit ${String(verdict.exitCode)}${verdict.summary === undefined ? "" : `, fail ${String(verdict.summary.fail)}`}`;
    default:
      return assertNever(verdict);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected value ${JSON.stringify(value)}`);
}

/** Total skipped tests over all verdicts that ran. */
export function skippedTotal(verdicts: readonly Verdict[]): number {
  let total = 0;
  for (const verdict of verdicts) {
    if (verdict.kind === "ok" || verdict.kind === "skipped") total += verdict.summary.skip;
    if (verdict.kind === "failed" && verdict.summary !== undefined) total += verdict.summary.skip;
  }
  return total;
}

function matchFiles(packageDir: string, patterns: readonly string[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: packageDir, onlyFiles: true })) {
      found.add(file);
    }
  }
  return [...found].toSorted();
}

async function runBunTest(
  guard: string,
  packageDir: string,
  files: readonly string[],
): Promise<{ exitCode: number; output: string } | Error> {
  try {
    const child = Bun.spawn([guard, "run", "--", process.execPath, "test", ...files], {
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, output: `${stdout}\n${stderr}` };
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { list: { type: "string" } },
  });
  const xeonRoot = resolve(import.meta.dir, "..");
  const listFile = resolve(values.list ?? join(import.meta.dir, "exit-tests.txt"));
  const guard = resolve(xeonRoot, "..", "scripts", "guard.sh");
  if (!existsSync(guard)) {
    process.stderr.write(`exit-tests: ${guard} is missing (ws repo adopt copies it)\n`);
    process.exit(2);
  }
  const parsed = parseExitList(existsSync(listFile) ? readFileSync(listFile, "utf8") : "");
  if (!parsed.ok) {
    process.stderr.write(`exit-tests: ${listFile}: ${parsed.error}\n`);
    process.exit(1);
  }
  const runOne = async (entry: ExitEntry): Promise<Verdict> => {
    const packageDir = join(xeonRoot, entry.dir);
    const matched = existsSync(packageDir) ? matchFiles(packageDir, entry.files) : [];
    let run: { exitCode: number; output: string } | undefined;
    if (matched.length > 0) {
      const result = await runBunTest(guard, packageDir, matched);
      if (result instanceof Error) {
        process.stderr.write(`exit-tests: could not run bun: ${result.message}\n`);
        process.exit(2);
      }
      run = result;
      if (result.exitCode !== 0) process.stderr.write(result.output);
    }
    const verdict = judge(entry.files, matched, run);
    process.stdout.write(`${describeVerdict(entry, verdict)}\n`);
    return verdict;
  };
  // One line at a time: the machine runs one test process at once.
  const verdicts = await parsed.value.reduce<Promise<Verdict[]>>(
    async (previous, entry) => [...(await previous), await runOne(entry)],
    Promise.resolve([]),
  );
  const bad = verdicts.filter((verdict) => verdict.kind !== "ok").length;
  process.stdout.write(
    `exit-tests: ${String(verdicts.length - bad)}/${String(verdicts.length)} lines ok, ${String(skippedTotal(verdicts))} skipped\n`,
  );
  process.exit(bad > 0 ? 1 : 0);
}
