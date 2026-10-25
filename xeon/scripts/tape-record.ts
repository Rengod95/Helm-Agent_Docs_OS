#!/usr/bin/env bun
// Record a model tape from a real provider (eng.testing.guide TS-04, M2 closing G4-06, decision D-e).
//   tape-record <scenario> [--yes]
// A recording calls the configured model provider with the user's key and costs money, so it needs a person:
// without --yes it prints what it would do and exits 3. With --yes it runs the recorder entry of core-models
// (packages/core-models/scripts/record-tape.ts <scenario> <out>), which writes a tape with origin "recorded" and
// recordedFrom. The recorder entry belongs to L1C; until it exists the recipe stops with exit 1 and names it.
// Exit codes: 0 recorded, 1 bad scenario name or missing recorder entry, 2 environment (bun cannot start, the
// recorder reports a missing key), 3 needs --yes.
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

export const RECORDER_ENTRY = "packages/core-models/scripts/record-tape.ts";
export const TAPE_DIR = "packages/core-models/test/tapes/recorded";

export interface RecordPlan {
  readonly scenario: string;
  /** Relative to xeon/. */
  readonly out: string;
  readonly confirmed: boolean;
}

/** Checks the arguments. A scenario is lower-case words joined by hyphens, as in tape ids (`core-loop/two-tool-calls`). */
export function planRecording(
  positionals: readonly string[],
  yes: boolean,
):
  | { readonly ok: true; readonly plan: RecordPlan }
  | { readonly ok: false; readonly error: string } {
  const [scenario, ...rest] = positionals;
  if (scenario === undefined || rest.length > 0) {
    return { ok: false, error: "usage: tape-record <scenario> [--yes]" };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario)) {
    return {
      ok: false,
      error: `scenario "${scenario}" must be lower-case words joined by hyphens`,
    };
  }
  return {
    ok: true,
    plan: { scenario, out: `${TAPE_DIR}/${scenario}.tape.jsonl`, confirmed: yes },
  };
}

/** What a person reads before saying --yes. */
export function describePlan(plan: RecordPlan): string {
  return [
    `tape-record ${plan.scenario} calls the configured model provider with your key (real cost).`,
    `It writes ${plan.out} with origin "recorded". Review the tape before committing it: secrets are masked by the`,
    "recorder, but the prompts and answers are stored as they are.",
    `Run again with --yes to record (decision D-e: one recording before M2 closes).`,
  ].join("\n");
}

/** Maps the recorder's exit code: 2 stays an environment problem (no key), other failures are 1. */
export function recorderExit(code: number): 0 | 1 | 2 {
  if (code === 0) return 0;
  return code === 2 ? 2 : 1;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  const planned = planRecording(positionals, values.yes);
  if (!planned.ok) {
    process.stderr.write(`tape-record: ${planned.error}\n`);
    process.exit(1);
  }
  const { plan } = planned;
  if (!plan.confirmed) {
    process.stdout.write(`${describePlan(plan)}\n`);
    process.exit(3);
  }
  const xeonRoot = resolve(import.meta.dir, "..");
  const entry = join(xeonRoot, RECORDER_ENTRY);
  if (!existsSync(entry)) {
    process.stderr.write(
      `tape-record: ${relative(xeonRoot, entry)} does not exist yet. The recorder is L1C work (core-models): it takes <scenario> <out> and writes a tape with origin "recorded".\n`,
    );
    process.exit(1);
  }
  let code: number;
  try {
    const child = Bun.spawn([process.execPath, entry, plan.scenario, join(xeonRoot, plan.out)], {
      cwd: xeonRoot,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    code = await child.exited;
  } catch (cause) {
    process.stderr.write(
      `tape-record: could not run bun: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exit(2);
  }
  process.exit(recorderExit(code));
}
