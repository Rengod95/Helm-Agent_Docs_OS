// Server-side benches (M3-29, eng.performance.guide section 2). Each bench is an entry file inside the package that owns the
// code it measures (`<pkg>/test/bench/*.bench.ts`). An entry prints one JSON object per line on stdout:
//   {"metric":"<name>","unit":"ms"|"chars"|"tokens"|"count","samples":[...]}   timed or repeated values (stats are computed here)
//   {"metric":"<name>","unit":"...","value":<number>,"note":"..."}             a single informational value
// This file holds the registry, the line parser, the budget table and the runner. Budgets stay undefined (waiting for the
// user decision, eng.performance.guide section 2) until the user sets them from the baseline.
import { join } from "node:path";
import { stats as coarseStats, type Stats } from "./bench.ts";

const micro = (value: number): number => Math.round(value * 1000) / 1000;

/** Order statistics at 0.001 resolution: server benches run in microseconds and bench.ts rounds to 0.1. */
export function stats(samples: readonly number[]): Stats | undefined {
  const coarse = coarseStats(samples);
  if (coarse === undefined) return undefined;
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  return {
    runs: coarse.runs,
    min: micro(sorted[0] ?? 0),
    median: micro(at(0.5)),
    p90: micro(at(0.9)),
    max: micro(sorted.at(-1) ?? 0),
  };
}

export interface ServerBench {
  /** Entry path relative to xeon/. */
  readonly entry: string;
  /** Requirement rows the numbers serve. */
  readonly rows: readonly string[];
}

export const SERVER_BENCHES: readonly ServerBench[] = [
  { entry: "packages/cap-knowledge/test/bench/index-budget.bench.ts", rows: ["M3-REQ-98"] },
  { entry: "packages/core-context/test/bench/recent-files.bench.ts", rows: ["M3-new-18"] },
  {
    entry: "packages/ext-host/test/bench/dispatch-lease.bench.ts",
    rows: ["M3-REQ-40", "M3-REQ-41"],
  },
  {
    entry: "packages/core-persistence/test/bench/store.bench.ts",
    rows: ["M3-REQ-64", "M3-29", "M3-new-18"],
  },
];

export interface BenchLine {
  readonly metric: string;
  readonly unit: string;
  readonly samples: readonly number[] | undefined;
  readonly value: number | undefined;
  readonly note: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses one stdout line of a bench entry. undefined for lines that are not bench lines (log noise: anything not starting with "{"). A line that starts with "{" but is not JSON throws; runEntry reports it as a failed entry. */
export function parseBenchLine(line: string): BenchLine | undefined {
  if (!line.startsWith("{")) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (cause) {
    throw new Error(
      `bench line is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    );
  }
  if (!isRecord(json)) return undefined;
  const { metric, unit, samples, value, note } = json;
  if (typeof metric !== "string" || typeof unit !== "string") return undefined;
  const samplesOk =
    Array.isArray(samples) &&
    samples.every((s): s is number => typeof s === "number" && Number.isFinite(s));
  const valueOk = typeof value === "number" && Number.isFinite(value);
  if (!samplesOk && !valueOk) return undefined;
  return {
    metric,
    unit,
    samples: samplesOk ? samples.filter((s): s is number => typeof s === "number") : undefined,
    value: valueOk ? value : undefined,
    note: typeof note === "string" ? note : undefined,
  };
}

/**
 * Budgets of the server metrics, same unit as the metric. undefined means waiting for the user's decision. The key set is
 * the metrics the benches print that are judged; informational metrics (index chars, tokens) have no entry.
 */
export const SERVER_BUDGET: Readonly<Record<string, number | undefined>> = {
  index_build_200_skills: undefined,
  dispatch_overhead_per_handler: undefined,
  lease_turn_overhead: undefined,
  store_commit_event: undefined,
  thread_read_1k_items: undefined,
  projector_rebuild_10k_events: undefined,
};

export interface MetricResult {
  readonly metric: string;
  readonly unit: string;
  /** Median of the samples, or the single value. */
  readonly median: number;
  readonly stats: Stats | undefined;
  readonly note: string | undefined;
  readonly budget: number | undefined;
  readonly verdict: "informational" | "waiting for user decision" | "within" | "over";
}

export function resultOf(
  line: BenchLine,
  budgets: Readonly<Record<string, number | undefined>>,
): MetricResult {
  const sampled = line.samples === undefined ? undefined : stats(line.samples);
  const median = sampled?.median ?? line.value ?? 0;
  const judged = Object.hasOwn(budgets, line.metric);
  const budget = judged ? budgets[line.metric] : undefined;
  const verdict = !judged
    ? "informational"
    : budget === undefined
      ? "waiting for user decision"
      : median <= budget
        ? "within"
        : "over";
  return {
    metric: line.metric,
    unit: line.unit,
    median,
    stats: sampled,
    note: line.note,
    budget,
    verdict,
  };
}

export function formatResult(result: MetricResult): string {
  const spread =
    result.stats === undefined
      ? ""
      : `\tp90 ${String(result.stats.p90)} ${result.unit}\tmin ${String(result.stats.min)}\tmax ${String(result.stats.max)}\truns ${String(result.stats.runs)}`;
  const note = result.note === undefined ? "" : `\t${result.note}`;
  return `${result.metric}\tmedian ${String(result.median)} ${result.unit}${spread}\t${result.verdict}${note}`;
}

/** Runs one entry and returns its parsed lines, or the reason it failed. */
export async function runEntry(
  xeonRoot: string,
  entry: string,
): Promise<readonly BenchLine[] | Error> {
  try {
    const child = Bun.spawn([process.execPath, join(xeonRoot, entry)], {
      cwd: xeonRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0)
      return new Error(`${entry} exited with ${String(code)}: ${err.trim().slice(0, 300)}`);
    const lines = out.split("\n").flatMap((line) => parseBenchLine(line) ?? []);
    return lines.length === 0 ? new Error(`${entry} printed no bench lines`) : lines;
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

if (import.meta.main) {
  const json = Bun.argv.includes("--json");
  const xeonRoot = join(import.meta.dir, "..");
  const results: MetricResult[] = [];
  const failures: string[] = [];
  // One entry at a time: the machine is shared and benches must not overlap.
  await SERVER_BENCHES.reduce<Promise<void>>(async (previous, bench) => {
    await previous;
    const lines = await runEntry(xeonRoot, bench.entry);
    if (lines instanceof Error) failures.push(lines.message);
    else results.push(...lines.map((line) => resultOf(line, SERVER_BUDGET)));
  }, Promise.resolve());
  if (json) process.stdout.write(`${JSON.stringify(results)}\n`);
  else for (const result of results) process.stdout.write(`${formatResult(result)}\n`);
  for (const failure of failures) process.stderr.write(`bench-server: ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 2);
}
