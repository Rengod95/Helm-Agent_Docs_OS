import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { Bug, ok, type Logger } from "@fresnel/contracts";
import type { CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { StepId, TurnId } from "@fresnel/contracts/conversation";
import type { ToolCallTraceEvent } from "@fresnel/contracts/extensions";
import { startMeasurement, type MeasurementDeps } from "../../../src/assembly/measure/recorder.ts";
import type { MeasureStore } from "../../../src/assembly/measure/store.ts";
import { DEFAULT_MAX_TURN_BYTES } from "../../../src/assembly/measure/turn-fit.ts";
import {
  createTurnRecordPort,
  type TurnRecordReadPort,
} from "../../../src/assembly/measure/turn-read.ts";
import {
  createBacktestService,
  type BacktestPort,
} from "../../../src/assembly/backtest/service.ts";
import { assistantEvent, AT, fakeRunner, ids, payloadIdOf } from "./fixtures.ts";

// 돌려 보기의 기록이 일반 지표에 섞이지 않는다(§9 수용 기준 21~23과 "돌려 보기의 기록이 일반 지표에 섞이지 않는다").
// 실제 측정 저장소에 턴을 기록하고, 지표 전체와 `tr_*` 행 수를 찍은 뒤 돌려 보기를 돌리고 다시 찍는다. 쓰기 호출은 한 번도 없어야 한다.

const DAY = 86_400_000;
const THREAD = ids.next("thr");
const TURN_A = ids.next("trn");
const TURN_B = ids.next("trn");
const STEP_A = ids.next("stp");
const STEP_B = ids.next("stp");
const DEFAULT_SETTINGS = {
  maxTurns: 50,
  maxCalls: 2000,
  callTimeoutMs: 5000,
  totalTimeoutMs: 120000,
};

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function eventOf(
  seq: number,
  kind: DurableEventEnvelope["kind"],
  payload: unknown,
  turnId: DurableEventEnvelope["turnId"],
  stepId: DurableEventEnvelope["stepId"],
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId,
    stepId,
    recordedAt: AT + seq * 10,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

function callOfTrace(turnId: TurnId, stepId: StepId, toolCallId: string): ToolCallTraceEvent {
  return {
    threadId: THREAD,
    turnId,
    stepId,
    toolCallId,
    parentToolCallId: null,
    tool: "read",
    plugin: "workspace.files",
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "read",
    capability: { id: "workspace.files", method: "read" },
    argsHash: "ab".repeat(32),
    argTokenCount: 2,
    argTokens: ["notes", "todo"],
    targetHash: `t-${toolCallId}`,
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    policy: null,
    approval: null,
    exec: { startedAt: AT + 100, durationMs: 4, status: "ok", effectId: null },
    result: { tokens: 3, bytes: 12, truncated: false, isError: false, itemId: null },
    closedAt: AT + 104,
  };
}

/** 측정을 한 폴더에 연다. 턴 사건은 기록기 구독자에 직접 흘린다 */
function openRecorder(dir: string) {
  const listeners = new Set<CommitListener>();
  const deps: MeasurementDeps = {
    dir,
    session: {
      feed: {
        onCommit: (listener: CommitListener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    },
    usage: { subscribe: () => () => undefined },
    enabled: () => true,
    logger,
    now: () => AT,
    testRunsAlwaysOn: () => true,
    maxTurnBytes: () => DEFAULT_MAX_TURN_BYTES,
  };
  const measurement = startMeasurement(deps);
  return {
    measurement,
    commit: (events: readonly DurableEventEnvelope[]) => {
      for (const listener of listeners) listener({ firstSeq: 1, lastSeq: events.length, events });
    },
  };
}

/** 쓰기 묶음은 커밋 뒤 마이크로태스크에 쓰인다 */
async function settle(): Promise<void> {
  await Promise.resolve();
}

function countingStore(store: MeasureStore): {
  readonly store: MeasureStore;
  readonly writes: string[];
} {
  const writes: string[] = [];
  const wrapped: MeasureStore = {
    ...store,
    writeBatch: (...args) => {
      writes.push("writeBatch");
      return store.writeBatch(...args);
    },
    batch: (...args) => {
      writes.push("batch");
      return store.batch(...args);
    },
    upsertThread: (...args) => {
      writes.push("upsertThread");
      return store.upsertThread(...args);
    },
    writeStep: (...args) => {
      writes.push("writeStep");
      return store.writeStep(...args);
    },
    writeHooks: (...args) => {
      writes.push("writeHooks");
      return store.writeHooks(...args);
    },
    upsertTurn: (...args) => {
      writes.push("upsertTurn");
      return store.upsertTurn(...args);
    },
    writeFrames: (...args) => {
      writes.push("writeFrames");
      return store.writeFrames(...args);
    },
    writePluginCalls: (...args) => {
      writes.push("writePluginCalls");
      return store.writePluginCalls(...args);
    },
    forgetThread: (...args) => {
      writes.push("forgetThread");
      return store.forgetThread(...args);
    },
    putMark: (...args) => {
      writes.push("putMark");
      return store.putMark(...args);
    },
    upsertFindingState: (...args) => {
      writes.push("upsertFindingState");
      return store.upsertFindingState(...args);
    },
    markLostTurns: (...args) => {
      writes.push("markLostTurns");
      return store.markLostTurns(...args);
    },
    prune: (...args) => {
      writes.push("prune");
      return store.prune(...args);
    },
    markRecordingSince: (...args) => {
      writes.push("markRecordingSince");
      return store.markRecordingSince(...args);
    },
  };
  return { store: wrapped, writes };
}

function turnPortOf(store: MeasureStore): TurnRecordReadPort {
  return createTurnRecordPort({
    store: () => store,
    enabled: () => true,
    retentionDays: () => 30,
    logTurnStartedAt: () => ok(undefined),
    events: { subscribe: () => () => undefined },
    now: () => AT + 1000,
    metrics: () => ({
      minSample: 1,
      defaultWindowDays: 30,
      findingsEnabled: false,
      findingOverrides: {},
    }),
  });
}

/** 지표 전체의 값과 `tr_*` 행 수. 같은 파일을 따로 열어 본다 */
function snapshotOf(
  dir: string,
  port: TurnRecordReadPort,
): {
  readonly values: ReturnType<TurnRecordReadPort["metrics"]>;
  readonly rows: Readonly<Record<string, number>>;
} {
  const metricIds = port.catalog().map((metric) => metric.id);
  const values = port.metrics({
    metrics: metricIds,
    filter: { period: { from: AT - DAY, to: AT + DAY } },
    groupBy: [],
    compare: null,
  });
  const db = new Database(join(dir, "measure.db"), { readonly: true });
  try {
    const rowsOf = (table: string): number => {
      const row = db.query<{ readonly n: number }, []>(`select count(*) as n from ${table}`).get();
      if (row === null) throw new Bug(`the table ${table} must count`);
      return row.n;
    };
    return {
      values,
      rows: {
        tr_turn: rowsOf("tr_turn"),
        tr_step: rowsOf("tr_step"),
        tr_call: rowsOf("tr_call"),
        tr_hook: rowsOf("tr_hook"),
      },
    };
  } finally {
    db.close();
  }
}

test("a backtest run over recorded turns changes no metric value and no row of the turn record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "backtest-mix-"));
  try {
    const recorder = openRecorder(dir);
    // 두 턴을 실제 기록기로 쓴다. 호출은 열린 턴에 들어간다. 턴 A는 호출 둘, 턴 B는 호출 하나다
    const turnStarted = (seq: number, turn: TurnId) =>
      eventOf(
        seq,
        "turn.started",
        { inputItemIds: [], requestId: null, scopeId: null, origin: "user" },
        turn,
        null,
      );
    const stepDone = (seq: number, turn: TurnId, step: StepId) =>
      eventOf(
        seq,
        "step.completed",
        {
          stepIndex: 0,
          status: "completed",
          stopReason: "stop",
          assistantItemId: null,
          toolResultItemIds: [],
        },
        turn,
        step,
      );
    const turnDone = (seq: number, turn: TurnId) =>
      eventOf(
        seq,
        "turn.completed",
        { status: "completed", stepCount: 1, usage: null, error: null },
        turn,
        null,
      );
    recorder.commit([turnStarted(1, TURN_A)]);
    recorder.measurement.offerCall(callOfTrace(TURN_A, STEP_A, "c-ok"));
    recorder.measurement.offerCall(callOfTrace(TURN_A, STEP_A, "c-block"));
    recorder.commit([stepDone(2, TURN_A, STEP_A), turnDone(3, TURN_A)]);
    recorder.commit([turnStarted(4, TURN_B)]);
    recorder.measurement.offerCall(callOfTrace(TURN_B, STEP_B, "c-late"));
    recorder.commit([stepDone(5, TURN_B, STEP_B), turnDone(6, TURN_B)]);
    await settle();
    const measured = recorder.measurement.store;
    if (measured === undefined) throw new Bug("the measure store must open in this test");
    const counted = countingStore(measured);
    const port = turnPortOf(counted.store);
    const before = snapshotOf(dir, port);
    // 시험이 빈 기록을 보지 않도록 행 수를 먼저 확인한다
    expect(before.rows).toEqual({ tr_turn: 2, tr_step: 2, tr_call: 3, tr_hook: 0 });
    expect(counted.writes).toEqual([]);

    const runner = fakeRunner({
      script: (call) => {
        return payloadIdOf(call) === "c-block"
          ? { kind: "returned", value: { block: true, reason: "no" }, ms: 1 }
          : { kind: "returned", value: null, ms: 1 };
      },
    });
    const logs = [
      assistantEvent(THREAD, 1, [
        { id: "c-ok", name: "read", args: { path: "notes" } },
        { id: "c-block", name: "read", args: { path: "todo" } },
        { id: "c-late", name: "read", args: { path: "later" } },
      ]),
    ];
    const service: BacktestPort = createBacktestService({
      scope: { turns: port, threadIds: () => [THREAD] },
      threadExists: () => true,
      readItemEvents: () => Promise.resolve(ok(logs)),
      resolveCandidate: () =>
        Promise.resolve(
          ok({
            name: "cand",
            versionId: `sha256:${"c".repeat(64)}`,
            root: "/r",
            manifest: {},
            entry: "./x.ts",
          }),
        ),
      isolation: () => ({ available: true, createRunner: () => runner }),
      settings: () => DEFAULT_SETTINGS,
      now: () => AT + 1000,
      newRunId: () => "bt_mix",
    });
    const started = await service.run({
      candidate: { pluginId: "cand", versionId: `sha256:${"c".repeat(64)}` },
      hook: "tool.call.before",
      scope: {},
    });
    if (!started.ok) throw new Bug("the run must start in this test");
    await service.whenDone(started.value.runId);

    const read = service.result(started.value.runId);
    if (!read.ok) throw new Bug("the result must read in this test");
    expect(read.value.items.map((item) => item.class)).toEqual([
      "passes_same",
      "newly_caught",
      "passes_same",
    ]);
    // 돌려 보기는 기록 쪽에 아무것도 쓰지 않는다
    expect(counted.writes).toEqual([]);
    expect(snapshotOf(dir, port)).toEqual(before);
    recorder.measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
