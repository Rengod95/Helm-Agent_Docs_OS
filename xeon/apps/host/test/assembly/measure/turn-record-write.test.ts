import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, parse, type Logger } from "@fresnel/contracts";
import type { StepId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { TraceReadPort, TraceTurnEntry } from "@fresnel/contracts/extensions";
import type { CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import { TurnRecordSchema } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { startMeasurement, type MeasurementDeps } from "../../../src/assembly/measure/recorder.ts";
import { createTestRunMarks } from "../../../src/assembly/measure/test-run-marks.ts";

// T-MEAS-TURN: 턴 기록의 쓰는 쪽. 단계 끝에 단계 행과 훅 행을 쓰고(턴 도중에도 읽힌다), 턴 행은 열 때 `open`, 끝날 때 최종 상태다.
// 계측이 꺼진 턴은 턴 행만 쓴다(log_only). 여는 때 `open`으로 남은 턴은 `lost`가 된다. 테스트 대화의 범위는 재열기 뒤에도 남고,
// 대화를 지우면 `tr_*` 행이 없어진다.

const ids = fixedIdFactory();
const THREAD: ThreadId = ids.next("thr");
const TURN: TurnId = ids.next("trn");
const STEP: StepId = ids.next("stp");
const AT = Date.UTC(2026, 10, 18, 9, 0, 0);

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function event(
  seq: number,
  kind: DurableEventEnvelope["kind"],
  payload: unknown,
  extra: { readonly stepId?: StepId | null; readonly turnId?: TurnId | null } = {},
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId: extra.turnId === undefined ? TURN : extra.turnId,
    stepId: extra.stepId ?? null,
    recordedAt: AT + seq * 10,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

const TURN_STARTED = { inputItemIds: [], requestId: null, scopeId: null, origin: "user" };
const STEP_COMPLETED = (stepIndex: number) => ({
  stepIndex,
  status: "completed",
  stopReason: "stop",
  assistantItemId: null,
  toolResultItemIds: [],
});
const TURN_COMPLETED = { status: "completed", stepCount: 1, usage: null, error: null };

function usage(stepId: StepId): UsageRecord {
  return {
    threadId: THREAD,
    turnId: TURN,
    stepId,
    role: "main",
    scopeId: null,
    provider: "tape",
    modelId: "tape-1",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 100,
      cacheWrite: 20,
      totalTokens: 135,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
    },
    stopReason: "stop",
    aborted: false,
    recordedAt: AT + 15,
    startedAt: AT + 5,
    firstTokenAt: AT + 8,
  };
}

/** 처리기 기록 하나. 같은 디스패치 안에서 `toolCallId`는 디스패치 키 접미에서 온 값이다 */
function handler(
  registrationId: string,
  result: TraceTurnEntry["handlers"][number]["result"],
  toolCallId?: string,
): TraceTurnEntry["handlers"][number] {
  return {
    registrationId,
    ms: 2,
    result,
    atMs: 3,
    size: 0,
    skippedBy: null,
    reason: null,
    ...(toolCallId === undefined ? {} : { toolCallId }),
  };
}

/** 계측 링 버퍼 대역. 테스트가 항목을 넣으면 읽기가 그대로 돌려준다 */
function traceStub(): {
  readonly entries: TraceTurnEntry[];
  readonly port: Pick<TraceReadPort, "turn">;
} {
  const entries: TraceTurnEntry[] = [];
  return {
    entries,
    port: { turn: () => ({ traceEnabled: true, retained: true, entries: [...entries] }) },
  };
}

interface Harness {
  readonly measurement: ReturnType<typeof startMeasurement>;
  readonly commit: (events: readonly DurableEventEnvelope[]) => void;
  readonly meter: (record: UsageRecord) => void;
  readonly stop: () => void;
}

/** 측정을 한 폴더에 연다. 이벤트는 피드 구독자에 직접 흘리고, 모델 호출은 합산기 구독자에 흘린다 */
function openHarness(
  dir: string,
  options: { readonly enabled: boolean; readonly trace?: Pick<TraceReadPort, "turn"> },
): Harness {
  const listeners = new Set<CommitListener>();
  let meterListener: ((record: UsageRecord) => void) | undefined;
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
    usage: {
      subscribe: (listener) => {
        meterListener = listener;
        return () => {
          meterListener = undefined;
        };
      },
    },
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    enabled: () => options.enabled,
    logger,
    now: () => AT,
  };
  const measurement = startMeasurement(deps);
  return {
    measurement,
    commit: (events) => {
      for (const listener of listeners) {
        listener({ firstSeq: 1, lastSeq: events.length, events });
      }
    },
    meter: (record) => {
      meterListener?.(record);
    },
    stop: () => measurement.stop(),
  };
}

/** 쓰기 묶음은 커밋 뒤 마이크로태스크에 쓰인다. 한 번 기다리면 쓰기가 끝난다 */
async function settle(): Promise<void> {
  await Promise.resolve();
}

function storeOf(measurement: ReturnType<typeof startMeasurement>) {
  if (measurement.store === undefined) throw new Bug("the measure database must open in this test");
  return measurement.store;
}

test("a step end writes the step row and its hook rows, and a turn in progress is readable before the turn ends", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    // 단계 끝의 훅은 커밋 전에 버퍼에 들어 있다. 도구 호출 지점의 훅은 호출 id를 가진다
    trace.entries.push(
      {
        seq: 0,
        hook: "tool.call.before",
        step: 1,
        handlers: [handler("ext:a", "blocked", "call_1")],
      },
      { seq: 1, hook: "boundary.step.after", step: 1, handlers: [handler("ext:b", "passed")] },
    );
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    await settle();

    const store = storeOf(harness.measurement);
    const bundle = store.readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined)
      throw new Bug("the turn must be readable mid-turn");
    expect(bundle.value.turn.status).toBe("open");
    expect(bundle.value.turn.level).toBe("full");
    expect(
      bundle.value.steps.map((step) => [step.stepIndex, step.model, step.input, step.output]),
    ).toEqual([[1, "tape-1", 10, 5]]);
    // 훅 행은 호출 id를 가진다. 호출 지점이 아닌 훅은 null이다
    expect(
      bundle.value.hooks.map((row) => [row.registrationId, row.toolCallId, row.result]),
    ).toEqual([
      ["ext:a", "call_1", "blocked"],
      ["ext:b", null, "passed"],
    ]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the record_json of a closed turn is a valid TurnRecord with its step and turn-level fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    trace.entries.push({
      seq: 0,
      hook: "tool.call.before",
      step: 1,
      handlers: [handler("ext:a", "passed", "call_1")],
    });
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const store = storeOf(harness.measurement);
    const bundle = store.readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the closed turn must be readable");
    expect(bundle.value.turn.status).toBe("completed");
    expect(bundle.value.turn.complete).toBe(true);
    const checked = parse(TurnRecordSchema, JSON.parse(bundle.value.turn.recordJson));
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
    expect(checked.value.steps[0]?.hooks[0]?.toolCallId).toBe("call_1");
    expect(checked.value.steps[0]?.modelCalls[0]?.modelId).toBe("tape-1");
    expect(checked.value.profile).toBeNull();
    expect(checked.value.frames).toEqual([]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a turn still open when the process stops is lost after the next open and is not complete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const first = openHarness(dir, { enabled: true });
    first.commit([event(1, "turn.started", TURN_STARTED)]);
    first.meter(usage(STEP));
    first.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    await settle();
    // 턴이 끝나기 전에 멈춘다(프로세스가 죽은 것과 같다)
    first.stop();

    const second = openHarness(dir, { enabled: true });
    const bundle = storeOf(second.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined)
      throw new Bug("the lost turn must still be readable");
    expect(bundle.value.turn.status).toBe("lost");
    expect(bundle.value.turn.complete).toBe(false);
    // 단계 행은 남는다. 잃은 것은 마지막 턴 요약뿐이다
    expect(bundle.value.steps.map((step) => step.stepIndex)).toEqual([1]);
    second.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with the trace off the turn is written as log_only with no step or hook row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: false, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    trace.entries.push({
      seq: 0,
      hook: "tool.call.before",
      step: 1,
      handlers: [handler("ext:a", "passed", "call_1")],
    });
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined)
      throw new Bug("the log_only turn must be written");
    expect(bundle.value.turn.level).toBe("log_only");
    expect(bundle.value.turn.complete).toBe(false);
    expect(bundle.value.steps).toEqual([]);
    expect(bundle.value.hooks).toEqual([]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a test run thread keeps its test scope after a restart and while the trace is off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const first = openHarness(dir, { enabled: false });
    const marks = createTestRunMarks({
      store: () => first.measurement.store,
      clock: { now: () => AT },
      logger,
    });
    // 계측이 꺼져 있어도 표지는 쓴다
    expect(marks.remember(THREAD, "profile-a")).toBe(true);
    first.commit([event(1, "turn.started", TURN_STARTED)]);
    first.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();
    expect(storeOf(first.measurement).readTurn(THREAD, TURN)).toMatchObject({
      ok: true,
      value: { turn: { scopeKind: "test", level: "log_only" } },
    });
    first.stop();

    // 재시작: 메모리 표지는 없고 저장된 표지만 남는다
    const second = openHarness(dir, { enabled: true });
    const restored = createTestRunMarks({
      store: () => second.measurement.store,
      clock: { now: () => AT },
      logger,
    }).recall(THREAD);
    expect(restored?.scopeKind).toBe("test");
    expect(restored?.testBaseProfile).toBe("profile-a");
    // 재시작 뒤의 턴도 같은 범위를 받는다
    const nextTurn = ids.next("trn");
    second.commit([event(3, "turn.started", TURN_STARTED, { turnId: nextTurn })]);
    second.commit([event(4, "turn.completed", TURN_COMPLETED, { turnId: nextTurn })]);
    await settle();
    expect(storeOf(second.measurement).readTurn(THREAD, nextTurn)).toMatchObject({
      ok: true,
      value: { turn: { scopeKind: "test", level: "full" } },
    });
    second.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a live thread is not restored as a test run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    expect(bundle).toMatchObject({ ok: true, value: { turn: { scopeKind: "live" } } });
    const marks = createTestRunMarks({
      store: () => harness.measurement.store,
      clock: { now: () => AT },
      logger,
    });
    expect(marks.recall(THREAD)).toBeUndefined();
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting a thread removes its turn rows and its test marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    createTestRunMarks({
      store: () => harness.measurement.store,
      clock: { now: () => AT },
      logger,
    }).remember(THREAD, null);
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    trace.entries.push({
      seq: 0,
      hook: "tool.call.before",
      step: 1,
      handlers: [handler("ext:a", "passed", "call_1")],
    });
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    await settle();

    harness.measurement.forgetThread(THREAD);
    const store = storeOf(harness.measurement);
    expect(store.readTurn(THREAD, TURN)).toMatchObject({ ok: true, value: undefined });
    expect(store.getThread(THREAD)).toMatchObject({ ok: true, value: undefined });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
