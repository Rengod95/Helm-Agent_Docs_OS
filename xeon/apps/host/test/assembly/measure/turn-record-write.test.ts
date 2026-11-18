import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, ok, parse, parseJson, type Logger, type LogFields } from "@fresnel/contracts";
import type { StepId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  PluginCallTraceEvent,
  PluginSetPort,
  ToolCallTraceEvent,
  TraceReadPort,
  TraceTurnEntry,
} from "@fresnel/contracts/extensions";
import type { CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import { TurnRecordSchema, type FrameMark } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { startMeasurement, type MeasurementDeps } from "../../../src/assembly/measure/recorder.ts";
import type { MeasureStore } from "../../../src/assembly/measure/store.ts";
import {
  createTurnRecordEvents,
  type TurnRecordEvent,
  type TurnRecordEvents,
} from "../../../src/assembly/measure/turn-events.ts";
import { DEFAULT_MAX_TURN_BYTES } from "../../../src/assembly/measure/turn-fit.ts";
import { createTestRunMarks } from "../../../src/assembly/measure/test-run-marks.ts";
import { createTurnRecordPort } from "../../../src/assembly/measure/turn-read.ts";

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
  extra: {
    readonly stepId?: StepId | null;
    readonly turnId?: TurnId | null;
    readonly threadId?: ThreadId;
  } = {},
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: extra.threadId ?? THREAD,
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
  /** 도구 호출 추적 줄(싱크가 넘기는 값)을 턴 기록에 넘긴다 */
  readonly call: (event: ToolCallTraceEvent) => void;
  /** 가벼운 길의 플러그인 호출 줄(싱크가 넘기는 값)을 턴 기록에 넘긴다 */
  readonly pluginCall: (event: PluginCallTraceEvent) => void;
  readonly stop: () => void;
}

/** 측정을 한 폴더에 연다. 이벤트는 피드 구독자에 직접 흘리고, 모델 호출은 합산기 구독자에 흘린다 */
function openHarness(
  dir: string,
  options: {
    readonly enabled: boolean;
    readonly trace?: Pick<TraceReadPort, "turn">;
    readonly events?: Pick<TurnRecordEvents, "emit">;
    readonly testRunsAlwaysOn?: boolean;
    readonly maxTurnBytes?: number;
    readonly pluginSet?: Pick<PluginSetPort, "resolve">;
    readonly logger?: Logger;
  },
): Harness {
  const listeners = new Set<CommitListener>();
  let meterListener: ((record: UsageRecord) => void) | undefined;
  const pluginSet = options.pluginSet;
  const deps: MeasurementDeps = {
    ...(pluginSet === undefined ? {} : { pluginSet: () => pluginSet }),
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
    logger: options.logger ?? logger,
    now: () => AT,
    ...(options.events === undefined ? {} : { events: options.events }),
    testRunsAlwaysOn: () => options.testRunsAlwaysOn ?? true,
    maxTurnBytes: () => options.maxTurnBytes ?? DEFAULT_MAX_TURN_BYTES,
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
    call: (event) => {
      measurement.offerCall(event);
    },
    pluginCall: (event) => {
      measurement.offerPluginCall(event);
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
    // 프로필 사건이 없고 저장한 id도 없으면 기본 프로필이 개정 0으로 쓰인 것이다(§4.10 규칙 60~62)
    expect(checked.value.profile).toEqual({
      id: "default",
      rev: 0,
      source: "builtin",
      inherited: false,
    });
    expect(checked.value.profileRevChanges).toEqual([]);
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
    // 항상 켜기(`testRunsAlwaysOn`, 기본 참)라서 계측이 꺼져도 테스트 실행 턴은 full이다(§4.1 규칙 4)
    expect(storeOf(first.measurement).readTurn(THREAD, TURN)).toMatchObject({
      ok: true,
      value: { turn: { scopeKind: "test", level: "full" } },
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

// M5c §4.8.9, 규칙 36: 테스트 대화(craftChat)의 턴은 `scope_kind = craft`로 적힌다. 표지는 저장소에 있어 재시작 뒤에도 남는다
test("a craft thread keeps the craft scope after a restart, and an ordinary thread next to it stays live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const CRAFT_THREAD: ThreadId = ids.next("thr");
  const CRAFT_TURN: TurnId = ids.next("trn");
  try {
    const first = openHarness(dir, { enabled: true });
    createTestRunMarks({
      store: () => first.measurement.store,
      clock: { now: () => AT },
      logger,
    }).remember(CRAFT_THREAD, null, "craft");
    first.commit([
      event(1, "turn.started", TURN_STARTED, { threadId: CRAFT_THREAD, turnId: CRAFT_TURN }),
    ]);
    first.commit([
      event(2, "turn.completed", TURN_COMPLETED, { threadId: CRAFT_THREAD, turnId: CRAFT_TURN }),
    ]);
    first.commit([event(3, "turn.started", TURN_STARTED)]);
    first.commit([event(4, "turn.completed", TURN_COMPLETED)]);
    await settle();
    expect(storeOf(first.measurement).readTurn(CRAFT_THREAD, CRAFT_TURN)).toMatchObject({
      ok: true,
      value: { turn: { scopeKind: "craft" } },
    });
    expect(storeOf(first.measurement).readTurn(THREAD, TURN)).toMatchObject({
      ok: true,
      value: { turn: { scopeKind: "live" } },
    });
    first.stop();

    // 재시작 뒤에도 같은 범위다. 표지는 메모리가 아니라 저장소에서 읽힌다
    const second = openHarness(dir, { enabled: true });
    const nextTurn = ids.next("trn");
    second.commit([
      event(5, "turn.started", TURN_STARTED, { threadId: CRAFT_THREAD, turnId: nextTurn }),
    ]);
    second.commit([
      event(6, "turn.completed", TURN_COMPLETED, { threadId: CRAFT_THREAD, turnId: nextTurn }),
    ]);
    await settle();
    expect(storeOf(second.measurement).readTurn(CRAFT_THREAD, nextTurn)).toMatchObject({
      ok: true,
      value: { turn: { scopeKind: "craft" } },
    });
    // 테스트 대화 표지는 테스트 실행 표지로 되살아나지 않는다
    expect(
      createTestRunMarks({
        store: () => second.measurement.store,
        clock: { now: () => AT },
        logger,
      }).recall(CRAFT_THREAD),
    ).toBeUndefined();
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

/** 도구 호출 추적 줄 하나. 값은 시험마다 덮어쓴다(기본은 성공한 읽기 호출) */
function callEvent(
  toolCallId: string,
  overrides: Partial<ToolCallTraceEvent> = {},
): ToolCallTraceEvent {
  return {
    threadId: THREAD,
    turnId: TURN,
    stepId: STEP,
    toolCallId,
    parentToolCallId: null,
    tool: "read",
    plugin: "workspace.files",
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "read",
    capability: { id: "workspace.files", method: "read" },
    argsHash: createHmac("sha256", "args").update(toolCallId).digest("hex"),
    argTokenCount: 6,
    argTokens: [],
    targetHash: null,
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    policy: null,
    approval: null,
    exec: { startedAt: AT + 100, durationMs: 4, status: "ok", effectId: "efx_1" },
    result: { tokens: 3, bytes: 12, truncated: false, isError: false, itemId: "itm_1" },
    closedAt: AT + 104,
    ...overrides,
  };
}

/** 설치 소금은 저장소에서 읽는다. 기대 값은 시험이 따로 HMAC으로 계산해 구현과 대조한다 */
function saltOf(measurement: ReturnType<typeof startMeasurement>): string {
  const salt = storeOf(measurement).installSalt();
  if (!salt.ok) throw new Bug("the install salt must be readable in this test");
  return salt.value;
}

function keyedOf(salt: string, text: string): string {
  return createHmac("sha256", salt).update(text).digest("hex").slice(0, 16);
}

test("a closed step writes its tool call rows with keyed hashes and links each call to the hooks bound to its own id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    trace.entries.push({
      seq: 0,
      hook: "tool.call.before",
      step: 1,
      handlers: [handler("ext:a", "blocked", "call_1")],
    });
    harness.call(
      callEvent("call_1", {
        tool: "bash",
        plugin: "workspace.shell",
        risk: "exec",
        capability: { id: "workspace.shell", method: "run" },
        verdict: "blocked_hook",
        blockedBy: { plugin: "ext", hook: "tool.call.before", registrationId: "ext:a" },
        exec: null,
        result: { tokens: 2, bytes: 8, truncated: false, isError: true, itemId: "itm_b" },
        targetHash: null,
      }),
    );
    harness.call(
      callEvent("call_2", {
        targetHash: createHmac("sha256", "target").update("src/a.ts").digest("hex"),
        policy: { effect: "ask", tier: "default" },
        approval: {
          approvalId: "apr_1",
          decision: "allow",
          resolvedBy: "user",
          waitMs: 25,
          inheritedFrom: null,
        },
      }),
    );
    harness.call(
      callEvent("call_3", {
        tool: "no_such_tool",
        plugin: null,
        risk: null,
        capability: null,
        verdict: "unavailable",
        exec: null,
        result: null,
      }),
    );
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const salt = saltOf(harness.measurement);
    const store = storeOf(harness.measurement);
    const bundle = store.readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
    const rowOf = (toolCallId: string) =>
      bundle.value?.calls.find((row) => row.toolCallId === toolCallId);
    expect(bundle.value.calls).toHaveLength(3);
    expect(rowOf("call_1")).toEqual({
      threadId: THREAD,
      turnId: TURN,
      toolCallId: "call_1",
      stepIndex: 1,
      tool: "bash",
      plugin: "workspace.shell",
      caller: "main",
      callerPlugin: null,
      via: null,
      inheritedFrom: null,
      verdict: "blocked_hook",
      blockedPlugin: "ext",
      blockedHook: "tool.call.before",
      callKey: keyedOf(salt, createHmac("sha256", "args").update("call_1").digest("hex")),
      targetKey: null,
      execMs: null,
      execStatus: null,
      resultTokens: 2,
      resultTruncated: false,
      resultItemId: "itm_b",
      metaJson: JSON.stringify({
        risk: "exec",
        riskKnown: true,
        capability: { id: "workspace.shell", method: "run" },
        afterUntrusted: false,
        parentToolCallId: null,
        argTokenCount: 6,
        argTokens: [],
        registrationId: "ext:a",
      }),
    });
    const second = rowOf("call_2");
    expect(second?.inheritedFrom).toBeNull();
    expect(second?.execMs).toBe(4);
    expect(second?.targetKey).toBe(
      keyedOf(salt, createHmac("sha256", "target").update("src/a.ts").digest("hex")),
    );
    // 알 수 없는 도구는 소유자와 위험 등급이 없다. 행은 자리 값을 쓰고 meta_json이 그 사실을 남긴다
    expect(rowOf("call_3")).toMatchObject({
      plugin: "none",
      verdict: "unavailable",
      execMs: null,
      resultItemId: null,
    });
    expect(JSON.parse(rowOf("call_3")?.metaJson ?? "null")).toMatchObject({
      risk: "exec",
      riskKnown: false,
    });

    const turn = bundle.value.turn;
    const checked = parse(TurnRecordSchema, JSON.parse(turn.recordJson));
    if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
    const calls = checked.value.steps[0]?.calls ?? [];
    expect(calls.map((call) => call.toolCallId)).toEqual(["call_1", "call_2", "call_3"]);
    expect(calls[0]?.hooks.map((run) => [run.registrationId, run.toolCallId, run.result])).toEqual([
      ["ext:a", "call_1", "blocked"],
    ]);
    expect(calls[1]?.hooks).toEqual([]);
    expect(calls[1]?.approval).toEqual({
      approvalId: "apr_1",
      decision: "allow",
      resolvedBy: "user",
      waitMs: 25,
      inheritedFrom: null,
    });
    // 호출 시작은 턴 시작(AT + 10) 기준 상대 ms다: AT + 100 - (AT + 10)
    expect(calls[1]?.exec).toEqual({
      startedAtMs: 90,
      durationMs: 4,
      status: "ok",
      effectId: "efx_1",
    });
    expect(calls[2]).toMatchObject({ plugin: "none", risk: "exec", capability: null });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("calls of a turn with the trace off are not written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: false });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.call(callEvent("call_off"));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
    expect(bundle.value.turn.level).toBe("log_only");
    expect(bundle.value.calls).toEqual([]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a turn keeps at most 500 call rows and counts the rest in elided.calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    for (let index = 0; index < 501; index += 1) {
      harness.call(callEvent(`cap_${String(index).padStart(3, "0")}`));
    }
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
    expect(bundle.value.calls).toHaveLength(500);
    const checked = parse(TurnRecordSchema, JSON.parse(bundle.value.turn.recordJson));
    if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
    expect(checked.value.elided).toEqual({ calls: 1 });
    expect(checked.value.steps[0]?.calls).toHaveLength(500);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hook that finishes after its step's step.completed is written once, with its own step and the late marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    trace.entries.push(
      {
        seq: 0,
        hook: "tool.call.before",
        step: 1,
        handlers: [handler("ext:a", "passed", "call_1")],
      },
      { seq: 1, hook: "boundary.step.after", step: 1, handlers: [handler("ext:b", "passed")] },
    );
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    await settle();
    // 단계 끝 뒤에 끝난 처리기는 같은 항목에 더해진다. 이미 쓴 두 행은 그대로다
    trace.entries.splice(1, 1, {
      seq: 1,
      hook: "boundary.step.after",
      step: 1,
      handlers: [handler("ext:b", "passed"), handler("ext:late", "modified")],
    });
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the closed turn must be readable");
    // 늦은 행은 실행이 시작된 단계(1)에 한 번 쓴다. 번호는 턴의 실행 수(3) 뒤에서 잇는다
    expect(
      bundle.value.hooks.map((row) => [
        row.stepIndex,
        row.registrationId,
        row.seqGlobal,
        row.subjectJson,
      ]),
    ).toEqual([
      [1, "ext:a", 0, '{"toolCallId":"call_1"}'],
      [1, "ext:b", 1, "{}"],
      [1, "ext:late", 3, '{"late":true}'],
    ]);
    // 기록에서도 같은 단계에 늦은 행이 한 번 더해진다
    const checked = parse(TurnRecordSchema, JSON.parse(bundle.value.turn.recordJson));
    if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
    expect(checked.value.steps[0]?.hooks.map((hook) => [hook.registrationId, hook.late])).toEqual([
      ["ext:a", undefined],
      ["ext:b", undefined],
      ["ext:late", true],
    ]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks outside any step land in turnHooks and get no tr_hook row, and step hooks stay with their step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    // 턴 시작 훅과 컨텍스트 조립 앞의 첫 훅은 step 0이다. 단계의 도구 호출 훅은 step 1이다
    trace.entries.push(
      {
        seq: 0,
        hook: "boundary.turn.before",
        step: 0,
        handlers: [handler("ext:open", "passed")],
      },
      { seq: 1, hook: "input.agent.before", step: 0, handlers: [handler("ext:ctx", "modified")] },
      {
        seq: 2,
        hook: "tool.call.before",
        step: 1,
        handlers: [handler("ext:a", "passed", "call_1")],
      },
    );
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the closed turn must be readable");
    expect(bundle.value.hooks.map((row) => [row.stepIndex, row.registrationId])).toEqual([
      [1, "ext:a"],
    ]);
    const checked = parse(TurnRecordSchema, JSON.parse(bundle.value.turn.recordJson));
    if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
    expect(
      checked.value.turnHooks.map((hook) => [hook.hook, hook.registrationId, hook.seq]),
    ).toEqual([
      ["boundary.turn.before", "ext:open", 0],
      ["input.agent.before", "ext:ctx", 1],
    ]);
    expect(checked.value.steps[0]?.hooks.map((hook) => hook.registrationId)).toEqual(["ext:a"]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a decision ask takes its wait, approval id and answer from the call's approval; an awaitUser ask keeps its own waits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    trace.entries.push({
      seq: 0,
      hook: "tool.call.before",
      step: 1,
      handlers: [
        {
          ...handler("ext:asker", "passed", "call_2"),
          decision: "ask",
          ask: { via: "decision", waits: 0, waitMs: 0, approvalId: null, answer: null },
        },
        {
          ...handler("ext:waiter", "passed", "call_2"),
          ask: { via: "awaitUser", waits: 2, waitMs: 90, approvalId: null, answer: null },
        },
      ],
    });
    harness.call(
      callEvent("call_2", {
        approval: {
          approvalId: "apr_1",
          decision: "allow",
          resolvedBy: "user",
          waitMs: 420,
          inheritedFrom: null,
        },
      }),
    );
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the closed turn must be readable");
    expect(
      bundle.value.hooks.map((row) => [
        row.registrationId,
        row.decision,
        row.askVia,
        row.askWaits,
        row.askMs,
        row.askAnswer,
        row.subjectJson,
      ]),
    ).toEqual([
      [
        "ext:asker",
        "ask",
        "decision",
        0,
        420,
        "allow",
        '{"toolCallId":"call_2","approvalId":"apr_1"}',
      ],
      ["ext:waiter", "none", "awaitUser", 2, 90, null, '{"toolCallId":"call_2"}'],
    ]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a subscriber hears the step rows, then the turn row with final true, from the real writer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  const events = createTurnRecordEvents(logger);
  const heard: TurnRecordEvent[] = [];
  events.subscribe((event) => {
    heard.push(event);
  });
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port, events });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();
    expect(
      heard.map((item) =>
        item.kind === "rows"
          ? [item.stepIndex, item.final, item.rows.map((row) => row.kind)]
          : item.kind,
      ),
    ).toEqual([
      [1, false, ["step"]],
      [null, true, ["turn"]],
    ]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 계측이 꺼진 테스트 실행 턴 하나를 쓰고 그 수준을 돌려준다 */
async function testRunLevelWith(alwaysOn: boolean): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: false, testRunsAlwaysOn: alwaysOn });
    const marks = createTestRunMarks({
      store: () => harness.measurement.store,
      clock: { now: () => AT },
      logger,
    });
    expect(marks.remember(THREAD, "profile-a")).toBe(true);
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    harness.stop();
    return bundle.ok ? bundle.value?.turn.level : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a test run turn is full with the trace off while test runs are always on, and log_only when that is off", async () => {
  expect(await Promise.all([testRunLevelWith(true), testRunLevelWith(false)])).toEqual([
    "full",
    "log_only",
  ]);
});

test("an over-cap turn keeps its step rows, stores a summary record, and is not complete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port, maxTurnBytes: 1 });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const bundle = storeOf(harness.measurement).readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined)
      throw new Bug("the over-cap turn must be written");
    expect(bundle.value.turn.complete).toBe(false);
    expect(bundle.value.steps.length).toBe(1);
    const json = parseJson(bundle.value.turn.recordJson);
    if (!json.ok) throw new Bug("the stored record must be JSON");
    const record = parse(TurnRecordSchema, json.value);
    if (!record.ok) throw new Bug("the stored record must parse");
    expect(record.value.steps).toEqual([]);
    expect(record.value.complete).toBe(false);
    expect(record.value.elided.hooks).toBe(undefined);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 프로필 표지(정본 `review/m5/turn-record-metrics.md` §4.10 규칙 60~63). 사건은 실제 커밋 순서를 따른다:
// 대화 시작과 적용은 턴 밖, 단계 경계의 `profile.applied`는 그 단계의 `step.completed`와 같은 커밋에 든다.

const PARENT: ThreadId = ids.next("thr");
const TURN_2: TurnId = ids.next("trn");

function threadStarted(profileId: string | null) {
  return profileId === null
    ? { title: null, forkedFrom: null }
    : { title: null, forkedFrom: null, profileId };
}

function profileApplied(reason: string, profileId: string, profileRev: number) {
  return { reason, profileId, profileRev, commonRev: 0, added: [], removed: [], overlay: [] };
}

function agentSpawned(child: ThreadId) {
  return {
    childThreadId: child,
    agent: "explorer",
    requestId: "req_child_1",
    owner: { kind: "scope", scopeId: "helm" },
    caller: "subagent:explorer",
    depth: 1,
    background: false,
    fork: null,
    modelRole: "subagent",
  };
}

function turnBundle(harness: Harness, turnId: TurnId = TURN) {
  const bundle = storeOf(harness.measurement).readTurn(THREAD, turnId);
  if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
  return bundle.value;
}

function recordOf(json: string) {
  const checked = parse(TurnRecordSchema, JSON.parse(json));
  if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
  return checked.value;
}

test("a turn with no profile event and no stored id reads the builtin default at rev 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect([turn.profileId, turn.profileRev, turn.profileRevChangesJson]).toEqual([
      "default",
      0,
      null,
    ]);
    const record = recordOf(turn.recordJson);
    expect(record.profile).toEqual({ id: "default", rev: 0, source: "builtin", inherited: false });
    expect(record.profileRevChanges).toEqual([]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a turn of a thread the recorder has not seen reads the profile the port gives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, {
      enabled: true,
      pluginSet: {
        resolve: () => ({ plugins: [], profileId: "work", profileRev: 5, commonRev: 1 }),
      },
    });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect([turn.profileId, turn.profileRev]).toEqual(["work", 5]);
    expect(recordOf(turn.recordJson).profile).toEqual({
      id: "work",
      rev: 5,
      source: "thread",
      inherited: false,
    });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stored profile id and the profile applied before the turn give its profile, and a switch shows in the next turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "thread.started", threadStarted("work"), { turnId: null })]);
    harness.commit([
      event(2, "profile.applied", profileApplied("open", "work", 2), { turnId: null }),
    ]);
    harness.commit([event(3, "turn.started", TURN_STARTED)]);
    harness.commit([event(4, "turn.completed", TURN_COMPLETED)]);
    // 대화의 프로필을 바꾸면 다음 경계에서 적용되고, 그 뒤의 턴은 바뀐 프로필을 쓴다
    harness.commit([event(5, "thread.updated", { profileId: "other" }, { turnId: null })]);
    harness.commit([
      event(6, "profile.applied", profileApplied("switched", "other", 1), { turnId: null }),
    ]);
    harness.commit([event(7, "turn.started", TURN_STARTED, { turnId: TURN_2 })]);
    harness.commit([event(8, "turn.completed", TURN_COMPLETED, { turnId: TURN_2 })]);
    await settle();

    const first = turnBundle(harness);
    expect([first.turn.profileId, first.turn.profileRev]).toEqual(["work", 2]);
    expect(recordOf(first.turn.recordJson).profile).toEqual({
      id: "work",
      rev: 2,
      source: "thread",
      inherited: false,
    });
    const second = turnBundle(harness, TURN_2);
    expect([second.turn.profileId, second.turn.profileRev]).toEqual(["other", 1]);
    expect(recordOf(second.turn.recordJson).profile).toEqual({
      id: "other",
      rev: 1,
      source: "thread",
      inherited: false,
    });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M5c §4.3.8, §4.6 규칙 31: 초안 덧씌우기(`profile.applied.overlay[].draftId`)가 얹힌 턴은 범위 `overlay_draft`로 적힌다. 검토본 덧씌우기는 `live`다.
test("a turn whose profile.applied carries a draft overlay is recorded as overlay_draft, and a reviewed overlay turn stays live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-draft-scope-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "thread.started", threadStarted("work"), { turnId: null })]);
    harness.commit([
      event(2, "profile.applied", profileApplied("open", "work", 2), { turnId: null }),
    ]);
    harness.commit([event(3, "turn.started", TURN_STARTED)]);
    const stepA = ids.next("stp");
    const overlayOn = (draftId: string | undefined) => ({
      ...profileApplied("overlay_on", "work", 2),
      overlay: [
        {
          plugin: "widget",
          contentHash: `sha256:${"f".repeat(64)}`,
          until: "turn",
          ...(draftId === undefined ? {} : { draftId }),
        },
      ],
    });
    harness.commit([
      event(4, "profile.applied", overlayOn("drf-1"), { stepId: stepA }),
      event(5, "step.completed", STEP_COMPLETED(0), { stepId: stepA }),
    ]);
    harness.commit([event(6, "turn.completed", TURN_COMPLETED)]);
    await settle();
    expect(turnBundle(harness).turn.scopeKind).toBe("overlay_draft");
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a turn with a reviewed overlay only is live", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-reviewed-scope-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "thread.started", threadStarted("work"), { turnId: null })]);
    harness.commit([
      event(2, "profile.applied", profileApplied("open", "work", 2), { turnId: null }),
    ]);
    harness.commit([event(3, "turn.started", TURN_STARTED)]);
    const stepA = ids.next("stp");
    harness.commit([
      event(
        4,
        "profile.applied",
        {
          ...profileApplied("overlay_on", "work", 2),
          overlay: [{ plugin: "widget", contentHash: `sha256:${"f".repeat(64)}`, until: "turn" }],
        },
        { stepId: stepA },
      ),
      event(5, "step.completed", STEP_COMPLETED(0), { stepId: stepA }),
    ]);
    harness.commit([event(6, "turn.completed", TURN_COMPLETED)]);
    await settle();
    expect(turnBundle(harness).turn.scopeKind).toBe("live");
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a revision that changes at the boundary after step N is a change at step N+1, and a repeat of the same revision is not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "thread.started", threadStarted("work"), { turnId: null })]);
    harness.commit([
      event(2, "profile.applied", profileApplied("open", "work", 2), { turnId: null }),
    ]);
    harness.commit([event(3, "turn.started", TURN_STARTED)]);
    // 단계 0과 1이 끝난 뒤의 경계(단계 1 뒤)에서 개정이 3이 된다. 같은 커밋에 `step.completed`가 든다
    const stepA = ids.next("stp");
    const stepB = ids.next("stp");
    const stepC = ids.next("stp");
    const stepD = ids.next("stp");
    harness.commit([event(4, "step.completed", STEP_COMPLETED(0), { stepId: stepA })]);
    harness.commit([
      event(5, "step.completed", STEP_COMPLETED(1), { stepId: stepB }),
      event(6, "profile.applied", profileApplied("profile_edited", "work", 3), { stepId: stepB }),
    ]);
    // 단계 2 뒤에도 개정은 3이다. 바뀐 것이 아니므로 줄이 더해지지 않는다
    harness.commit([
      event(7, "step.completed", STEP_COMPLETED(2), { stepId: stepC }),
      event(8, "profile.applied", profileApplied("profile_edited", "work", 3), { stepId: stepC }),
    ]);
    // 단계 3 뒤에 개정이 다시 2가 된다. 직전 값과 달라졌으므로 단계 4의 줄이 남는다
    harness.commit([
      event(9, "step.completed", STEP_COMPLETED(3), { stepId: stepD }),
      event(10, "profile.applied", profileApplied("profile_edited", "work", 2), { stepId: stepD }),
    ]);
    harness.commit([event(11, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect([turn.profileId, turn.profileRev]).toEqual(["work", 2]);
    const changes = [
      { stepIndex: 2, rev: 3 },
      { stepIndex: 4, rev: 2 },
    ];
    expect(turn.profileRevChangesJson).toBe(JSON.stringify(changes));
    const record = recordOf(turn.recordJson);
    expect(record.profile).toEqual({ id: "work", rev: 2, source: "thread", inherited: false });
    expect(record.profileRevChanges).toEqual(changes);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a child thread's turn is inherited and carries the profile its parent gave it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    // 자식 대화는 부모의 프로필 값으로 만들어지고, 부모의 `agent.spawned`는 자식의 첫 턴보다 먼저 커밋된다
    harness.commit([event(1, "thread.started", threadStarted("work"), { turnId: null })]);
    harness.commit([
      event(2, "agent.spawned", agentSpawned(THREAD), { threadId: PARENT, turnId: null }),
    ]);
    harness.commit([
      event(3, "profile.applied", profileApplied("open", "work", 2), { turnId: null }),
    ]);
    harness.commit([event(4, "turn.started", TURN_STARTED)]);
    harness.commit([event(5, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect(recordOf(turn.recordJson).profile).toEqual({
      id: "work",
      rev: 2,
      source: "thread",
      inherited: true,
    });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stored profile that is missing reads as the builtin default, at the default's rev", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "thread.started", threadStarted("gone"), { turnId: null })]);
    // 저장한 프로필이 없으면 기본을 쓰고 `profile_missing`을 남긴다(M5c §4.1.1)
    harness.commit([
      event(2, "profile.applied", profileApplied("profile_missing", "default", 0), {
        turnId: null,
      }),
    ]);
    harness.commit([event(3, "turn.started", TURN_STARTED)]);
    harness.commit([event(4, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect([turn.profileId, turn.profileRev]).toEqual(["default", 0]);
    expect(recordOf(turn.recordJson).profile).toEqual({
      id: "default",
      rev: 0,
      source: "builtin",
      inherited: false,
    });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-default profile applied for a thread the recorder has not seen is its stored profile when no port is wired", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-profile-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    // 기록기를 켜기 전에 만들어진 대화다. 기본이 아닌 프로필은 저장한 id로만 쓰이므로 적용된 값에서 저장한 id를 되짚는다
    harness.commit([
      event(1, "profile.applied", profileApplied("open", "work", 4), { turnId: null }),
    ]);
    harness.commit([event(2, "turn.started", TURN_STARTED)]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect([turn.profileId, turn.profileRev]).toEqual(["work", 4]);
    expect(recordOf(turn.recordJson).profile).toEqual({
      id: "work",
      rev: 4,
      source: "thread",
      inherited: false,
    });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the drive stack opened before a turn and the frames it changes are recorded with core-0 depths, and their rows are written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-frames-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    const limits = { maxTurns: 3 };
    // 턴 전에 프레임 하나(깊이 0 = 코어 위 첫 프레임)가 열려 있다
    harness.commit([
      event(
        1,
        "lease.acquired",
        { leaseId: "lse_a", scopeId: "helm", lineageId: "lse_a", limits, depth: 0 },
        { turnId: null },
      ),
    ]);
    harness.commit([event(2, "turn.started", TURN_STARTED)]);
    // 턴 안에서 맡기기로 위에 프레임이 쌓이고, 그 프레임은 끝난다
    harness.commit([
      event(3, "lease.acquired", {
        leaseId: "lse_b",
        scopeId: "verify",
        lineageId: "lse_b",
        limits: {},
        parent: "lse_a",
        depth: 1,
        contentHash: "sha256:abc",
      }),
    ]);
    harness.commit([
      event(4, "lease.released", { leaseId: "lse_b", scopeId: "verify", reason: "done" }),
    ]);
    harness.commit([event(5, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = turnBundle(harness);
    const record = recordOf(bundle.turn.recordJson);
    expect(record.frames).toEqual([
      {
        depth: 1,
        plugin: "helm",
        versionId: null,
        leaseId: "lse_a",
        parentLeaseId: null,
        enteredAtMs: 0,
        exitedAtMs: null,
        exitReason: null,
        lowerResumedWith: null,
        limits,
        used: { turns: 0, spawns: 0, tokens: 0 },
        userMessages: 0,
      },
      {
        depth: 2,
        plugin: "verify",
        versionId: "sha256:abc",
        leaseId: "lse_b",
        parentLeaseId: "lse_a",
        enteredAtMs: 10,
        exitedAtMs: 20,
        exitReason: "done",
        lowerResumedWith: null,
        limits: {},
        used: { turns: 0, spawns: 0, tokens: 0 },
        userMessages: 0,
      },
    ]);
    expect(
      bundle.frames.map((row) => [row.leaseId, row.depth, row.parentLeaseId, row.exitReason]),
    ).toEqual([
      ["lse_a", 1, null, null],
      ["lse_b", 2, "lse_a", "done"],
    ]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 가벼운 길의 호출 줄이 넘기는 인자 해시(정규화 JSON의 SHA-256 앞 40 hex). 두 값 모두 형식만 맞춘 값이다 */
const PLUGIN_ARGS_A = "1667c7df215d7d48f1ce00ef7fd4aa270f4e3ad6";
const PLUGIN_ARGS_B = "ab".repeat(20);

/** 요청 키는 인자 해시를 설치별 소금으로 HMAC한 앞 16 hex다(§4.1 규칙 11). 시험은 같은 식으로 기대값을 낸다 */
function requestKeyOf(salt: string, argsHash: string): string {
  return createHmac("sha256", salt).update(argsHash).digest("hex").slice(0, 16);
}

test("a light-path plugin call of an open turn is written when the turn closes, in call order, and reads back the same after a reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.pluginCall({
      threadId: THREAD,
      plugin: "pc-reader",
      capability: "demo.reader",
      method: "peek",
      argsHash: PLUGIN_ARGS_A,
      ok: true,
      ms: 4,
      via: "method",
      toolCallId: null,
    });
    harness.pluginCall({
      threadId: THREAD,
      plugin: "pc-reader",
      capability: "demo.reader",
      method: "list",
      argsHash: PLUGIN_ARGS_B,
      ok: false,
      ms: 1,
      via: "method",
      toolCallId: "call_9",
    });
    harness.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const store = storeOf(harness.measurement);
    const saltRead = store.installSalt();
    if (!saltRead.ok) throw new Bug("the install salt must be readable");
    const salt = saltRead.value;
    const expectedRows = [
      [
        0,
        "pc-reader",
        "demo.reader",
        "peek",
        requestKeyOf(salt, PLUGIN_ARGS_A),
        true,
        4,
        "method",
        null,
      ],
      [
        1,
        "pc-reader",
        "demo.reader",
        "list",
        requestKeyOf(salt, PLUGIN_ARGS_B),
        false,
        1,
        "method",
        "call_9",
      ],
    ];
    const expectedLines = expectedRows.map((row) => row.slice(1));
    const bundle = store.readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the closed turn must be readable");
    expect(
      bundle.value.plugincalls.map((row) => [
        row.seq,
        row.plugin,
        row.capability,
        row.method,
        row.requestKey,
        row.ok,
        row.ms,
        row.via,
        row.toolCallId,
      ]),
    ).toEqual(expectedRows);
    // record_json의 pluginCalls에도 같은 줄이 들어간다(턴 기록 읽기는 이 값을 쓴다)
    const checked = parse(TurnRecordSchema, JSON.parse(bundle.value.turn.recordJson));
    if (!checked.ok) throw new Bug("record_json must match the TurnRecord schema");
    expect(
      checked.value.pluginCalls.map((line) => [
        line.plugin,
        line.capability,
        line.method,
        line.requestKey,
        line.ok,
        line.ms,
        line.via,
        line.toolCallId,
      ]),
    ).toEqual(expectedLines);
    harness.stop();

    const reopened = openHarness(dir, { enabled: true, trace: trace.port });
    const again = storeOf(reopened.measurement).readTurn(THREAD, TURN);
    if (!again.ok || again.value === undefined) throw new Bug("the turn must survive a reopen");
    expect(
      again.value.plugincalls.map((row) => [
        row.seq,
        row.plugin,
        row.capability,
        row.method,
        row.requestKey,
        row.ok,
        row.ms,
        row.via,
        row.toolCallId,
      ]),
    ).toEqual(expectedRows);
    reopened.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a light-path plugin call with no open turn, or in a turn with the trace off, is not written", async () => {
  const trace = traceStub();
  const call = {
    threadId: THREAD,
    plugin: "pc-reader",
    capability: "demo.reader",
    method: "peek",
    argsHash: PLUGIN_ARGS_A,
    ok: true,
    ms: 2,
    via: "method",
    toolCallId: null,
  } as const;
  const dirOpen = mkdtempSync(join(tmpdir(), "turn-write-"));
  const dirOff = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    // 열린 턴이 없을 때(턴 시작 전, 턴이 닫힌 뒤)의 호출은 버린다
    const open = openHarness(dirOpen, { enabled: true, trace: trace.port });
    open.pluginCall(call);
    open.commit([event(1, "turn.started", TURN_STARTED)]);
    open.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    open.pluginCall(call);
    await settle();
    const closed = storeOf(open.measurement).readTurn(THREAD, TURN);
    if (!closed.ok || closed.value === undefined) throw new Bug("the closed turn must be readable");
    expect(closed.value.plugincalls).toEqual([]);
    open.stop();

    // 계측이 꺼진 턴(log_only)은 턴 행만 쓰므로 호출 줄도 쓰지 않는다
    const off = openHarness(dirOff, { enabled: false, trace: trace.port });
    off.commit([event(1, "turn.started", TURN_STARTED)]);
    off.pluginCall(call);
    off.commit([event(2, "turn.completed", TURN_COMPLETED)]);
    await settle();
    const logOnly = storeOf(off.measurement).readTurn(THREAD, TURN);
    if (!logOnly.ok || logOnly.value === undefined)
      throw new Bug("the log-only turn must be readable");
    expect(logOnly.value.turn.level).toBe("log_only");
    expect(logOnly.value.plugincalls).toEqual([]);
    off.stop();
  } finally {
    rmSync(dirOpen, { recursive: true, force: true });
    rmSync(dirOff, { recursive: true, force: true });
  }
});

// ---- 인자 토큰(§5.1-②)과 턴 플래그(§3.2) --------------------------------------

/** 셸 호출 한 줄. 인자 토큰 목록을 싣고, 시험마다 단계와 턴을 덮어쓴다 */
function shellCall(toolCallId: string, overrides: Partial<ToolCallTraceEvent>): ToolCallTraceEvent {
  return callEvent(toolCallId, {
    tool: "bash",
    plugin: "core",
    risk: "exec",
    capability: null,
    argTokenCount: 30,
    argTokens: [],
    ...overrides,
  });
}

const SHELL_BLOCKED_BY = { plugin: "guard", hook: "tool.call.before", registrationId: "guard:a" };
const CHILD_THREAD: ThreadId = ids.next("thr");

test("a retry with overlapping argument tokens after a blocked call is rewrite_text in the metric, and the rewrite is no longer not_recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    const STEP_B1: StepId = ids.next("stp");
    const STEP_B2: StepId = ids.next("stp");
    const TURN_B: TurnId = ids.next("trn");
    // 턴 1: 막힌 명령의 토큰 다섯(cat, secret, txt, grep, token)에 재시도의 토큰 여섯이 다섯을 겹친다(5/6 = 0.833 ≥ 0.8)
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.call(
      shellCall("blk_a", {
        verdict: "blocked_hook",
        blockedBy: SHELL_BLOCKED_BY,
        argTokens: ["cat", "secret", "txt", "grep", "token"],
      }),
    );
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.call(
      shellCall("retry_a", {
        stepId: STEP_B2,
        argTokens: ["cat", "secret", "txt", "grep", "token", "wc"],
      }),
    );
    harness.commit([event(3, "step.completed", STEP_COMPLETED(2), { stepId: STEP_B2 })]);
    harness.commit([event(4, "turn.completed", TURN_COMPLETED)]);
    // 턴 2: 같은 막힘 뒤의 재시도는 토큰이 하나도 겹치지 않는다(different_path)
    harness.commit([event(5, "turn.started", TURN_STARTED, { turnId: TURN_B })]);
    harness.call(
      shellCall("blk_b", {
        turnId: TURN_B,
        stepId: STEP_B1,
        verdict: "blocked_hook",
        blockedBy: SHELL_BLOCKED_BY,
        argTokens: ["cat", "secret", "txt", "grep", "token"],
      }),
    );
    harness.commit([
      event(6, "step.completed", STEP_COMPLETED(1), { stepId: STEP_B1, turnId: TURN_B }),
    ]);
    harness.call(
      shellCall("retry_b", {
        turnId: TURN_B,
        stepId: STEP_B2,
        argTokens: ["paper", "scissors", "rock"],
      }),
    );
    harness.commit([
      event(7, "step.completed", STEP_COMPLETED(2), { stepId: STEP_B2, turnId: TURN_B }),
    ]);
    harness.commit([event(8, "turn.completed", TURN_COMPLETED, { turnId: TURN_B })]);
    await settle();

    const store = storeOf(harness.measurement);
    const port = createTurnRecordPort({
      store: () => store,
      enabled: () => true,
      retentionDays: () => 30,
      logTurnStartedAt: () => ok(undefined),
      events: { subscribe: () => () => undefined },
      now: () => AT + 1000,
      metrics: () => ({
        minSample: 1,
        defaultWindowDays: 30,
        findingsEnabled: true,
        findingOverrides: {},
      }),
    });
    const out = port.metrics({
      metrics: [
        "hook.post_block",
        "hook.post_block.rewrite_text",
        "hook.post_block.different_path",
      ],
      filter: { period: { from: AT - 1000, to: AT + 1000 } },
      groupBy: [],
      compare: null,
    });
    if (!out.ok) throw new Bug("the metrics must answer in this test");
    const values = out.value.rows[0]?.values ?? {};
    expect(values["hook.post_block"]).toMatchObject({ value: 2 });
    expect(values["hook.post_block.rewrite_text"]).toMatchObject({ value: 0.5, denom: 2 });
    expect(values["hook.post_block.different_path"]).toMatchObject({ value: 0.5, denom: 2 });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the argument tokens are stored as install-salted keys: the same word gives the same key, and no raw word reaches a stored row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.call(shellCall("mask_1", { argTokenCount: 9, argTokens: ["ledger", "marigold"] }));
    harness.call(shellCall("mask_2", { argTokenCount: 4, argTokens: ["ledger"] }));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const salt = saltOf(harness.measurement);
    const bundle = turnBundle(harness);
    const metaOf = (toolCallId: string): unknown =>
      JSON.parse(bundle.calls.find((row) => row.toolCallId === toolCallId)?.metaJson ?? "null");
    expect(metaOf("mask_1")).toEqual({
      risk: "exec",
      riskKnown: true,
      capability: null,
      afterUntrusted: false,
      parentToolCallId: null,
      argTokenCount: 9,
      argTokens: [keyedOf(salt, "ledger"), keyedOf(salt, "marigold")],
      registrationId: null,
    });
    expect(metaOf("mask_2")).toMatchObject({
      argTokenCount: 4,
      argTokens: [keyedOf(salt, "ledger")],
    });
    // 가린 값은 원본 단어와 다르고, 원본 단어는 이 턴의 저장된 어느 행에도 없다
    expect(keyedOf(salt, "ledger")).not.toBe("ledger");
    const stored = JSON.stringify(bundle);
    expect(stored).not.toContain("ledger");
    expect(stored).not.toContain("marigold");
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the turn row's flags column holds the bits of the flags in record_json, and a child spawned in the turn counts as a subagent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.call(
      shellCall("blk_flags", {
        verdict: "blocked_hook",
        blockedBy: SHELL_BLOCKED_BY,
        exec: null,
        result: null,
      }),
    );
    harness.commit([event(2, "agent.spawned", agentSpawned(CHILD_THREAD))]);
    harness.commit([event(3, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(4, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const turn = turnBundle(harness).turn;
    expect(recordOf(turn.recordJson).flags).toMatchObject({ blockedIntent: 1, subagents: 1 });
    // blockedIntent은 비트 0, subagents는 비트 13이다
    expect(turn.flags).toBe(1 + 8192);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks that ran before the turn are its step 0 hooks: turnHooks carries them flagged preTurn, and no tr_hook row is written for them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    // 턴이 열리기 전의 훅(대화 시작, 입력 받기)은 다음 턴의 단계 0 항목으로 버퍼에 붙는다
    trace.entries.push(
      {
        seq: 0,
        hook: "thread.start",
        step: 0,
        pre: true,
        handlers: [handler("ext:open", "passed")],
      },
      {
        seq: 1,
        hook: "input.user.before",
        step: 0,
        pre: true,
        handlers: [handler("ext:ctx", "modified")],
      },
      { seq: 2, hook: "boundary.turn.before", step: 0, handlers: [handler("ext:turn", "passed")] },
      {
        seq: 3,
        hook: "tool.call.before",
        step: 1,
        handlers: [handler("ext:a", "passed", "call_1")],
      },
    );
    harness.commit([event(1, "turn.started", TURN_STARTED)]);
    harness.meter(usage(STEP));
    harness.commit([event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP })]);
    harness.commit([event(3, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const bundle = turnBundle(harness);
    expect(bundle.hooks.map((row) => [row.stepIndex, row.registrationId])).toEqual([[1, "ext:a"]]);
    const record = recordOf(bundle.turn.recordJson);
    expect(
      record.turnHooks.map((hook) => [
        hook.hook,
        hook.registrationId,
        hook.seq,
        hook.preTurn === true,
      ]),
    ).toEqual([
      ["thread.start", "ext:open", 0, true],
      ["input.user.before", "ext:ctx", 1, true],
      ["boundary.turn.before", "ext:turn", 2, false],
    ]);
    harness.stop();

    // 다시 열어도 같은 턴 훅이 읽힌다
    const reopened = openHarness(dir, { enabled: true, trace: trace.port });
    expect(
      recordOf(turnBundle(reopened).turn.recordJson).turnHooks.map((hook) => hook.hook),
    ).toEqual(["thread.start", "input.user.before", "boundary.turn.before"]);
    reopened.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the frame's used counts and user messages follow the durable events, and survive a reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-frame-used-"));
  const child = ids.next("thr");
  try {
    const harness = openHarness(dir, { enabled: true });
    // 1: 주도 프레임(lse_a)이 턴 전에 열린다
    harness.commit([
      event(
        1,
        "lease.acquired",
        {
          leaseId: "lse_a",
          scopeId: "helm",
          lineageId: "lse_a",
          limits: { maxTurns: 3, maxTokens: 1000 },
        },
        { turnId: null },
      ),
    ]);
    // 2: 주도 함수가 연 턴은 턴 수를 한 번 올린다
    harness.commit([
      event(2, "turn.started", {
        inputItemIds: [],
        requestId: "req_d1",
        scopeId: "helm",
        origin: "drive",
      }),
    ]);
    // 3: 모델 호출 총 토큰 135는 맨 위 프레임에 든다
    harness.meter(usage(STEP));
    // 4: 맨 위 프레임이 받은 사용자 메시지 한 건
    harness.commit([
      event(
        4,
        "input.queued",
        {
          mode: "followUp",
          item: { kind: "user", content: "보충" },
          requestId: "req_u1",
          source: { type: "user", via: "interactive" },
        },
        { turnId: null },
      ),
    ]);
    // 5: 주도 함수가 낸 하위 대화 하나(owner가 drive)는 spawns를 올린다
    harness.commit([
      event(5, "agent.spawned", {
        ...agentSpawned(child),
        owner: { kind: "drive", turnId: TURN, scopeId: "helm", leaseId: "lse_a" },
      }),
    ]);
    // 6: 맡기기로 위에 lse_b가 쌓인다. 이후 소비는 lse_b와 그 아래 lse_a에 함께 든다
    harness.commit([
      event(6, "lease.acquired", {
        leaseId: "lse_b",
        scopeId: "verify",
        lineageId: "lse_b",
        limits: {},
        parent: "lse_a",
        depth: 1,
        contentHash: "sha256:abc",
      }),
    ]);
    harness.meter(usage(STEP));
    harness.commit([
      event(
        8,
        "input.queued",
        {
          mode: "followUp",
          item: { kind: "user", content: "검증 중" },
          requestId: "req_u2",
          source: { type: "user", via: "interactive" },
        },
        { turnId: null },
      ),
    ]);
    harness.commit([
      event(9, "lease.released", { leaseId: "lse_b", scopeId: "verify", reason: "done" }),
    ]);
    // 10: lse_b가 내려간 뒤의 소비는 lse_a에만 든다. 이어서 맨 위(lse_a)가 받은 메시지
    harness.meter(usage(STEP));
    harness.commit([
      event(
        11,
        "input.queued",
        {
          mode: "followUp",
          item: { kind: "user", content: "마무리" },
          requestId: "req_u3",
          source: { type: "user", via: "interactive" },
        },
        { turnId: null },
      ),
    ]);
    harness.commit([event(12, "turn.completed", TURN_COMPLETED)]);
    await settle();

    const expected: FrameMark[] = [
      {
        depth: 1,
        plugin: "helm",
        versionId: null,
        leaseId: "lse_a",
        parentLeaseId: null,
        enteredAtMs: 0,
        exitedAtMs: null,
        exitReason: null,
        lowerResumedWith: null,
        limits: { maxTurns: 3, maxTokens: 1000 },
        used: { turns: 1, spawns: 1, tokens: 405 },
        userMessages: 2,
      },
      {
        depth: 2,
        plugin: "verify",
        versionId: "sha256:abc",
        leaseId: "lse_b",
        parentLeaseId: "lse_a",
        enteredAtMs: 40,
        exitedAtMs: 70,
        exitReason: "done",
        lowerResumedWith: null,
        limits: {},
        used: { turns: 0, spawns: 0, tokens: 135 },
        userMessages: 1,
      },
    ];
    expect(recordOf(turnBundle(harness).turn.recordJson).frames).toEqual(expected);
    // 행의 used_json은 기록의 used를 그대로 적은 값이다(키 순서 turns, spawns, tokens)
    expect(
      turnBundle(harness).frames.map((row) => [row.leaseId, row.usedJson, row.userMessages]),
    ).toEqual([
      ["lse_a", JSON.stringify({ turns: 1, spawns: 1, tokens: 405 }), 2],
      ["lse_b", JSON.stringify({ turns: 0, spawns: 0, tokens: 135 }), 1],
    ]);
    harness.stop();

    // 다시 열어도 저장된 값이 그대로 읽힌다
    const reopened = openHarness(dir, { enabled: true });
    expect(recordOf(turnBundle(reopened).turn.recordJson).frames).toEqual(expected);
    reopened.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a frame entered before a turn keeps its used counts across turns: the second turn starts from the first turn's totals", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-frame-across-"));
  const firstTurn = ids.next("trn");
  const secondTurn = ids.next("trn");
  const secondStep = ids.next("stp");
  try {
    const harness = openHarness(dir, { enabled: true });
    harness.commit([
      event(
        1,
        "lease.acquired",
        { leaseId: "lse_a", scopeId: "helm", lineageId: "lse_a", limits: { maxTurns: 3 } },
        { turnId: null },
      ),
    ]);
    harness.commit([
      event(
        2,
        "turn.started",
        { inputItemIds: [], requestId: "req_1", scopeId: "helm", origin: "drive" },
        { turnId: firstTurn },
      ),
    ]);
    harness.meter({ ...usage(STEP), turnId: firstTurn });
    harness.commit([event(3, "turn.completed", TURN_COMPLETED, { turnId: firstTurn })]);
    harness.commit([
      event(
        4,
        "turn.started",
        { inputItemIds: [], requestId: "req_2", scopeId: "helm", origin: "drive" },
        { turnId: secondTurn },
      ),
    ]);
    harness.meter({ ...usage(secondStep), turnId: secondTurn });
    harness.commit([event(5, "turn.completed", TURN_COMPLETED, { turnId: secondTurn })]);
    await settle();

    const first = recordOf(turnBundle(harness, firstTurn).turn.recordJson);
    const second = recordOf(turnBundle(harness, secondTurn).turn.recordJson);
    expect(first.frames.map((frame) => [frame.leaseId, frame.used])).toEqual([
      ["lse_a", { turns: 1, spawns: 0, tokens: 135 }],
    ]);
    expect(second.frames.map((frame) => [frame.leaseId, frame.used])).toEqual([
      ["lse_a", { turns: 2, spawns: 0, tokens: 270 }],
    ]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 저장소의 `batch` 호출 수. 기록기는 이 저장소 객체의 메서드를 부르므로 같은 객체의 메서드를 바꾸면 보인다 */
function countBatches(store: MeasureStore): { count: number } {
  const counted = { count: 0 };
  const original = store.batch.bind(store);
  store.batch = (work) => {
    counted.count += 1;
    return original(work);
  };
  return counted;
}

/** 경고를 `[사건, 필드]` 짝으로 모으는 로거 */
function warningsOf(sink: [string, LogFields | undefined][]): Logger {
  const self: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields) => {
      sink.push([event, fields]);
    },
    error: () => undefined,
    child: () => self,
  };
  return self;
}

/**
 * 한 Turn을 끝까지 흘린다. 시작 뒤 모델 호출 하나, 그다음 단계 끝과 끝을 같은 동기 구간에 커밋한다.
 * 쓰기는 이 구간 전체에 쌓여 마이크로태스크 한 번에 나간다
 */
function commitWholeTurn(harness: Harness): void {
  harness.commit([event(1, "turn.started", TURN_STARTED)]);
  harness.meter(usage(STEP));
  harness.commit([
    event(2, "step.completed", STEP_COMPLETED(1), { stepId: STEP }),
    event(3, "turn.completed", TURN_COMPLETED),
  ]);
}

test("the writes one tick queues are one batch: a turn's start, step and end commit once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    const store = storeOf(harness.measurement);
    const counted = countBatches(store);
    commitWholeTurn(harness);
    await settle();

    expect(counted.count).toBe(1);
    const bundle = store.readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
    expect([bundle.value.turn.status, bundle.value.turn.complete]).toEqual(["completed", true]);
    expect(
      bundle.value.steps.map((step) => [step.stepIndex, step.model, step.input, step.output]),
    ).toEqual([[1, "tape-1", 10, 5]]);
    const measured = store.turn(THREAD, TURN);
    if (!measured.ok) throw new Bug("the measure rows must be readable");
    expect(measured.value.map((row) => row.kind)).toEqual(["call", "turn"]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a queued write that throws is logged once, and the writes queued with it still commit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  const warnings: [string, LogFields | undefined][] = [];
  try {
    const harness = openHarness(dir, {
      enabled: true,
      trace: trace.port,
      logger: warningsOf(warnings),
    });
    const store = storeOf(harness.measurement);
    // 턴을 여는 쓰기가 읽는 대화 표지만 처음 한 번 던진다. 나머지 쓰기는 그대로 간다
    const readThread = store.getThread.bind(store);
    let failedOnce = false;
    store.getThread = (threadId) => {
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("thread read broke");
      }
      return readThread(threadId);
    };
    commitWholeTurn(harness);
    await settle();

    expect(warnings).toEqual([
      ["measure.op_failed", { reason: "threw", message: "thread read broke" }],
    ]);
    const bundle = store.readTurn(THREAD, TURN);
    if (!bundle.ok || bundle.value === undefined) throw new Bug("the turn must be readable");
    expect([bundle.value.turn.status, bundle.value.turn.complete]).toEqual(["completed", true]);
    expect(
      bundle.value.steps.map((step) => [step.stepIndex, step.model, step.input, step.output]),
    ).toEqual([[1, "tape-1", 10, 5]]);
    const measured = store.turn(THREAD, TURN);
    if (!measured.ok) throw new Bug("the measure rows must be readable");
    expect(measured.value.map((row) => row.kind)).toEqual(["call", "turn"]);
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a batch that cannot commit writes nothing, tells no subscriber, and logs the rows it dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  const warnings: [string, LogFields | undefined][] = [];
  const events = createTurnRecordEvents(logger);
  const heard: TurnRecordEvent[] = [];
  events.subscribe((event) => {
    heard.push(event);
  });
  try {
    const harness = openHarness(dir, {
      enabled: true,
      trace: trace.port,
      events,
      logger: warningsOf(warnings),
    });
    const store = storeOf(harness.measurement);
    // 묶음의 작업은 모두 돌고 나서 커밋이 실패한다(롤백)
    const original = store.batch.bind(store);
    store.batch = (work) =>
      original(() => {
        work();
        throw new Error("the commit failed");
      });
    commitWholeTurn(harness);
    await settle();

    expect(warnings).toEqual([["measure.write_failed", { reason: "io", dropped: 2 }]]);
    expect(heard).toEqual([]);
    expect(store.readTurn(THREAD, TURN)).toEqual({ ok: true, value: undefined });
    expect(store.rawCount()).toEqual({ ok: true, value: 0 });
    harness.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopping with nothing queued opens no batch", () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-write-"));
  const trace = traceStub();
  try {
    const harness = openHarness(dir, { enabled: true, trace: trace.port });
    const counted = countBatches(storeOf(harness.measurement));
    harness.stop();
    expect(counted.count).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
