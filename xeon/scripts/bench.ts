#!/usr/bin/env bun
// Speed baseline (ADR-0012, eng.performance.guide, M2 closing G2-04). Skeleton: measures what costs nothing and asks
// before what calls a real model.
//   bench [--runs <n>]                 cold start of `xeon version` (bun entry) and of the compiled sidecar, if built
//   bench --first-token [--yes]        also time to the first stream.chunk of one real `xeon chat -p` turn
//   bench --server                     also the server benches (bench-server.ts: index, lease, dispatch, store); judge them with bench-gate.ts
// --first-token calls the configured model provider (cost, key). Without --yes it prints what it would do and exits 3
// (decision D-e: one run before M2 closes, confirmed each time).
// Exit codes: 0 measured, 1 bad arguments, 2 environment (bun or the CLI cannot start, the turn fails), 3 needs --yes.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { hostTriple, outputFileName } from "./build-sidecar.ts";

export type Metric = "cold_start_cli" | "cold_start_sidecar" | "first_token";

/** Budgets in ms. undefined until the user sets them from the baseline (eng.performance.guide section 2). */
export const BUDGET_MS: Readonly<Record<Metric, number | undefined>> = {
  cold_start_cli: undefined,
  cold_start_sidecar: undefined,
  first_token: undefined,
};

const round = (value: number): number => Math.round(value * 10) / 10;

export interface Stats {
  readonly runs: number;
  readonly min: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}

/** Order statistics of the samples (ms, rounded to 0.1). undefined for no samples. */
export function stats(samples: readonly number[]): Stats | undefined {
  if (samples.length === 0) return undefined;
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  return {
    runs: sorted.length,
    min: round(sorted[0] ?? 0),
    median: round(at(0.5)),
    p90: round(at(0.9)),
    max: round(sorted.at(-1) ?? 0),
  };
}

export type BudgetVerdict = "no budget" | "within" | "over";

export function judgeBudget(median: number, budget: number | undefined): BudgetVerdict {
  if (budget === undefined) return "no budget";
  return median <= budget ? "within" : "over";
}

/** A line of `xeon chat -p --json` output that carries streamed model text. */
export function isStreamChunk(line: string): boolean {
  return /"method"\s*:\s*"stream\.chunk"/.test(line);
}

export interface BenchPlan {
  readonly runs: number;
  readonly firstToken: "off" | "ask" | "run";
}

export function planBench(options: {
  readonly runs: string | undefined;
  readonly firstToken: boolean;
  readonly yes: boolean;
}):
  | { readonly ok: true; readonly plan: BenchPlan }
  | { readonly ok: false; readonly error: string } {
  const runs = options.runs === undefined ? 5 : Number(options.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 50) {
    return { ok: false, error: "--runs must be an integer from 1 to 50" };
  }
  const firstToken = !options.firstToken ? "off" : options.yes ? "run" : "ask";
  return { ok: true, plan: { runs, firstToken } };
}

export function formatRow(metric: Metric, result: Stats | string): string {
  if (typeof result === "string") return `${metric}\t${result}`;
  const verdict = judgeBudget(result.median, BUDGET_MS[metric]);
  return `${metric}\tmedian ${String(result.median)} ms\tp90 ${String(result.p90)} ms\tmin ${String(result.min)}\tmax ${String(result.max)}\truns ${String(result.runs)}\t${verdict}`;
}

async function timeExit(argv: readonly string[], cwd: string): Promise<number | Error> {
  try {
    const started = performance.now();
    const child = Bun.spawn([...argv], { cwd, stdout: "ignore", stderr: "ignore" });
    const code = await child.exited;
    const elapsed = performance.now() - started;
    return code === 0 ? elapsed : new Error(`${argv.join(" ")} exited with ${String(code)}`);
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

async function sample(argv: readonly string[], cwd: string, runs: number): Promise<Stats | Error> {
  const samples = await Array.from({ length: runs }).reduce<Promise<number[] | Error>>(
    async (previous) => {
      const done = await previous;
      if (done instanceof Error) return done;
      const elapsed = await timeExit(argv, cwd);
      return elapsed instanceof Error ? elapsed : [...done, elapsed];
    },
    Promise.resolve([]),
  );
  if (samples instanceof Error) return samples;
  return stats(samples) ?? new Error("no samples");
}

async function measureFirstToken(cliEntry: string, cwd: string): Promise<number | Error> {
  try {
    const started = performance.now();
    const child = Bun.spawn(
      [process.execPath, cliEntry, "chat", "-p", "Reply with the single word: ready", "--json"],
      { cwd, stdout: "pipe", stderr: "ignore" },
    );
    const decoder = new TextDecoder();
    let buffered = "";
    let at: number | undefined;
    for await (const chunk of child.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      if (at === undefined && lines.some(isStreamChunk)) at = performance.now() - started;
    }
    const code = await child.exited;
    if (at !== undefined) return at;
    return new Error(
      `xeon chat exited with ${String(code)} before any stream.chunk (model key or provider settings)`,
    );
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause));
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      runs: { type: "string" },
      "first-token": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      server: { type: "boolean", default: false },
    },
  });
  const planned = planBench({
    runs: values.runs,
    firstToken: values["first-token"],
    yes: values.yes,
  });
  if (!planned.ok) {
    process.stderr.write(`bench: ${planned.error}\n`);
    process.exit(1);
  }
  const { plan } = planned;
  if (plan.firstToken === "ask") {
    process.stdout.write(
      "bench --first-token runs one real `xeon chat -p` turn with the configured model provider and key. It costs one small model call.\nRun again with --yes to measure (decision D-e).\n",
    );
    process.exit(3);
  }
  const xeonRoot = resolve(import.meta.dir, "..");
  const cliEntry = join(xeonRoot, "apps", "cli", "src", "main.ts");
  const cli = await sample([process.execPath, cliEntry, "version", "--json"], xeonRoot, plan.runs);
  if (cli instanceof Error) {
    process.stderr.write(`bench: ${cli.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${formatRow("cold_start_cli", cli)}\n`);

  const triple = hostTriple(process.platform, process.arch);
  const sidecar = triple.ok
    ? join(
        xeonRoot,
        "apps",
        "desktop",
        "src-tauri",
        "binaries",
        outputFileName("xeon", triple.value),
      )
    : undefined;
  if (sidecar === undefined || !existsSync(sidecar)) {
    process.stdout.write(
      `${formatRow("cold_start_sidecar", "skipped: no sidecar (just desktop-sidecar host)")}\n`,
    );
  } else {
    const result = await sample([sidecar, "version", "--json"], xeonRoot, plan.runs);
    process.stdout.write(
      `${formatRow("cold_start_sidecar", result instanceof Error ? `failed: ${result.message}` : result)}\n`,
    );
  }

  if (values.server) {
    const server = Bun.spawn([process.execPath, join(xeonRoot, "scripts", "bench-server.ts")], {
      cwd: xeonRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await server.exited) !== 0) process.exit(2);
  }

  if (plan.firstToken === "off") {
    process.stdout.write(
      `${formatRow("first_token", "skipped: needs --first-token --yes (real model call)")}\n`,
    );
    process.exit(0);
  }
  const token = await measureFirstToken(cliEntry, process.cwd());
  if (token instanceof Error) {
    process.stderr.write(`bench: ${token.message}\n`);
    process.exit(2);
  }
  const tokenStats = stats([token]);
  process.stdout.write(`${formatRow("first_token", tokenStats ?? "failed: no sample")}\n`);
}
