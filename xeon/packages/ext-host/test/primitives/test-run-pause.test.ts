// Test run 단계 경계 멈춤(X-19, X.primitives.spec §4.4.8). 실제 루프 대신 가짜 루프의 runTurn이나 시험 본문이 단계 경계 디스패치를 낸다.
// 멈춘 디스패치는 flushMicrotasks로 확인하고 멈춘 동안에는 t.settled()를 부르지 않는다. drive 호출은 추적 작업이라 멈춘 동안 settled가 막히기 때문이다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PhasesDecl, TestRunControlPort } from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import {
  hostInternalsOf,
  testRunControlOf,
  type DispatchOutcome,
  type ExtensionUnit,
  type PayloadOf,
} from "../../src/primitives/index.ts";
import { MAX_BOUNDARIES } from "../../src/primitives/boundary-log.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost, flushMicrotasks, type TestHost } from "../../src/testing/index.ts";
import { createOperationsHarness } from "../operations/support/harness.ts";
import {
  assistantStop,
  makeGroupUnit,
  makeUnit,
  toolResultMessage,
  userText,
} from "./fixtures/support.ts";

type StepOutcome = DispatchOutcome<"boundary.step.after">;

/** `boundary.step.after` 입력. 스모크 시험의 모양을 그대로 쓴다 */
function stepEndPayload(t: TestHost): PayloadOf<"boundary.step.after"> {
  return {
    stepIndex: 1,
    stepId: t.ids.next("stp"),
    message: assistantStop,
    toolResults: [toolResultMessage],
    messageItemId: t.ids.next("itm"),
    toolResultItemIds: [t.ids.next("itm")],
    context: {
      contextMessages: [userText, assistantStop],
      llmMessages: [userText],
      pendingMessages: [],
      canContinue: true,
    },
  };
}

/** 단계 경계 처리 하나. 키는 단계 id로 정한다(L1이 쓰는 모양). signal은 turn의 취소 신호다 */
function stepEnd(t: TestHost, threadId: ThreadId, signal?: AbortSignal): Promise<StepOutcome> {
  const payload = stepEndPayload(t);
  return t.host.dispatch("boundary.step.after", payload, {
    threadId,
    dispatchKey: `${payload.stepId}:boundary.step.after`,
    initial: { entries: [], continue: false },
    finalize: (value) => value,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** 디스패치가 끝났는지 본다. 끝나면 결과를 `seen`에 남긴다. 멈춘 동안은 `seen.outcome`이 null이다 */
function watch(run: Promise<StepOutcome>): {
  readonly seen: { outcome: StepOutcome | null };
  readonly done: Promise<void>;
} {
  const seen: { outcome: StepOutcome | null } = { outcome: null };
  const done = run.then((outcome) => {
    seen.outcome = outcome;
    return undefined;
  });
  return { seen, done };
}

/** 핸들러가 아무 결정도 하지 않는 `boundary.step.after` 확장. 값은 `{ entries: [], continue: true }`가 된다 */
function stepGroupUnit(name: string, counts: { step: number }): ExtensionUnit {
  return makeUnit({ name, hooks: ["boundary.step.after"] }, (g) => {
    g.on("boundary.step.after", () => {
      counts.step += 1;
      return { continue: true };
    });
  });
}

// 값이 좁혀진 결과(port의 Result 가지)와 맞도록 as const로 쓴다
const notTestRun = { ok: false, error: { kind: "not_a_test_run" } } as const;
const notPaused = { ok: false, error: { kind: "not_paused" } } as const;
const paused = { ok: true, value: { paused: true } } as const;
const resumed = { ok: true, value: { paused: false } } as const;

test("a Test run pauses at the next boundary.step.after and resumes with the outcome an unpaused dispatch gives", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-a", counts));
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);

  const unpaused = await stepEnd(t, thread);
  expect(control.pause(thread)).toEqual(paused);
  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  // 멈춘 디스패치의 핸들러는 멈추기 전에 이미 돌았고(처리 뒤에 멈춘다), 디스패치는 멈춘 동안 끝나지 않는다
  expect(counts.step).toBe(2);
  expect(held.seen.outcome).toBeNull();

  expect(control.resume(thread)).toEqual(resumed);
  await held.done;
  expect(unpaused.value).toEqual({ entries: [], continue: true });
  expect(held.seen.outcome).toEqual(unpaused);
});

test("the request applies only at the boundary: handlers and loop.turn proceed until boundary.step.after", async () => {
  const counts = { drive: 0, toolCall: 0, step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(
    makeGroupUnit({ name: "pause-b", hooks: ["tool.call.before", "boundary.step.after"] }, (g) => {
      g.on("tool.call.before", () => {
        counts.toolCall += 1;
        return undefined;
      });
      g.on("boundary.step.after", () => {
        counts.step += 1;
        return { continue: true };
      });
      g.drive(async (loop) => {
        counts.drive += 1;
        // 같은 상태 판의 같은 기본 키는 재생되므로 호출마다 요청 키를 바꾼다
        await loop.turn({
          input: { kind: "user", content: "go" },
          requestId: `pause-b:${counts.drive}`,
        });
      });
    }),
  );
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual(["pause-b:1"]);

  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);
  // 요청만으로는 turn이 멈추지 않는다. 다음 turn_settled에서 drive가 다시 불린다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(t.loop.turns.map((turn) => turn.requestId)).toEqual(["pause-b:1", "pause-b:2"]);
  const toolCall = await t.host.dispatch(
    "tool.call.before",
    { toolCallId: "call_1", toolName: "read", input: {} },
    { threadId: thread, dispatchKey: "tc1" },
  );
  expect(toolCall.decision).toBeUndefined();
  expect(counts.toolCall).toBe(1);
  expect(counts.step).toBe(0);

  // 단계 경계 처리에서는 등록된 핸들러가 모두 돌고 나서 멈춘다
  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(counts.step).toBe(1);
  expect(held.seen.outcome).toBeNull();
  expect(control.resume(thread)).toEqual(resumed);
  await held.done;
  expect(held.seen.outcome?.value).toEqual({ entries: [], continue: true });
});

test("a held boundary keeps the drive lock: no second drive call, no release, no second turn", async () => {
  const gate = Promise.withResolvers<void>();
  const counts = { drive: 0 };
  const driveSignals: AbortSignal[] = [];
  const seen: { outcome: StepOutcome | null } = { outcome: null };
  const t = await createTestHost({
    loop: {
      // turn 안에서 단계 경계 처리를 낸다. 요청이 들어간 뒤에 낼 수 있도록 gate를 기다린다
      runTurn: async (request) => {
        await gate.promise;
        seen.outcome = await stepEnd(t, request.threadId);
        return { outcome: { turnId: t.ids.next("trn"), status: "completed" }, usage: null };
      },
    },
  });
  const thread = t.newThread();
  await t.host.install(
    makeGroupUnit({ name: "pause-c", hooks: ["boundary.step.after"] }, (g) => {
      g.on("boundary.step.after", () => ({ continue: true }));
      g.drive(async (loop) => {
        counts.drive += 1;
        driveSignals.push(loop.signal);
        await loop.turn({ input: { kind: "user", content: "go" } });
      });
    }),
  );
  await t.host.openThread(thread, { testRun: true });
  await flushMicrotasks(200);
  // drive가 turn을 시작하고 gate에서 기다린다. 아직 멈춤 요청은 없다
  const lease = t.host.leaseOf(thread);
  expect(lease).not.toBeNull();
  expect(t.loop.status(thread)).toBe("running");

  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);
  gate.resolve();
  await flushMicrotasks(200);

  // 멈춘 동안: drive는 한 번만 불렸고, drive 락은 그대로이며, 반납 기록이 없고, turn은 하나뿐이다
  expect(seen.outcome).toBeNull();
  expect(counts.drive).toBe(1);
  expect(t.host.leaseOf(thread)).toEqual(lease);
  expect(driveSignals[0]?.aborted).toBe(false);
  expect(t.records.events(thread).map((event) => event.kind)).not.toContain("lease.released");
  expect(t.loop.turns).toHaveLength(1);
  expect(t.loop.status(thread)).toBe("running");

  // 풀면 turn이 정착하고 같은 drive 락으로 끝난다
  expect(control.resume(thread)).toEqual(resumed);
  await t.settled();
  expect(seen.outcome?.value).toEqual({ entries: [], continue: true });
  expect(counts.drive).toBe(1);
  expect(t.host.leaseOf(thread)).toEqual(lease);
  expect(t.records.events(thread).map((event) => event.kind)).not.toContain("lease.released");
  expect(t.loop.turns).toHaveLength(1);
  expect(t.loop.status(thread)).toBe("idle");
});

test("step releases the held boundary, and the next boundary holds again", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-d1", counts));
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);

  const first = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(first.seen.outcome).toBeNull();
  expect(control.step(thread)).toEqual(paused);
  await first.done;
  expect(first.seen.outcome?.value).toEqual({ entries: [], continue: true });

  // 요청은 남아 있어서 다음 경계는 다시 멈춘다
  const second = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(second.seen.outcome).toBeNull();
  expect(counts.step).toBe(2);
  expect(control.resume(thread)).toEqual(resumed);
  await second.done;
  expect(second.seen.outcome?.value).toEqual({ entries: [], continue: true });
});

test("step without a held boundary lets exactly one boundary pass, then holds the following one", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-d2", counts));
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);
  // 아직 멈춘 경계는 없다. 다음 경계 하나만 지나간다
  expect(control.step(thread)).toEqual(paused);

  const passing = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(passing.seen.outcome?.value).toEqual({ entries: [], continue: true });

  const holding = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(holding.seen.outcome).toBeNull();
  expect(counts.step).toBe(2);
  expect(control.resume(thread)).toEqual(resumed);
  await holding.done;
  expect(holding.seen.outcome?.value).toEqual({ entries: [], continue: true });
});

test("a thread that is not a Test run answers not_a_test_run and its boundary is never held", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const plain = t.newThread();
  const unopened = t.newThread();
  await t.host.install(stepGroupUnit("pause-e", counts));
  await t.host.openThread(plain);
  const control = testRunControlOf(t.host);
  for (const threadId of [plain, unopened]) {
    expect(control.pause(threadId)).toEqual(notTestRun);
    expect(control.resume(threadId)).toEqual(notTestRun);
    expect(control.step(threadId)).toEqual(notTestRun);
    expect(control.phase(threadId)).toEqual(notTestRun);
  }
  // 평범한 대화의 단계 경계는 멈추지 않는다
  const outcome = await stepEnd(t, plain);
  expect(outcome.value).toEqual({ entries: [], continue: true });
  expect(counts.step).toBe(1);
});

test("resume and step without a request answer not_paused", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);
  expect(control.resume(thread)).toEqual(notPaused);
  expect(control.step(thread)).toEqual(notPaused);
  expect(control.pause(thread)).toEqual(paused);
  expect(control.resume(thread)).toEqual(resumed);
  // 요청을 거둔 뒤에는 다시 멈춤이 없다
  expect(control.resume(thread)).toEqual(notPaused);
  expect(control.step(thread)).toEqual(notPaused);
});

test("aborting the signal of a held dispatch releases it, and the request stays for the next boundary", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-g1", counts));
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);

  const controller = new AbortController();
  const aborted = watch(stepEnd(t, thread, controller.signal));
  await flushMicrotasks(100);
  expect(aborted.seen.outcome).toBeNull();
  controller.abort();
  await aborted.done;
  expect(aborted.seen.outcome?.value).toEqual({ entries: [], continue: true });

  // turn이 끊겨도 요청은 남는다. 다음 경계는 다시 멈춘다
  const next = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(next.seen.outcome).toBeNull();
  expect(control.resume(thread)).toEqual(resumed);
  await next.done;
  expect(next.seen.outcome?.value).toEqual({ entries: [], continue: true });
});

test("closing the thread releases a held boundary and drops the Test run marker", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-g2", counts));
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);

  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(held.seen.outcome).toBeNull();
  await t.host.closeThread(thread);
  await held.done;
  expect(held.seen.outcome?.value).toEqual({ entries: [], continue: true });
  expect(control.pause(thread)).toEqual(notTestRun);
});

test("dispose releases a held boundary", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-g3", counts));
  await t.host.openThread(thread, { testRun: true });
  expect(testRunControlOf(t.host).pause(thread)).toEqual(paused);

  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(held.seen.outcome).toBeNull();
  await t.host.dispose();
  await held.done;
  expect(held.seen.outcome?.value).toEqual({ entries: [], continue: true });
});

test("the gate reads no operations setting: with the trace off it holds and resumes the same way", async () => {
  const counts = { step: 0 };
  const harness = await createOperationsHarness({ settings: { trace: { enabled: false } } });
  const t = harness.t;
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-h", counts));
  await t.host.openThread(thread, { testRun: true });
  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);
  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(held.seen.outcome).toBeNull();
  expect(control.resume(thread)).toEqual(resumed);
  await held.done;
  expect(held.seen.outcome?.value).toEqual({ entries: [], continue: true });
});

// ── phase: drive 락 보유자의 그룹 선언과 커밋된 상태 판 ──────────────────

const PHASES: PhasesDecl = {
  initial: "plan",
  nodes: [
    { id: "plan", kind: "turn" },
    { id: "build", kind: "turn" },
    { id: "done", kind: "end" },
  ],
  transitions: [
    { from: "plan", to: "build" },
    { from: "build", to: "done" },
  ],
};

const PhaseStateSchema = Type.Object({ phase: Type.String() });

/** drive 그룹 하나. drive는 처음 상태가 `next`가 아니면 `phase`를 `next`로 한 번 커밋한다 */
function phaseGroupUnit(name: string, phases: PhasesDecl | undefined, next: string): ExtensionUnit {
  return makeUnit<{ readonly phase: string }>(
    {
      name,
      group:
        phases === undefined
          ? {}
          : { composition: { blocks: [{ id: "machine", stage: "machine", op: "drive" }], phases } },
      drives: true,
      def: { state: { schema: PhaseStateSchema, initial: { phase: "plan" }, version: 1 } },
    },
    (g) => {
      g.drive(async (_loop, state) => {
        if (state.phase !== next) await g.commit({ phase: next });
      });
    },
  );
}

test("phase reads the committed phase of the drive-lock holder's group", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-phase", PHASES, "build"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  expect(testRunControlOf(t.host).phase(thread)).toEqual({
    ok: true,
    value: {
      phase: "build",
      group: "pause-phase",
      seq: 1,
      paused: false,
      lock: { holder: "pause-phase", status: "active", epoch: 1 },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [],
    },
  });
});

test("a committed phase outside the declared nodes reads as null, with the group and the rev", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-phase-x", PHASES, "ghost"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  expect(testRunControlOf(t.host).phase(thread)).toEqual({
    ok: true,
    value: {
      phase: null,
      group: "pause-phase-x",
      seq: 1,
      paused: false,
      lock: { holder: "pause-phase-x", status: "active", epoch: 1 },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [],
    },
  });
});

test("a drive-lock holder without a phases declaration answers the phase fields null and still shows the lock", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-plain", undefined, "build"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  expect(testRunControlOf(t.host).phase(thread)).toEqual({
    ok: true,
    value: {
      phase: null,
      group: null,
      seq: null,
      paused: false,
      lock: { holder: "pause-plain", status: "active", epoch: 1 },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [],
    },
  });
});

test("phase shows the pause request while it is held and clears it on resume", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-phase-held", PHASES, "build"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  const control = testRunControlOf(t.host);
  expect(control.pause(thread)).toEqual(paused);
  expect(control.phase(thread)).toMatchObject({ ok: true, value: { paused: true } });
  expect(control.resume(thread)).toEqual(resumed);
  expect(control.phase(thread)).toMatchObject({ ok: true, value: { paused: false } });
});

test("a Test run without a drive-lock holder answers all null and lock none", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  expect(testRunControlOf(t.host).phase(thread)).toEqual({
    ok: true,
    value: {
      phase: null,
      group: null,
      seq: null,
      paused: false,
      lock: { holder: null, status: "none", epoch: null },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [],
    },
  });
});

// ── 단계 경계 기록(X-19, X.primitives.spec §4.4.8 10): boundary.step.after마다 한 건, 최근 200건 ──

test("a Test run logs one boundary per boundary.step.after, with the rev and committed phase at that point and paused where the request held it", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-bounds", PHASES, "build"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  const control = testRunControlOf(t.host);

  await stepEnd(t, thread);
  expect(control.pause(thread)).toEqual(paused);
  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(held.seen.outcome).toBeNull();
  expect(control.resume(thread)).toEqual(resumed);
  await held.done;
  await stepEnd(t, thread);

  expect(control.phase(thread)).toEqual({
    ok: true,
    value: {
      phase: "build",
      group: "pause-bounds",
      seq: 1,
      paused: false,
      lock: { holder: "pause-bounds", status: "active", epoch: 1 },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [
        { seq: 1, phase: "build", paused: false },
        { seq: 1, phase: "build", paused: true },
        { seq: 1, phase: "build", paused: false },
      ],
    },
  });
});

test("a group without composition phases logs phase null and still the committed rev", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-bounds-plain", undefined, "build"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  await stepEnd(t, thread);
  expect(testRunControlOf(t.host).phase(thread)).toEqual({
    ok: true,
    value: {
      phase: null,
      group: null,
      seq: null,
      paused: false,
      lock: { holder: "pause-bounds-plain", status: "active", epoch: 1 },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [{ seq: 1, phase: null, paused: false }],
    },
  });
});

test("a Test run without a drive-lock holder logs seq 0 and phase null", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(stepGroupUnit("pause-bounds-free", { step: 0 }));
  await t.host.openThread(thread, { testRun: true });
  await stepEnd(t, thread);
  expect(testRunControlOf(t.host).phase(thread)).toEqual({
    ok: true,
    value: {
      phase: null,
      group: null,
      seq: null,
      paused: false,
      lock: { holder: null, status: "none", epoch: null },
      guardHits: 0,
      traceEnabled: true,
      boundaries: [{ seq: 0, phase: null, paused: false }],
    },
  });
});

/** 홀수 번째(0부터 셈) 경계마다 멈춘다. 남은 기록의 멈춤 칸 순서로 어느 경계가 남았는지 드러난다 */
function pausedAtCapIndex(index: number): boolean {
  return index % 2 === 1;
}

/** 경계 하나를 낸다. 멈춰야 하면 기다리게 한 뒤 바로 푼다 */
async function passOneBoundary(
  t: TestHost,
  thread: ThreadId,
  control: TestRunControlPort,
  holding: boolean,
): Promise<void> {
  if (!holding) {
    await stepEnd(t, thread);
    return;
  }
  expect(control.pause(thread)).toEqual(paused);
  const held = watch(stepEnd(t, thread));
  await flushMicrotasks(100);
  expect(control.resume(thread)).toEqual(resumed);
  await held.done;
}

test("the boundary log keeps the newest 200 entries, oldest first", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(phaseGroupUnit("pause-bounds-cap", PHASES, "build"));
  await t.host.openThread(thread, { testRun: true });
  await t.settled();
  const control = testRunControlOf(t.host);
  const total = MAX_BOUNDARIES + 5;
  const indexes = Array.from({ length: total }, (_, index) => index);
  await eachInOrder(indexes, async (index) => {
    await passOneBoundary(t, thread, control, pausedAtCapIndex(index));
    return "continue";
  });
  const kept = indexes
    .map((index) => ({ seq: 1, phase: "build", paused: pausedAtCapIndex(index) }))
    .slice(-MAX_BOUNDARIES);
  expect(control.phase(thread)).toEqual({
    ok: true,
    value: {
      phase: "build",
      group: "pause-bounds-cap",
      seq: 1,
      paused: false,
      lock: { holder: "pause-bounds-cap", status: "active", epoch: 1 },
      guardHits: 0,
      traceEnabled: true,
      boundaries: kept,
    },
  });
});

test("a thread that is not a Test run logs no boundaries and phase still answers not_a_test_run", async () => {
  const counts = { step: 0 };
  const t = await createTestHost();
  const plain = t.newThread();
  await t.host.install(stepGroupUnit("pause-bounds-plain-thread", counts));
  await t.host.openThread(plain);
  await stepEnd(t, plain);
  await stepEnd(t, plain);
  expect(counts.step).toBe(2);
  expect(hostInternalsOf(t.host).boundaryLog.entriesOf(plain)).toEqual([]);
  expect(testRunControlOf(t.host).phase(plain)).toEqual(notTestRun);
});
