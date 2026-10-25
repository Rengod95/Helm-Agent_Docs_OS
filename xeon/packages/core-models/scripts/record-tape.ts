#!/usr/bin/env bun
// Tape recorder entry (eng.testing.guide TS-04, M2 closing G4-06, decision D-e). Started by xeon/scripts/tape-record.ts
// after a person said --yes:
//   record-tape.ts <scenario> <out>
// It calls the real provider with the key from the environment (`secrets run dev -- ...` injects it; never a file or an
// argument), through pi-ai's request option `fetch`, and writes a tape with origin "recorded" (raw SSE chunks with ms
// offsets in `wire`). Exit codes: 0 recorded, 1 bad arguments or a failed recording, 2 environment (no key, a CI
// run, a subscription token), which tape-record.ts passes through.
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AssistantMessage, FetchFunction, Models } from "@earendil-works/pi-ai";
import { assertNever, attemptAsync, eachAsync, parseJson } from "@xeon/contracts";
import { isOauthTokenOnDefaultProvider } from "../src/secrets-bridge.ts";
import {
  buildRecordedTape,
  MIN_SECRET_LENGTH,
  recordingFetch,
  renderRecordedTape,
  scrubSecrets,
  type RecordedTurn,
  type RecordFailure,
} from "../src/testing/index.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";

const RECORDED_DIR: string = resolve(import.meta.dir, "../test/tapes/recorded");
export const KEY_HINT: string = "just secret-add ANTHROPIC_API_KEY";

export interface RecordDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** 실제 요청을 보내는 fetch. 시험은 가짜를 넣는다 */
  readonly fetch: FetchFunction;
  readonly now: () => number;
  readonly clock: () => Date;
  /** 테이프를 둘 수 있는 폴더. 기본은 test/tapes/recorded */
  readonly outDir: string;
  readonly models: () => Models;
  readonly piAiVersion: () => Promise<string>;
}

async function defaultPiAiVersion(): Promise<string> {
  const entry = import.meta.resolve("@earendil-works/pi-ai");
  const text = await Bun.file(new URL("../package.json", entry)).text();
  const parsed = parseJson(text);
  if (parsed.ok && typeof parsed.value === "object" && parsed.value !== null) {
    const version: unknown = Object.entries(parsed.value).find(([key]) => key === "version")?.[1];
    if (typeof version === "string") return version;
  }
  return "unknown";
}

function defaultDeps(): RecordDeps {
  return {
    env: process.env,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    fetch: globalThis.fetch,
    now: () => performance.now(),
    clock: () => new Date(),
    outDir: RECORDED_DIR,
    models: () => builtinModels(),
    piAiVersion: defaultPiAiVersion,
  };
}

function describeFailure(failure: RecordFailure): string {
  switch (failure.kind) {
    case "no_turns":
      return "the scenario has no turns";
    case "turn_failed":
      return `turn ${failure.turn} did not finish: ${failure.message}`;
    case "turn_exchange_count":
      return `turn ${failure.turn} made ${failure.count} HTTP request(s), expected exactly 1 (a retry is not recorded)`;
    case "http_status":
      return `turn ${failure.turn} got HTTP ${failure.status}`;
    case "incomplete_exchange":
      return `turn ${failure.turn} response body was cut off`;
    case "secret_remains":
      return `the tape still holds ${failure.findings.length} secret finding(s) (${[...new Set(failure.findings.map((f) => f.kind))].join(", ")}) after masking; nothing was written`;
    default:
      return assertNever(failure, "describeFailure");
  }
}

async function runScenario(
  scenario: Scenario,
  key: string,
  deps: RecordDeps,
): Promise<
  { readonly turns: RecordedTurn[]; readonly recorder: ReturnType<typeof recordingFetch> } | string
> {
  const models = deps.models();
  const model = models.getModel(scenario.provider, scenario.model);
  if (model === undefined)
    return `model ${scenario.provider}/${scenario.model} is not in the catalog`;
  const recorder = recordingFetch({ base: deps.fetch, now: deps.now, secrets: [key] });
  const turns: RecordedTurn[] = [];
  const messages: AssistantMessage[] = [];
  await eachAsync(scenario.turns, async (turn) => {
    const context = turn.context(messages);
    const stream = models.streamSimple(model, context, {
      apiKey: key,
      fetch: recorder.fetch,
      maxTokens: turn.maxTokens,
    });
    const message = await stream.result();
    messages.push(message);
    turns.push({ role: turn.role, message, exchanges: recorder.take(), label: turn.label });
    return undefined;
  });
  return { turns, recorder };
}

/** `record-tape.ts <scenario> <out>`. Returns the exit code. */
export async function main(argv: readonly string[], deps: RecordDeps): Promise<number> {
  const [name, out, ...rest] = argv;
  if (name === undefined || out === undefined || rest.length > 0) {
    deps.stderr("usage: record-tape.ts <scenario> <out>\n");
    return 1;
  }
  const scenario = Object.hasOwn(SCENARIOS, name) ? SCENARIOS[name] : undefined;
  if (scenario === undefined) {
    deps.stderr(`unknown scenario "${name}"; known: ${Object.keys(SCENARIOS).join(", ")}\n`);
    return 1;
  }
  const target = resolve(out);
  if (dirname(target) !== resolve(deps.outDir) || !target.endsWith(".tape.jsonl")) {
    deps.stderr(`the output must be a *.tape.jsonl file directly under ${deps.outDir}\n`);
    return 1;
  }
  if (deps.env["CI"] !== undefined && deps.env["CI"] !== "" && deps.env["CI"] !== "false") {
    deps.stderr("recording is manual only; it does not run in CI\n");
    return 2;
  }
  const key = deps.env[scenario.keyEnv];
  if (key === undefined || key === "") {
    deps.stderr(`${scenario.keyEnv} is not set. Add it with: ${KEY_HINT}\n`);
    return 2;
  }
  if (key.length < MIN_SECRET_LENGTH) {
    deps.stderr(`${scenario.keyEnv} is too short to be an API key\n`);
    return 2;
  }
  if (isOauthTokenOnDefaultProvider(scenario.provider, key)) {
    deps.stderr(`${scenario.keyEnv} holds a subscription token; the recorder needs an API key\n`);
    return 2;
  }
  // 다시 녹화하려면 사람이 대상 테이프를 먼저 지운다. 덮어쓰기 모드는 두지 않는다
  if (await Bun.file(target).exists()) {
    deps.stderr(`${target} already exists; delete it first to record again\n`);
    return 1;
  }

  const ran = await attemptAsync(() => runScenario(scenario, key, deps));
  if (!ran.ok) {
    const reason = ran.error.cause instanceof Error ? ran.error.cause.message : "request failed";
    deps.stderr(`recording stopped: ${scrubSecrets(reason, [key])}\n`);
    return 1;
  }
  if (typeof ran.value === "string") {
    deps.stderr(`${ran.value}\n`);
    return 1;
  }
  const built = buildRecordedTape({
    scenario: name,
    provider: scenario.provider,
    model: scenario.model,
    piAi: await deps.piAiVersion(),
    at: deps.clock().toISOString(),
    turns: ran.value.turns,
    secrets: [key],
  });
  if (!built.ok) {
    deps.stderr(`recording failed: ${describeFailure(built.error)}\n`);
    return 1;
  }
  const rendered = renderRecordedTape(built.value, [key]);
  if (!rendered.ok) {
    deps.stderr(`recording failed: ${describeFailure(rendered.error)}\n`);
    return 1;
  }
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, rendered.value);
  deps.stdout(
    `recorded ${scenario.turns.length} turn(s) to ${join(deps.outDir, `${name}.tape.jsonl`)}\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2), defaultDeps()));
}
