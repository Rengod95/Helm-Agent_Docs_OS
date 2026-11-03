import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  HookName,
  TraceFailureReason,
  TraceHandlerResult,
} from "@fresnel/contracts/extensions";
import {
  createStaticOperationsSettings,
  createTraceBuffer,
  DEFAULT_TRACE_SETTINGS,
  type TraceBuffer,
  type TraceSettings,
} from "../../src/operations/index.ts";
import {
  MAX_ENTRIES_PER_TURN,
  MAX_HANDLERS_PER_ENTRY,
  MAX_THREADS,
} from "../../src/operations/trace-buffer.ts";
import { traceReadOf } from "../../src/primitives/index.ts";
import { fixedIdFactory, flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

/** 테스트 시계의 기준. Turn을 여는 첫 디스패치가 이 시각(ms)에 시작한다 */
const T0 = 1000;

/** 처리기 기록 하나. 디스패처가 `TraceDispatch.record`에 넘기는 모양과 같다 */
interface Hit {
  readonly registrationId: string;
  readonly durationMs: number;
  readonly result: TraceHandlerResult;
  readonly startedAt: number;
  readonly size: number;
  readonly skippedBy: string | null;
  readonly reason: TraceFailureReason | null;
}

/** 설정 값을 테스트 중에 바꿀 수 있는 버퍼. set으로 바꾼 값은 다음 읽기부터 보인다 */
function bufferWith(initial: TraceSettings): {
  readonly buffer: TraceBuffer;
  readonly set: (next: TraceSettings) => void;
} {
  let current = initial;
  return {
    buffer: createTraceBuffer({ settings: () => current }),
    set: (next) => {
      current = next;
    },
  };
}

/** 디스패치 하나를 `now`에 시작하고 처리기 기록을 차례로 남긴다. 계측이 꺼져 있으면 아무것도 남지 않는다 */
function dispatchHits(
  buffer: TraceBuffer,
  threadId: ThreadId,
  dispatchKey: string,
  hook: HookName,
  now: number,
  hits: readonly Hit[],
): void {
  const dispatch = buffer.start({ threadId, dispatchKey, hook, now });
  for (const hit of hits) dispatch?.record(hit);
}

/** 한 Turn의 탭 디스패치 하나. 처리기 하나가 passed로 끝나고, Turn은 T0에 열린다 */
function turnPassed(
  buffer: TraceBuffer,
  threadId: ThreadId,
  turnKey: string,
  registrationId: string,
  durationMs: number,
): void {
  dispatchHits(buffer, threadId, `${turnKey}:boundary.settle.after`, "boundary.settle.after", T0, [
    {
      registrationId,
      durationMs,
      result: "passed",
      startedAt: T0,
      size: 0,
      skippedBy: null,
      reason: null,
    },
  ]);
}

test("trace buffer: a thread keeps only its newest turnsPerThread turns", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith({ enabled: true, turnsPerThread: 2 });
  const thread = ids.next("thr");
  const first = ids.next("trn");
  const second = ids.next("trn");
  const third = ids.next("trn");
  turnPassed(buffer, thread, first, "ext-a", 1);
  turnPassed(buffer, thread, second, "ext-b", 2);
  turnPassed(buffer, thread, third, "ext-c", 3);
  expect(buffer.turn(thread, first)).toBeUndefined();
  expect(buffer.turn(thread, second)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-b",
            ms: 2,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
  expect(buffer.turn(thread, third)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-c",
            ms: 3,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
});

test("trace buffer: turnsPerThread is read when a new turn appears", () => {
  const ids = fixedIdFactory();
  const { buffer, set } = bufferWith({ enabled: true, turnsPerThread: 20 });
  const thread = ids.next("thr");
  const first = ids.next("trn");
  const second = ids.next("trn");
  const third = ids.next("trn");
  for (const turn of [first, second, third]) turnPassed(buffer, thread, turn, "ext-a", 1);
  expect(buffer.turn(thread, first)).toBeDefined();
  // 줄인 값은 다음에 처음 보이는 Turn부터 적용된다
  set({ enabled: true, turnsPerThread: 1 });
  expect(buffer.turn(thread, first)).toBeDefined();
  const fourth = ids.next("trn");
  turnPassed(buffer, thread, fourth, "ext-a", 4);
  expect(buffer.turn(thread, first)).toBeUndefined();
  expect(buffer.turn(thread, second)).toBeUndefined();
  expect(buffer.turn(thread, third)).toBeUndefined();
  expect(buffer.turn(thread, fourth)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 4,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
});

test("trace buffer: both registrations of one dispatch are recorded in order", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  dispatchHits(buffer, thread, `${turn}:input.user.before`, "input.user.before", T0, [
    {
      registrationId: "ext-a",
      durationMs: 3,
      result: "passed",
      startedAt: T0,
      size: 0,
      skippedBy: null,
      reason: null,
    },
    // ext-a가 3ms 쓴 뒤에 ext-b가 시작하므로 atMs는 3이다
    {
      registrationId: "ext-b",
      durationMs: 12,
      result: "failed",
      startedAt: T0 + 3,
      size: 0,
      skippedBy: null,
      reason: "threw",
    },
  ]);
  expect(buffer.turn(thread, turn)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "input.user.before",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 3,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
          {
            registrationId: "ext-b",
            ms: 12,
            result: "failed",
            atMs: 3,
            size: 0,
            skippedBy: null,
            reason: "threw",
          },
        ],
      },
    ],
  });
});

test("trace buffer: atMs counts from the turn's first dispatch now", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  const step = ids.next("stp");
  // 첫 디스패치(now=1000)가 Turn을 연다. 처리기가 1000에 시작하면 atMs는 0이다
  dispatchHits(buffer, thread, `${turn}:input.user.before`, "input.user.before", 1000, [
    {
      registrationId: "ext-a",
      durationMs: 3,
      result: "passed",
      startedAt: 1000,
      size: 0,
      skippedBy: null,
      reason: null,
    },
  ]);
  // 뒤의 Turn 디스패치(now=1030)는 Turn의 시작을 바꾸지 않는다. 처리기가 1030에 시작하면 atMs는 30이다
  dispatchHits(buffer, thread, `${turn}:boundary.settle.after`, "boundary.settle.after", 1030, [
    {
      registrationId: "ext-b",
      durationMs: 2,
      result: "passed",
      startedAt: 1030,
      size: 0,
      skippedBy: null,
      reason: null,
    },
  ]);
  // 단계 키의 now(1200)는 Turn 시작이 되지 않는다. 처리기가 1210에 시작하면 atMs는 210이다
  dispatchHits(buffer, thread, `${step}:tool.call.before:call_1`, "tool.call.before", 1200, [
    {
      registrationId: "ext-c",
      durationMs: 1,
      result: "passed",
      startedAt: 1210,
      size: 0,
      skippedBy: null,
      reason: null,
    },
  ]);
  expect(buffer.turn(thread, turn)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "input.user.before",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 3,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
      {
        seq: 1,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-b",
            ms: 2,
            result: "passed",
            atMs: 30,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
      {
        seq: 2,
        hook: "tool.call.before",
        step: 1,
        handlers: [
          {
            registrationId: "ext-c",
            ms: 1,
            result: "passed",
            atMs: 210,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
});

test("trace buffer: a skipped record keeps its skippedBy and a zero size through turn()", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  // ext-a가 막아서 ext-b는 건너뛴다. 건너뛴 기록은 시간이 0이고 크기가 0이다
  dispatchHits(buffer, thread, `${turn}:tool.call.before:call_1`, "tool.call.before", T0, [
    {
      registrationId: "ext-a",
      durationMs: 2,
      result: "blocked",
      startedAt: T0,
      size: 0,
      skippedBy: null,
      reason: null,
    },
    {
      registrationId: "ext-b",
      durationMs: 0,
      result: "skipped",
      startedAt: T0 + 2,
      size: 0,
      skippedBy: "ext-a",
      reason: null,
    },
  ]);
  expect(buffer.turn(thread, turn)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "tool.call.before",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 2,
            result: "blocked",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
          {
            registrationId: "ext-b",
            ms: 0,
            result: "skipped",
            atMs: 2,
            size: 0,
            skippedBy: "ext-a",
            reason: null,
          },
        ],
      },
    ],
  });
});

test("trace buffer: step ordinals follow the first sight of each stepId", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  const firstStep = ids.next("stp");
  const secondStep = ids.next("stp");
  const hit: Hit = {
    registrationId: "ext-c",
    durationMs: 5,
    result: "passed",
    startedAt: T0,
    size: 0,
    skippedBy: null,
    reason: null,
  };
  dispatchHits(buffer, thread, `${turn}:input.user.before`, "input.user.before", T0, [hit]);
  dispatchHits(buffer, thread, `${firstStep}:tool.call.before:call_1`, "tool.call.before", T0, [
    hit,
  ]);
  dispatchHits(buffer, thread, `${firstStep}:tool.call.before:call_2`, "tool.call.before", T0, [
    hit,
  ]);
  dispatchHits(buffer, thread, `${secondStep}:tool.call.before:call_3`, "tool.call.before", T0, [
    hit,
  ]);
  dispatchHits(buffer, thread, `${turn}:boundary.settle.after`, "boundary.settle.after", T0, [hit]);
  const retained = buffer.turn(thread, turn);
  expect(retained?.entries.map((entry) => [entry.seq, entry.step])).toEqual([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 0],
  ]);
});

test("trace buffer: keys without a current turn are not recorded", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  const step = ids.next("stp");
  const hit: Hit = {
    registrationId: "ext-a",
    durationMs: 1,
    result: "passed",
    startedAt: T0,
    size: 0,
    skippedBy: null,
    reason: null,
  };
  expect(
    buffer.start({
      threadId: thread,
      dispatchKey: `${step}:tool.call.before:call_1`,
      hook: "tool.call.before",
      now: T0,
    }),
  ).toBeUndefined();
  expect(
    buffer.start({
      threadId: thread,
      dispatchKey: "evt_1:lifecycle.agent.settled",
      hook: "boundary.settle.after",
      now: T0,
    }),
  ).toBeUndefined();
  expect(buffer.turn(thread, turn)).toBeUndefined();
  // Turn이 세워진 뒤에는 접두가 Turn도 단계도 아닌 키가 현재 Turn의 단계 0에 붙는다
  dispatchHits(buffer, thread, `${turn}:input.user.before`, "input.user.before", T0, [hit]);
  dispatchHits(buffer, thread, "evt_1:lifecycle.agent.settled", "boundary.settle.after", T0, [hit]);
  expect(buffer.turn(thread, turn)?.entries.map((entry) => [entry.seq, entry.step])).toEqual([
    [0, 0],
    [1, 0],
  ]);
});

test("trace buffer: a turn key makes its turn current again", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const older = ids.next("trn");
  const newer = ids.next("trn");
  const hit: Hit = {
    registrationId: "ext-a",
    durationMs: 1,
    result: "passed",
    startedAt: T0,
    size: 0,
    skippedBy: null,
    reason: null,
  };
  dispatchHits(buffer, thread, `${older}:input.user.before`, "input.user.before", T0, [hit]);
  dispatchHits(buffer, thread, `${newer}:input.user.before`, "input.user.before", T0, [hit]);
  dispatchHits(buffer, thread, `${older}:input.user.before`, "input.user.before", T0, [hit]);
  dispatchHits(buffer, thread, "k", "boundary.settle.after", T0, [hit]);
  expect(buffer.turn(thread, newer)?.entries.map((entry) => entry.seq)).toEqual([0]);
  expect(buffer.turn(thread, older)?.entries.map((entry) => [entry.seq, entry.step])).toEqual([
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
});

test("trace buffer: disabled records nothing and reads are empty", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith({ enabled: false, turnsPerThread: 20 });
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  expect(
    buffer.start({
      threadId: thread,
      dispatchKey: `${turn}:boundary.settle.after`,
      hook: "boundary.settle.after",
      now: T0,
    }),
  ).toBeUndefined();
  expect(buffer.turn(thread, turn)).toBeUndefined();
  expect(buffer.enabled()).toBe(false);
  expect(buffer.timings({})).toEqual({ traceEnabled: false, timings: [] });
});

test("trace buffer: the enabled value is read when a turn first appears", () => {
  const ids = fixedIdFactory();
  const { buffer, set } = bufferWith({ enabled: true, turnsPerThread: 20 });
  const thread = ids.next("thr");
  const first = ids.next("trn");
  const second = ids.next("trn");
  const third = ids.next("trn");
  turnPassed(buffer, thread, first, "ext-a", 1);
  set({ enabled: false, turnsPerThread: 20 });
  // 같은 Turn의 뒤 디스패치는 Turn이 처음 보일 때 읽은 값(켬)을 따른다
  turnPassed(buffer, thread, first, "ext-a", 2);
  // 읽기는 현재 값을 따른다. 꺼진 동안에는 Turn도 분포도 보이지 않는다
  expect(buffer.enabled()).toBe(false);
  expect(buffer.turn(thread, first)).toBeUndefined();
  expect(buffer.timings({})).toEqual({ traceEnabled: false, timings: [] });
  // 꺼진 동안 처음 보인 Turn은 다시 켜도 기록하지 않는다
  turnPassed(buffer, thread, second, "ext-a", 3);
  set({ enabled: true, turnsPerThread: 20 });
  turnPassed(buffer, thread, second, "ext-a", 4);
  // 켜진 뒤 처음 보인 Turn부터 기록한다
  turnPassed(buffer, thread, third, "ext-a", 5);
  expect(buffer.turn(thread, first)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 1,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
      {
        seq: 1,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 2,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
  expect(buffer.turn(thread, second)).toBeUndefined();
  expect(buffer.turn(thread, third)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 5,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
});

test("trace buffer: a turn outside the buffer reads as undefined", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  turnPassed(buffer, thread, turn, "ext-a", 1);
  expect(buffer.turn(ids.next("thr"), turn)).toBeUndefined();
  expect(buffer.turn(thread, ids.next("trn"))).toBeUndefined();
});

test("trace buffer: a turn keeps at most 5000 entries and an entry at most 256 handlers", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  for (let index = 0; index <= MAX_ENTRIES_PER_TURN; index += 1) {
    turnPassed(buffer, thread, turn, "ext-a", 0);
  }
  const retained = buffer.turn(thread, turn);
  expect(retained?.entries.length).toBe(MAX_ENTRIES_PER_TURN);
  expect(retained?.entries.at(-1)?.seq).toBe(MAX_ENTRIES_PER_TURN - 1);

  const other = ids.next("trn");
  const hits: Hit[] = Array.from({ length: MAX_HANDLERS_PER_ENTRY + 1 }, (_, index) => ({
    registrationId: `ext-${String(index)}`,
    durationMs: 1,
    result: "passed",
    startedAt: T0,
    size: 0,
    skippedBy: null,
    reason: null,
  }));
  dispatchHits(buffer, thread, `${other}:boundary.settle.after`, "boundary.settle.after", T0, hits);
  const capped = buffer.turn(thread, other);
  expect(capped?.entries.length).toBe(1);
  expect(capped?.entries[0]?.handlers.length).toBe(MAX_HANDLERS_PER_ENTRY);
  expect(capped?.entries[0]?.handlers.at(-1)).toEqual({
    registrationId: `ext-${String(MAX_HANDLERS_PER_ENTRY - 1)}`,
    ms: 1,
    result: "passed",
    atMs: 0,
    size: 0,
    skippedBy: null,
    reason: null,
  });
});

test("trace buffer: the least recently written thread is dropped past 32 threads", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const oldest = { thread: ids.next("thr"), turn: ids.next("trn") };
  const survivor = { thread: ids.next("thr"), turn: ids.next("trn") };
  const fillers = Array.from({ length: MAX_THREADS - 1 }, () => ({
    thread: ids.next("thr"),
    turn: ids.next("trn"),
  }));
  for (const pair of [oldest, survivor, ...fillers]) {
    turnPassed(buffer, pair.thread, pair.turn, "ext-a", 1);
  }
  expect(buffer.turn(oldest.thread, oldest.turn)).toBeUndefined();
  expect(buffer.turn(survivor.thread, survivor.turn)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-a",
            ms: 1,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
    ],
  });
});

test("trace buffer: forgetThread drops a thread's turns", () => {
  const ids = fixedIdFactory();
  const { buffer } = bufferWith(DEFAULT_TRACE_SETTINGS);
  const thread = ids.next("thr");
  const turn = ids.next("trn");
  turnPassed(buffer, thread, turn, "ext-a", 1);
  buffer.forgetThread(thread);
  expect(buffer.turn(thread, turn)).toBeUndefined();
});

test("trace settings: the policy reads x.operations.trace.* with the documented defaults", async () => {
  const off = await createOperationsHarness({ settings: { trace: { enabled: false } } });
  expect(off.policy.trace()).toEqual({ enabled: false, turnsPerThread: 20 });
  const defaults = await createOperationsHarness();
  expect(defaults.policy.trace()).toEqual(DEFAULT_TRACE_SETTINGS);
  expect(createStaticOperationsSettings().trace?.()).toEqual(DEFAULT_TRACE_SETTINGS);
});

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

test("trace: real dispatches through the host land in traceReadOf(host)", async () => {
  const { t } = await createOperationsHarness({ settings: { budgets: { chain: 100 } } });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "ext-tap", hooks: ["boundary.settle.after"] }, (g) => {
      g.on("boundary.settle.after", () => {});
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-first", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => {
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-chain", hooks: ["input.user.before"] }, (g) => {
      g.on("input.user.before", () => new Promise<never>(() => {}));
    }),
  );
  const turn = t.ids.next("trn");
  const step = t.ids.next("stp");

  // Turn은 이 디스패치(시각 0)에서 열린다. 뒤의 처리기는 5ms 뒤에 시작한다
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: turn, aborted: false },
    { threadId: thread, dispatchKey: `${turn}:boundary.settle.after` },
  );
  await t.timers.advance(5);
  await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: `${step}:tool.call.before:call_1`,
  });
  const pending = t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    {
      threadId: thread,
      dispatchKey: `${step}:input.user.before`,
      initial: { text: "hi", handled: false },
    },
  );
  await flushMicrotasks();
  await t.timers.advance(100);
  await pending;

  const trace = traceReadOf(t.host);
  expect(trace.enabled()).toBe(true);
  expect(trace.turn(thread, turn)).toEqual({
    traceEnabled: true,
    retained: true,
    entries: [
      {
        seq: 0,
        hook: "boundary.settle.after",
        step: 0,
        handlers: [
          {
            registrationId: "ext-tap",
            ms: 0,
            result: "passed",
            atMs: 0,
            size: 0,
            skippedBy: null,
            reason: null,
          },
        ],
      },
      {
        seq: 1,
        hook: "tool.call.before",
        step: 1,
        handlers: [
          {
            registrationId: "ext-first",
            ms: 0,
            result: "failed",
            atMs: 5,
            size: 0,
            skippedBy: null,
            reason: "threw",
          },
        ],
      },
      {
        seq: 2,
        hook: "input.user.before",
        step: 1,
        handlers: [
          {
            registrationId: "ext-chain",
            ms: 100,
            result: "failed",
            atMs: 5,
            size: 0,
            skippedBy: null,
            reason: "timeout",
          },
        ],
      },
    ],
  });
  expect(trace.timings({})).toEqual({
    traceEnabled: true,
    timings: [
      {
        hook: "boundary.settle.after",
        registrationId: "ext-tap",
        count: 1,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
        failures: 0,
      },
      {
        hook: "input.user.before",
        registrationId: "ext-chain",
        count: 1,
        p50Ms: 100,
        p95Ms: 100,
        maxMs: 100,
        failures: 1,
      },
      {
        hook: "tool.call.before",
        registrationId: "ext-first",
        count: 1,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
        failures: 1,
      },
    ],
  });
  expect(trace.timings({ registrationId: "ext-chain" }).timings).toEqual([
    {
      hook: "input.user.before",
      registrationId: "ext-chain",
      count: 1,
      p50Ms: 100,
      p95Ms: 100,
      maxMs: 100,
      failures: 1,
    },
  ]);
});
