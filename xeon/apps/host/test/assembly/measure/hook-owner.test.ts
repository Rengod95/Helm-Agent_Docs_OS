import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug, type Logger } from "@fresnel/contracts";
import type { StepId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { TraceReadPort, TraceTurnEntry } from "@fresnel/contracts/extensions";
import type { CommitListener, DurableEventEnvelope } from "@fresnel/contracts/records";
import type { RegistrationInfo } from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { hookOwnerLookup } from "../../../src/assembly/measure/hook-owner.ts";
import { startMeasurement } from "../../../src/assembly/measure/recorder.ts";

// 훅 행의 `plugin`과 `versionId`(턴 기록 §3.2 HookRun). 등록 id로 소유를 정하고, 검토본 해시는 행을 쓰는 순간의 로더 값이다.

const ids = fixedIdFactory();
const THREAD: ThreadId = ids.next("thr");
const TURN: TurnId = ids.next("trn");
const AT = Date.UTC(2026, 10, 18, 9, 0, 0);
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

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
  stepId: StepId | null,
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId: TURN,
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

const TURN_STARTED = { inputItemIds: [], requestId: null, scopeId: null, origin: "user" };
const STEP_COMPLETED = (stepIndex: number) => ({
  stepIndex,
  status: "completed",
  stopReason: "stop",
  assistantItemId: null,
  toolResultItemIds: [],
});

/** 등록 하나. 시험에 필요한 칸만 채운다 */
function scope(id: string, extension: string): RegistrationInfo {
  return { id, extension, status: "enabled", generation: 1, waiting: [], drive: "none" };
}

/** 처리기 기록 하나 */
function handler(registrationId: string): TraceTurnEntry["handlers"][number] {
  return {
    registrationId,
    ms: 2,
    result: "passed",
    atMs: 3,
    size: 0,
    skippedBy: null,
    reason: null,
  };
}

test("a plugin hook row carries the plugin name and the reviewed hash, and a sub-scope belongs to its plugin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hook-owner-"));
  const entries: TraceTurnEntry[] = [
    { seq: 0, hook: "tool.call.before", step: 1, handlers: [handler("acme-notes")] },
    { seq: 1, hook: "tool.call.before", step: 1, handlers: [handler("acme-notes/tools")] },
  ];
  const trace: Pick<TraceReadPort, "turn"> = {
    turn: () => ({ traceEnabled: true, retained: true, entries: [...entries] }),
  };
  const owner = hookOwnerLookup({
    registrations: () => [
      scope("acme-notes", "acme-notes"),
      scope("acme-notes/tools", "acme-notes"),
    ],
    contentHashOf: (name) => (name === "acme-notes" ? HASH_A : undefined),
  });
  try {
    const measurement = open(dir, { trace, hookOwner: owner });
    measurement.commit([event(1, "turn.started", TURN_STARTED, null)]);
    measurement.commit([event(2, "step.completed", STEP_COMPLETED(1), ids.next("stp"))]);
    await settle();
    const rows = storeOf(measurement).readTurn(THREAD, TURN);
    if (!rows.ok || rows.value === undefined) throw new Bug("the turn must be readable");
    expect(rows.value.hooks.map((row) => [row.registrationId, row.plugin, row.versionId])).toEqual([
      ["acme-notes", "acme-notes", HASH_A],
      ["acme-notes/tools", "acme-notes", HASH_A],
    ]);
    measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a core unit hook row names the unit and keeps the version null, and an unknown registration keeps the placeholder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hook-owner-"));
  const entries: TraceTurnEntry[] = [
    { seq: 0, hook: "tool.call.before", step: 1, handlers: [handler("fresnel.plugin-set")] },
    { seq: 1, hook: "tool.call.before", step: 1, handlers: [handler("hook:lint-check")] },
  ];
  const trace: Pick<TraceReadPort, "turn"> = {
    turn: () => ({ traceEnabled: true, retained: true, entries: [...entries] }),
  };
  const owner = hookOwnerLookup({
    // 코어 단위는 로더의 검토본이 아니라서 해시 조회가 답을 주지 않는다
    registrations: () => [scope("fresnel.plugin-set", "fresnel.plugin-set")],
    contentHashOf: () => undefined,
  });
  try {
    const measurement = open(dir, { trace, hookOwner: owner });
    measurement.commit([event(1, "turn.started", TURN_STARTED, null)]);
    measurement.commit([event(2, "step.completed", STEP_COMPLETED(1), ids.next("stp"))]);
    await settle();
    const rows = storeOf(measurement).readTurn(THREAD, TURN);
    if (!rows.ok || rows.value === undefined) throw new Bug("the turn must be readable");
    expect(rows.value.hooks.map((row) => [row.registrationId, row.plugin, row.versionId])).toEqual([
      ["fresnel.plugin-set", "fresnel.plugin-set", null],
      ["hook:lint-check", "none", null],
    ]);
    measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a plugin replaced between two steps records the hash of the generation that ran each step", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hook-owner-"));
  const entries: TraceTurnEntry[] = [];
  const trace: Pick<TraceReadPort, "turn"> = {
    turn: () => ({ traceEnabled: true, retained: true, entries: [...entries] }),
  };
  // 판은 시험이 바꾼다. 첫 단계는 A로, 교체 뒤 둘째 단계는 B로 쓰여야 한다
  let current = HASH_A;
  const owner = hookOwnerLookup({
    registrations: () => [scope("acme-notes", "acme-notes")],
    contentHashOf: () => current,
  });
  try {
    const measurement = open(dir, { trace, hookOwner: owner });
    measurement.commit([event(1, "turn.started", TURN_STARTED, null)]);
    entries.push({
      seq: 0,
      hook: "boundary.step.after",
      step: 1,
      handlers: [handler("acme-notes")],
    });
    measurement.commit([event(2, "step.completed", STEP_COMPLETED(1), ids.next("stp"))]);
    current = HASH_B;
    entries.push({
      seq: 1,
      hook: "boundary.step.after",
      step: 2,
      handlers: [handler("acme-notes")],
    });
    measurement.commit([event(3, "step.completed", STEP_COMPLETED(2), ids.next("stp"))]);
    await settle();
    const rows = storeOf(measurement).readTurn(THREAD, TURN);
    if (!rows.ok || rows.value === undefined) throw new Bug("the turn must be readable");
    expect(rows.value.hooks.map((row) => [row.stepIndex, row.plugin, row.versionId])).toEqual([
      [1, "acme-notes", HASH_A],
      [2, "acme-notes", HASH_B],
    ]);
    measurement.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the lookup answers only for registrations and gives the loaded hash, or null when none", () => {
  const owner = hookOwnerLookup({
    registrations: () => [scope("acme-notes", "acme-notes"), scope("unloaded", "unloaded")],
    contentHashOf: (name) => (name === "acme-notes" ? HASH_B : undefined),
  });
  expect(owner("acme-notes")).toEqual({ plugin: "acme-notes", versionId: HASH_B });
  expect(owner("unloaded")).toEqual({ plugin: "unloaded", versionId: null });
  expect(owner("hook:lint-check")).toBeUndefined();
});

/** 측정을 한 폴더에 연다. 이벤트는 피드 구독자에 직접 흘린다 */
function open(
  dir: string,
  options: {
    readonly trace: Pick<TraceReadPort, "turn">;
    readonly hookOwner: ReturnType<typeof hookOwnerLookup>;
  },
) {
  const listeners = new Set<CommitListener>();
  const measurement = startMeasurement({
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
    trace: options.trace,
    hookOwner: options.hookOwner,
    enabled: () => true,
    logger,
    now: () => AT,
  });
  return {
    store: measurement.store,
    stop: () => measurement.stop(),
    commit: (events: readonly DurableEventEnvelope[]) => {
      for (const listener of listeners) {
        listener({ firstSeq: 1, lastSeq: events.length, events });
      }
    },
  };
}

/** 쓰기 묶음은 커밋 뒤 마이크로태스크에 쓰인다. 한 번 기다리면 쓰기가 끝난다 */
async function settle(): Promise<void> {
  await Promise.resolve();
}

function storeOf(measurement: ReturnType<typeof open>) {
  if (measurement.store === undefined) throw new Bug("the measure database must open in this test");
  return measurement.store;
}
