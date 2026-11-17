import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, parse, type Logger } from "@fresnel/contracts";
import type { StepId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { PluginSetPort, TraceReadPort, TraceTurnEntry } from "@fresnel/contracts/extensions";
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
  readonly stop: () => void;
}

/** 측정을 한 폴더에 연다. 이벤트는 피드 구독자에 직접 흘리고, 모델 호출은 합산기 구독자에 흘린다 */
function openHarness(
  dir: string,
  options: {
    readonly enabled: boolean;
    readonly trace?: Pick<TraceReadPort, "turn">;
    readonly pluginSet?: Pick<PluginSetPort, "resolve">;
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
