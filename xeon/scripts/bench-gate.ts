#!/usr/bin/env bun
// Budget gate over server bench results (M3-29, eng.performance.guide section 4).
//   bun scripts/bench-server.ts --json | bun scripts/bench-gate.ts [--strict]
//   bun scripts/bench-gate.ts <results.json> [--strict]
// Reads the JSON array printed by `bench-server.ts --json`. A metric over its budget fails (exit 1). A metric whose budget
// is still waiting for the user decision passes unless --strict, which fails (exit 1) so a release gate cannot ship with an
// unset budget. Informational metrics are never judged. Exit codes: 0 pass, 1 over budget (or waiting under --strict),
// 2 the input is not a results array.
import { parseArgs } from "node:util";
import type { MetricResult } from "./bench-server.ts";

export interface GateReport {
  readonly over: readonly string[];
  readonly waiting: readonly string[];
  readonly within: readonly string[];
  readonly pass: boolean;
}

export function gate(results: readonly MetricResult[], strict: boolean): GateReport {
  const names = (verdict: MetricResult["verdict"]): string[] =>
    results.filter((r) => r.verdict === verdict).map((r) => r.metric);
  const over = names("over");
  const waiting = names("waiting for user decision");
  return {
    over,
    waiting,
    within: names("within"),
    pass: over.length === 0 && !(strict && waiting.length > 0),
  };
}

const VERDICTS: readonly string[] = [
  "informational",
  "waiting for user decision",
  "within",
  "over",
];

/** Checks that the parsed JSON is a results array the gate can judge. */
export function readResults(json: unknown): readonly MetricResult[] | undefined {
  if (!Array.isArray(json)) return undefined;
  const items: readonly unknown[] = json;
  const results: MetricResult[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) return undefined;
    const { metric, unit, median, verdict }: Record<string, unknown> = Object.fromEntries(
      Object.entries(item),
    );
    if (typeof metric !== "string" || typeof unit !== "string" || typeof median !== "number")
      return undefined;
    if (typeof verdict !== "string" || !VERDICTS.includes(verdict)) return undefined;
    const known = VERDICTS.find((v): v is MetricResult["verdict"] => v === verdict);
    if (known === undefined) return undefined;
    results.push({
      metric,
      unit,
      median,
      stats: undefined,
      note: undefined,
      budget: undefined,
      verdict: known,
    });
  }
  return results;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: { strict: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const [file] = positionals;
  const text = file === undefined ? await Bun.stdin.text() : await Bun.file(file).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    process.stderr.write(`bench-gate: input is not JSON: ${String(cause)}\n`);
    process.exit(2);
  }
  const results = readResults(parsed);
  if (results === undefined) {
    process.stderr.write("bench-gate: input is not a bench-server --json results array\n");
    process.exit(2);
  }
  const report = gate(results, values.strict);
  for (const name of report.over) process.stdout.write(`over budget: ${name}\n`);
  for (const name of report.waiting) process.stdout.write(`waiting for user decision: ${name}\n`);
  process.stdout.write(
    `gate ${report.pass ? "pass" : "fail"}: ${String(report.within.length)} within, ${String(report.waiting.length)} waiting, ${String(report.over.length)} over\n`,
  );
  process.exit(report.pass ? 0 : 1);
}
