// 턴 기록 벤치의 구동기. 실제 측정 기록기(`startMeasurement`)를 임시 폴더의 실제 `measure.db`에 열고, 합성 턴을 호스트와 같은 길로 넣는다.
// 싱크는 `assemble.ts`의 슬롯 경로와 같다(싱크 → 슬롯 → 기록기). 커밋은 피드 구독자를 직접 부르고, 모델 호출 사용량은 합산기 구독자를 부른다.
// 시간은 세 부분으로 잰다. (1) 동기 구간: 싱크 호출과 `step.completed` 커밋(기록기의 커밋 경로)이 모델·도구 경로를 막는 시간.
// (2) 연기된 쓰기: 기록기가 마이크로태스크 묶음(`flush`)에서 SQLite에 쓰는 시간. 커밋 뒤 한 번 기다려 잰다. (3) 턴 전체 벽시계 시간(계측 켬과 끔).
// 훅 행은 계측 링 버퍼에 넣는 일이라 ext-host의 몫이고 여기서는 배열에 넣기만 한다. 그 비용은 `dispatch_overhead_trace_on_vs_off`가 잰다.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  ContextTraceEvent,
  ContextTraceSink,
  ToolCallTraceEvent,
  ToolCallTraceSink,
  TraceReadPort,
  TraceRecordEvent,
  TraceTurnEntry,
} from "@fresnel/contracts/extensions";
import type { CommitBatch, CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { startMeasurement } from "../../src/assembly/measure/recorder.ts";
import { createTurnRecordEvents } from "../../src/assembly/measure/turn-events.ts";
import { DEFAULT_MAX_TURN_BYTES } from "../../src/assembly/measure/turn-fit.ts";
import { buildTurn, type Scenario, type SyntheticTurn } from "./turn-record-fixture.ts";
import { keepGoing } from "./turn-record-stats.ts";

/** 측정 폴더를 열지 못했다. 환경 문제이므로 벤치는 종료코드 2로 끝난다 */
export class BenchEnvironmentError extends Error {}

/** 워밍업 턴 수(두 조건 각각). 세지 않는다 */
const WARMUP_TURNS: number = 10;

interface Arm {
  readonly enabled: boolean;
  readonly commit: (event: DurableEventEnvelope) => void;
  readonly context: ContextTraceSink;
  readonly call: ToolCallTraceSink;
  readonly usage: (record: UsageRecord) => void;
  readonly hook: (threadId: ThreadId, turnId: TurnId, entry: TraceTurnEntry) => void;
  readonly dropTrace: (turnId: TurnId) => void;
  readonly warnings: () => number;
  readonly readTurn: (threadId: ThreadId, turnId: TurnId) => TurnReadResult;
  readonly close: () => void;
}

/** 확인에 쓰는 행 수. 저장소의 턴 묶음에서 필요한 것만 본다 */
interface TurnRowsView {
  readonly status: string;
  readonly steps: number;
  readonly calls: number;
  readonly hooks: number;
  readonly materials: number;
}

interface TurnReadResult {
  readonly ok: boolean;
  readonly value?: TurnRowsView;
}

/** 조건 하나의 표본(측정 턴마다 한 값). 단위는 모두 ms */
export interface ArmSamples {
  readonly wallMs: number[];
  readonly openSyncMs: number[];
  readonly closeSyncMs: number[];
  /** 단계마다 한 값: 싱크 호출과 `step.completed` 커밋의 동기 합 */
  readonly stepSyncMs: number[];
  readonly contextMs: number[];
  readonly usageMs: number[];
  /** 단계마다 그 단계 도구 호출 줄의 합 */
  readonly callSumMs: number[];
  /** 도구 호출 줄마다 한 값 */
  readonly callEachMs: number[];
  readonly commitMs: number[];
  /** 단계마다 한 값: `step.completed` 뒤 묶음 쓰기 */
  readonly stepDeferredMs: number[];
  /** 턴마다 한 값: 턴 열기, 모든 단계, 턴 닫기의 연기된 쓰기 합 */
  readonly turnDeferredMs: number[];
}

export interface ScenarioRun {
  readonly scenario: Scenario;
  /** 워밍업을 뺀 측정 턴 수(조건마다 같다) */
  readonly iterations: number;
  /** 마감 시각 안에 목표에 닿지 못했다 */
  readonly deadlineHit: boolean;
  /** 확인한 행 수. 쓰기가 기대와 다르면 벤치는 실패한다 */
  readonly sanity: string;
  readonly warnings: number;
  readonly on: ArmSamples;
  readonly off: ArmSamples;
  /** 측정 턴마다 계측 켬 벽시계 시간에서 끔 벽시계 시간을 뺀 값(같은 합성 턴, 같은 순서 교대) */
  readonly overheadMs: number[];
}

interface RunOptions {
  /** 측정할 턴 수(조건마다). 목표에 닿아야 한다 */
  readonly iterations: number;
  /** 시나리오 하나에 쓸 최대 시간(ms). 넘으면 거기서 멈추고 `deadlineHit`이다 */
  readonly deadlineMs: number;
}

function emptySamples(): ArmSamples {
  return {
    wallMs: [],
    openSyncMs: [],
    closeSyncMs: [],
    stepSyncMs: [],
    contextMs: [],
    usageMs: [],
    callSumMs: [],
    callEachMs: [],
    commitMs: [],
    stepDeferredMs: [],
    turnDeferredMs: [],
  };
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** 함수 하나의 동기 시간(ms) */
function timed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

/** 커밋 뒤 한 번 기다려 마이크로태스크 묶음(쓰기)이 끝난 시간(ms). 호출 전에 커밋해야 한다 */
async function flushed(): Promise<number> {
  const started = performance.now();
  await Promise.resolve();
  return performance.now() - started;
}

function openArm(enabled: boolean): Arm {
  const dir = mkdtempSync(join(tmpdir(), "turn-record-bench-"));
  const commitListeners = new Set<CommitListener>();
  const usageListeners = new Set<(record: UsageRecord) => void>();
  const traces = new Map<string, TraceTurnEntry[]>();
  let warned = 0;
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => {
      warned += 1;
    },
    error: () => {
      warned += 1;
    },
    child: () => logger,
  };
  const recordListeners = new Set<(event: TraceRecordEvent) => void>();
  const trace: Pick<TraceReadPort, "turn" | "onRecord"> = {
    turn: (_threadId, turnId) => ({
      traceEnabled: enabled,
      retained: enabled,
      entries: enabled ? (traces.get(turnId) ?? []) : [],
    }),
    // 실제 링 버퍼처럼 처리기 기록이 쌓인 직후를 알린다(도는 중에 Hook 행을 보내는 길)
    onRecord: (listener) => {
      recordListeners.add(listener);
      return () => {
        recordListeners.delete(listener);
      };
    },
  };
  // 싱크 슬롯. 조립 루트처럼 기록기를 연 뒤에 채운다
  const slot: {
    recordCall?: (event: ToolCallTraceEvent) => void;
    recordContext?: (event: ContextTraceEvent) => void;
  } = {};
  const measurement = startMeasurement({
    dir,
    session: {
      feed: {
        onCommit: (listener) => {
          commitListeners.add(listener);
          return () => {
            commitListeners.delete(listener);
          };
        },
      },
    },
    usage: {
      subscribe: (listener) => {
        usageListeners.add(listener);
        return () => {
          usageListeners.delete(listener);
        };
      },
    },
    trace,
    enabled: () => enabled,
    logger,
    now: () => Date.now(),
    events: createTurnRecordEvents(logger),
    maxTurnBytes: () => DEFAULT_MAX_TURN_BYTES,
    testRunsAlwaysOn: () => true,
  });
  slot.recordCall = measurement.offerCall;
  slot.recordContext = measurement.offerContext;
  const store = measurement.store;
  if (store === undefined) {
    measurement.stop();
    rmSync(dir, { recursive: true, force: true });
    throw new BenchEnvironmentError("turn-record bench: the measure database did not open");
  }
  return {
    enabled,
    commit: (event) => {
      const batch: CommitBatch = { firstSeq: event.seq, lastSeq: event.seq, events: [event] };
      for (const listener of commitListeners) listener(batch);
    },
    context: {
      record: (event) => {
        slot.recordContext?.(event);
      },
    },
    call: {
      record: (event) => {
        slot.recordCall?.(event);
      },
    },
    usage: (record) => {
      for (const listener of usageListeners) listener(record);
    },
    hook: (threadId, turnId, entry) => {
      // 계측이 꺼져 있으면 링 버퍼는 아무것도 쌓지 않는다
      if (!enabled) return;
      const list = traces.get(turnId) ?? [];
      list.push(entry);
      traces.set(turnId, list);
      for (const [handlerIndex] of entry.handlers.entries()) {
        for (const listener of recordListeners) listener({ threadId, turnId, entry, handlerIndex });
      }
    },
    dropTrace: (turnId) => {
      traces.delete(turnId);
    },
    warnings: () => warned,
    readTurn: (threadId, turnId) => {
      const bundle = store.readTurn(threadId, turnId);
      if (!bundle.ok || bundle.value === undefined) return { ok: false };
      return {
        ok: true,
        value: {
          status: bundle.value.turn.status,
          steps: bundle.value.steps.length,
          calls: bundle.value.calls.length,
          hooks: bundle.value.hooks.length,
          materials: bundle.value.materials.length,
        },
      };
    },
    close: () => {
      measurement.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

interface StepTiming {
  readonly contextMs: number;
  readonly usageMs: number;
  readonly callMs: readonly number[];
  readonly commitMs: number;
  readonly deferredMs: number;
}

interface TurnTiming {
  readonly wallMs: number;
  readonly openSyncMs: number;
  readonly openDeferredMs: number;
  readonly closeSyncMs: number;
  readonly closeDeferredMs: number;
  readonly steps: readonly StepTiming[];
}

/** 합성 턴 하나를 한 조건에 넣고 시간을 잰다. 단계마다 싱크 호출, 훅 쌓기(잰 밖), 커밋, 묶음 쓰기 순서다 */
async function runTurn(arm: Arm, turn: SyntheticTurn): Promise<TurnTiming> {
  const wall = performance.now();
  const openSyncMs = timed(() => {
    arm.commit(turn.started);
  });
  const openDeferredMs = await flushed();
  const steps: StepTiming[] = [];
  for (const step of turn.steps) {
    let contextMs = timed(() => {
      arm.context.record(step.context);
    });
    for (const read of step.skillReads) {
      contextMs += timed(() => {
        arm.context.record(read);
      });
    }
    const usageMs = timed(() => {
      arm.usage(step.usage);
    });
    const callMs = step.calls.map((call) =>
      timed(() => {
        arm.call.record(call);
      }),
    );
    // 계측 링 버퍼에 훅 실행이 쌓이는 일은 단계 끝 커밋 전에 끝나 있다(잰 밖)
    for (const entry of step.hooks) arm.hook(turn.started.threadId, turn.turnId, entry);
    const commitMs = timed(() => {
      arm.commit(step.completed);
    });
    // oxlint-disable-next-line no-await-in-loop -- 턴과 단계는 순서대로 잰다 (eng.testing.guide TS-05)
    const deferredMs = await flushed();
    steps.push({ contextMs, usageMs, callMs, commitMs, deferredMs });
  }
  const closeSyncMs = timed(() => {
    arm.commit(turn.completed);
  });
  const closeDeferredMs = await flushed();
  arm.dropTrace(turn.turnId);
  return {
    wallMs: performance.now() - wall,
    openSyncMs,
    openDeferredMs,
    closeSyncMs,
    closeDeferredMs,
    steps,
  };
}

function addTiming(samples: ArmSamples, timing: TurnTiming): void {
  samples.wallMs.push(timing.wallMs);
  samples.openSyncMs.push(timing.openSyncMs);
  samples.closeSyncMs.push(timing.closeSyncMs);
  let turnDeferred = timing.openDeferredMs + timing.closeDeferredMs;
  for (const step of timing.steps) {
    const callSum = sumOf(step.callMs);
    samples.stepSyncMs.push(step.contextMs + step.usageMs + callSum + step.commitMs);
    samples.contextMs.push(step.contextMs);
    samples.usageMs.push(step.usageMs);
    samples.callSumMs.push(callSum);
    samples.callEachMs.push(...step.callMs);
    samples.commitMs.push(step.commitMs);
    samples.stepDeferredMs.push(step.deferredMs);
    turnDeferred += step.deferredMs;
  }
  samples.turnDeferredMs.push(turnDeferred);
}

/** 쓰기 결과가 합성 턴의 모양과 맞는지 본다. 맞지 않으면 측정이 엉뚱한 일을 잰 것이다 */
function sanityOf(
  on: Arm,
  off: Arm,
  threadId: ThreadId,
  turn: SyntheticTurn,
  scenario: Scenario,
): string {
  const written = on.readTurn(threadId, turn.turnId);
  if (!written.ok || written.value === undefined) {
    throw new Error("turn-record bench: the measured turn must be readable with the trace on");
  }
  const rows = written.value;
  const calls = scenario.steps * scenario.callsPerStep;
  const expected = {
    status: "completed",
    steps: scenario.steps,
    calls,
    hooks: scenario.hooksPerTurn,
    materials: scenario.materials,
  };
  if (
    rows.status !== expected.status ||
    rows.steps !== expected.steps ||
    rows.calls !== expected.calls ||
    rows.hooks !== expected.hooks ||
    rows.materials !== expected.materials
  ) {
    throw new Error(
      `turn-record bench: trace-on rows ${JSON.stringify(rows)} differ from the synthetic turn ${JSON.stringify(expected)}`,
    );
  }
  const offRows = off.readTurn(threadId, turn.turnId);
  if (!offRows.ok || offRows.value === undefined || offRows.value.steps !== 0) {
    throw new Error("turn-record bench: the trace-off turn must keep only its turn row");
  }
  return `on: ${String(rows.steps)} steps, ${String(rows.calls)} calls, ${String(rows.hooks)} hooks, ${String(rows.materials)} materials; off: turn row only`;
}

/**
 * 시나리오 하나를 잰다. 계측 켬과 끔을 같은 합성 턴으로 번갈아 돌린다(짝을 맞춰 시간 흐름이 한 조건에 몰리지 않게 한다).
 * 워밍업 턴을 버리고, 목표 턴 수나 마감 시각 가운데 먼저 닿는 쪽에서 멈춘다.
 */
export async function runScenario(scenario: Scenario, options: RunOptions): Promise<ScenarioRun> {
  const arms: Arm[] = [];
  try {
    const on = openArm(true);
    arms.push(on);
    const off = openArm(false);
    arms.push(off);
    const ids = fixedIdFactory();
    const threadId = ids.next("thr");
    const source = { threadId, ids };
    const deadline = performance.now() + options.deadlineMs;
    const onSamples = emptySamples();
    const offSamples = emptySamples();
    const overheadMs: number[] = [];
    let index = 0;
    let measured = 0;
    let last: SyntheticTurn | undefined;
    while (keepGoing(measured, options.iterations, performance.now(), deadline)) {
      const turn = buildTurn(scenario, index, source);
      last = turn;
      const order = index % 2 === 0 ? [on, off] : [off, on];
      const timings = new Map<Arm, TurnTiming>();
      for (const arm of order) {
        // oxlint-disable-next-line no-await-in-loop -- 두 조건은 같은 턴을 번갈아 돈다 (eng.testing.guide TS-05)
        timings.set(arm, await runTurn(arm, turn));
      }
      const onTiming = timings.get(on);
      const offTiming = timings.get(off);
      if (onTiming === undefined || offTiming === undefined) {
        throw new Error("turn-record bench: both arms must time the turn");
      }
      if (index >= WARMUP_TURNS) {
        addTiming(onSamples, onTiming);
        addTiming(offSamples, offTiming);
        overheadMs.push(onTiming.wallMs - offTiming.wallMs);
        measured += 1;
      }
      index += 1;
    }
    if (measured === 0 || last === undefined) {
      throw new Error(
        `turn-record bench: no measured turn fit the deadline for ${String(scenario.steps)} steps`,
      );
    }
    const sanity = sanityOf(on, off, threadId, last, scenario);
    const warnings = on.warnings() + off.warnings();
    if (warnings > 0) {
      throw new Error(
        `turn-record bench: ${String(warnings)} measure warnings were logged; the numbers are not valid`,
      );
    }
    return {
      scenario,
      iterations: measured,
      deadlineHit: measured < options.iterations,
      sanity,
      warnings,
      on: onSamples,
      off: offSamples,
      overheadMs,
    };
  } finally {
    for (const arm of arms) arm.close();
  }
}
