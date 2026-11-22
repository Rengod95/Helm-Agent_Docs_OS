#!/usr/bin/env bun
// 턴 기록 쓰기의 비용 (정본 docs/xeon/review/m5/turn-record-metrics.md §9 29, 방법은 X.operations §4.8.5의 `dispatch_overhead_trace_on_vs_off`와 같다).
// 실제 모델 호출은 없다. 실제 측정 저장소(bun:sqlite, 임시 폴더, 끝나면 지움)와 실제 턴 기록기와 싱크로 합성 턴을 돌린다.
// 시나리오는 단계 1·5·20 × 단계당 도구 호출 0·3·10이다. 훅 40, 재료 60, 광고 도구 80은 턴마다 같다.
//   bun apps/host/test/benchmark/turn-record.benchmark.ts [--iterations <n>] [--deadline-s <n>]
//   (xeon/에서 `just benchmark --turn-record`로 부른다. 같은 기록이 나오도록 guard 아래에서 돈다)
// 워밍업 10턴은 세지 않는다. 계측 켬과 끔을 같은 턴으로 번갈아 돈다. 시나리오마다 목표 턴 수(기본 200)나 마감(기본 90초) 가운데 먼저 닿는 쪽에서 멈춘다.
// 세 부분을 잰다: (1) 동기 구간 = 싱크 호출과 `step.completed` 커밋, 모델·도구 경로가 기다리는 시간. (2) 연기된 쓰기 = 묶음(마이크로태스크)에서 SQLite에 쓰는 시간,
// 단계마다와 턴마다. (3) 턴 벽시계 시간의 켬과 끔 차이(짝 맞춘 차이의 분포).
// 출력: stdout에 시나리오마다 JSON 한 줄(분위수는 p50·p95·max, 표본 수 n). stderr에는 같은 값의 표.
// 판정: 뒤쪽 쓰기의 예산(§9 29, L4.host-service.spec §4.20, 결정 2026-11-20 사용자, AGE-50)은 긴 턴(steps=20,calls=10)의
// 턴당 뒤쪽 쓰기 p95 25 ms 이하다. 그 시나리오의 줄에 판정(within, over)을 싣고 끝에 한 줄로 다시 낸다. 다른 시나리오는 not_judged다.
// 동기 구간과 턴 차이에는 기준값이 없어 수치만 낸다(X.operations §4.8.5 "기준값은 아직 없다").
// 종료코드: 0 측정 끝(예산 안), 1 잘못된 인자, 합성 턴이 기대와 다른 쓰기(측정이 틀렸다), 또는 예산을 넘음(고친다), 2 환경 문제(측정 폴더를 열지 못함).
import { parseArgs } from "node:util";
import {
  BenchEnvironmentError,
  runScenario,
  type ArmSamples,
  type ScenarioRun,
} from "./turn-record-driver.ts";
import { scenarioGrid, scenarioLabel } from "./turn-record-fixture.ts";
import {
  describeVerdict,
  judgeDeferredTurn,
  summarize,
  type BudgetVerdict,
  type Summary,
} from "./turn-record-stats.ts";

const DEFAULT_ITERATIONS = 200;
const DEFAULT_DEADLINE_S = 90;

/** 예산이 무엇을 재는지. 판정은 시나리오 줄의 `verdict`에 있다 */
const BUDGET_NOTE =
  "deferred/turn p95 <= 25 ms at steps=20,calls=10 (turn-record-metrics §9 29, AGE-50); other numbers have no budget";

interface ScenarioLine {
  readonly scenario: string;
  readonly iterations: number;
  readonly deadline_hit: boolean;
  readonly sanity: string;
  readonly warnings: number;
  readonly sync_per_step_ms: Summary;
  readonly sync_breakdown_ms: {
    readonly context_per_step: Summary;
    readonly usage_per_step: Summary;
    readonly call_per_step: Summary;
    /** 도구 호출 하나의 동기 시간. 호출이 없는 시나리오는 null */
    readonly call_each: Summary | null;
    readonly commit_step_completed: Summary;
  };
  readonly sync_turn_open_ms: Summary;
  readonly sync_turn_close_ms: Summary;
  readonly deferred_per_step_ms: Summary;
  readonly deferred_per_turn_ms: Summary;
  readonly turn_ms_trace_on: Summary;
  readonly turn_ms_trace_off: Summary;
  readonly turn_overhead_ms: Summary;
  readonly budget: string;
  readonly verdict: BudgetVerdict;
  readonly runtime: { readonly bun: string; readonly platform: string; readonly arch: string };
}

function lineOf(run: ScenarioRun): ScenarioLine {
  const on: ArmSamples = run.on;
  return {
    scenario: scenarioLabel(run.scenario),
    iterations: run.iterations,
    deadline_hit: run.deadlineHit,
    sanity: run.sanity,
    warnings: run.warnings,
    sync_per_step_ms: summarize(on.stepSyncMs),
    sync_breakdown_ms: {
      context_per_step: summarize(on.contextMs),
      usage_per_step: summarize(on.usageMs),
      call_per_step: summarize(on.callSumMs),
      call_each: on.callEachMs.length === 0 ? null : summarize(on.callEachMs),
      commit_step_completed: summarize(on.commitMs),
    },
    sync_turn_open_ms: summarize(on.openSyncMs),
    sync_turn_close_ms: summarize(on.closeSyncMs),
    deferred_per_step_ms: summarize(on.stepDeferredMs),
    deferred_per_turn_ms: summarize(on.turnDeferredMs),
    turn_ms_trace_on: summarize(on.wallMs),
    turn_ms_trace_off: summarize(run.off.wallMs),
    turn_overhead_ms: summarize(run.overheadMs),
    budget: BUDGET_NOTE,
    verdict: judgeDeferredTurn(run.scenario, summarize(on.turnDeferredMs)),
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  };
}

function fmt(value: number): string {
  return value.toFixed(3);
}

/** 사람이 읽는 표(stderr). 같은 값을 JSON 줄과 나란히 낸다 */
function tableRow(run: ScenarioRun): string {
  const on = run.on;
  const sync = summarize(on.stepSyncMs);
  const deferredStep = summarize(on.stepDeferredMs);
  const deferredTurn = summarize(on.turnDeferredMs);
  const wallOn = summarize(on.wallMs);
  const wallOff = summarize(run.off.wallMs);
  const overhead = summarize(run.overheadMs);
  return [
    scenarioLabel(run.scenario).padEnd(18),
    `${fmt(sync.p50)} ${fmt(sync.p95)} ${fmt(sync.max)}`.padEnd(26),
    `${fmt(deferredStep.p50)} ${fmt(deferredStep.p95)} ${fmt(deferredStep.max)}`.padEnd(26),
    `${fmt(deferredTurn.p50)} ${fmt(deferredTurn.p95)} ${fmt(deferredTurn.max)}`.padEnd(26),
    `${fmt(wallOn.p50)} ${fmt(wallOn.p95)}`.padEnd(20),
    `${fmt(wallOff.p50)} ${fmt(wallOff.p95)}`.padEnd(20),
    `${fmt(overhead.p50)} ${fmt(overhead.p95)} ${fmt(overhead.max)}`,
  ].join(" | ");
}

const TABLE_HEADER = [
  "scenario".padEnd(18),
  "sync/step p50 p95 max".padEnd(26),
  "deferred/step p50 p95 max".padEnd(26),
  "deferred/turn p50 p95 max".padEnd(26),
  "turn on p50 p95".padEnd(20),
  "turn off p50 p95".padEnd(20),
  "overhead p50 p95 max",
].join(" | ");

class UsageError extends Error {}

/** 정수 인자. 없으면 기본값, 범위를 벗어나면 사용 오류(종료코드 1) */
function intFlag(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`--${name} must be an integer from ${String(min)} to ${String(max)}`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        iterations: { type: "string" },
        "deadline-s": { type: "string" },
      },
    });
    const iterations = intFlag("iterations", values.iterations, DEFAULT_ITERATIONS, 1, 5000);
    const deadlineS = intFlag("deadline-s", values["deadline-s"], DEFAULT_DEADLINE_S, 5, 900);
    process.stderr.write(`${TABLE_HEADER}\n`);
    const verdicts: BudgetVerdict[] = [];
    for (const scenario of scenarioGrid()) {
      // oxlint-disable-next-line no-await-in-loop -- 시나리오는 하나씩 돈다. 같은 시간대에 두 개를 돌리면 서로의 비용이 섞인다 (eng.testing.guide TS-05)
      const run = await runScenario(scenario, { iterations, deadlineMs: deadlineS * 1000 });
      const line = lineOf(run);
      verdicts.push(line.verdict);
      process.stdout.write(`${JSON.stringify(line)}\n`);
      process.stderr.write(`${tableRow(run)}\n`);
      if (run.deadlineHit) {
        process.stderr.write(
          `  deadline reached at ${String(run.iterations)} of ${String(iterations)} turns (${scenarioLabel(run.scenario)})\n`,
        );
      }
    }
    process.stderr.write(`budget: ${BUDGET_NOTE}\n`);
    const judged = verdicts.filter((v) => v.kind !== "not_judged");
    for (const verdict of judged) process.stderr.write(`verdict: ${describeVerdict(verdict)}\n`);
    process.exit(judged.some((v) => v.kind === "over") ? 1 : 0);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`turn-record benchmark: ${error.message}\n`);
      process.exit(1);
    }
    if (error instanceof BenchEnvironmentError) {
      process.stderr.write(`turn-record benchmark: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
