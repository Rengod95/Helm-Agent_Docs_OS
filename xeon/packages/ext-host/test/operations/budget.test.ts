import { expect, test } from "bun:test";
import { FIRST_DENY, POINTS } from "@xeon/contracts/extensions";
import {
  awaitUser,
  budgetClassOf,
  budgetMsFrom,
  DEFAULT_BUDGETS_MS,
  runWithBudget,
  STREAM_TAP_POINTS,
} from "../../src/operations/index.ts";
import { fakeTimers, flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>();
}

function entry(point: keyof typeof POINTS) {
  return {
    point,
    scopeId: "x-ext",
    extension: "x-ext",
    layer: "plugin" as const,
    builtin: false,
    loadIndex: 0,
    seq: 1,
  };
}

test("budget: first timeout boundary 29999/30000", async () => {
  // 29,999ms에 끝나면 값을 쓴다
  const early = await createOperationsHarness();
  const thread = early.t.newThread();
  await early.t.host.openThread(thread);
  await early.t.host.install(
    makeUnit({ name: "bud-early", points: ["tool.call.before"] }, (g) => {
      g.on(
        "tool.call.before",
        () =>
          new Promise((resolve) =>
            early.t.timers.setTimer(29_999, () => resolve({ block: true, reason: "in time" })),
          ),
      );
    }),
  );
  const pendingEarly = early.t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  await early.t.timers.advance(30_000);
  expect((await pendingEarly).decision).toEqual({ block: true, reason: "in time" });

  // 30,000ms에도 끝나지 않으면 FIRST_DENY이고 signal은 TimeoutError로 abort된다
  const late = await createOperationsHarness();
  const lateThread = late.t.newThread();
  await late.t.host.openThread(lateThread);
  let signal: AbortSignal | undefined;
  await late.t.host.install(
    makeUnit({ name: "bud-late", points: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", (_payload, ctx) => {
        signal = ctx.signal;
        return new Promise<undefined>(() => {});
      });
    }),
  );
  const pendingLate = late.t.host.dispatch("tool.call.before", toolCall, {
    threadId: lateThread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  await late.t.timers.advance(29_999);
  expect(signal?.aborted).toBe(false);
  await late.t.timers.advance(1);
  const outcome = await pendingLate;
  expect(outcome.decision).toEqual(FIRST_DENY["tool.call.before"]);
  expect(outcome.failures[0]?.reason).toBe("timeout");
  expect(signal?.aborted).toBe(true);
  expect(signal?.reason).toBeInstanceOf(DOMException);
  expect(signal?.reason instanceof DOMException && signal.reason.name).toBe("TimeoutError");
});

test("budget: chain timeout skips only that patch", async () => {
  const harness = await createOperationsHarness({ settings: { budgets: { chain: 100 } } });
  const { t } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "bud-slow", points: ["input.user.before"], loadIndex: 0 }, (g) => {
      g.on("input.user.before", () => new Promise<undefined>(() => {}));
    }),
  );
  await t.host.install(
    makeUnit({ name: "bud-next", points: ["input.user.before"], loadIndex: 1 }, (g) => {
      g.on("input.user.before", (_payload, current) => {
        seen.push(current);
        return { action: "transform", text: "done" };
      });
    }),
  );
  const pending = t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    { threadId: thread, dispatchKey: "k", initial: { text: "hi", handled: false } },
  );
  await flushMicrotasks();
  await t.timers.advance(100);
  const outcome = await pending;
  expect(seen).toEqual([{ text: "hi", handled: false }]);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["timeout"]);
  expect(outcome.value.text).toBe("done");
});

test("budget: waiting for the user is not counted", async () => {
  const timers = fakeTimers();
  const deps = { now: timers.now, setTimer: timers.setTimer };
  const pending = runWithBudget(
    async (_signal, gate) => {
      await new Promise<void>((resolve) => timers.setTimer(10_000, resolve));
      await awaitUser(gate, () => new Promise<void>((resolve) => timers.setTimer(60_000, resolve)));
      await new Promise<void>((resolve) => timers.setTimer(10_000, resolve));
      return "done";
    },
    30_000,
    deps,
  );
  await flushMicrotasks();
  await timers.advance(80_000);
  const outcome = await pending;
  expect(outcome).toEqual({ kind: "settled", value: "done", activeMs: 20_000 });

  // 대기 없이 같은 시간을 쓰면 예산 초과다
  const timers2 = fakeTimers();
  const second = runWithBudget(
    async () => {
      await new Promise<void>((resolve) => timers2.setTimer(40_000, resolve));
      return "late";
    },
    30_000,
    { now: timers2.now, setTimer: timers2.setTimer },
  );
  await flushMicrotasks();
  await timers2.advance(40_000);
  expect((await second).kind).toBe("timeout");
});

test("budget: nested pause counts depth", async () => {
  const timers = fakeTimers();
  const deps = { now: timers.now, setTimer: timers.setTimer };
  const gateBox: { current?: { pause(): void; resume(): void; readonly remainingMs: number } } = {};
  const finish = deferred<string>();
  const pending = runWithBudget(
    async (_signal, gate) => {
      gateBox.current = gate;
      return finish.promise;
    },
    1_000,
    deps,
  );
  await flushMicrotasks();
  await timers.advance(400);
  const gate = gateBox.current;
  expect(gate?.remainingMs).toBe(600);
  gate?.pause();
  gate?.pause();
  await timers.advance(5_000);
  expect(gate?.remainingMs).toBe(600);
  gate?.resume();
  // 한 번 풀었을 뿐이라 여전히 멈춰 있다
  await timers.advance(5_000);
  expect(gate?.remainingMs).toBe(600);
  gate?.resume();
  await timers.advance(599);
  expect(gate?.remainingMs).toBe(1);
  finish.resolve("ok");
  expect((await pending).kind).toBe("settled");
});

test("budget: late result is discarded", async () => {
  const timers = fakeTimers();
  const deps = { now: timers.now, setTimer: timers.setTimer };
  const gate = deferred<string>();
  const pending = runWithBudget(() => gate.promise, 50, deps);
  await flushMicrotasks();
  await timers.advance(50);
  const outcome = await pending;
  expect(outcome).toEqual({ kind: "timeout", budgetMs: 50 });
  gate.resolve("too late");
  await flushMicrotasks();
  expect(timers.pendingTimers()).toBe(0);

  const failing = deferred<string>();
  const second = runWithBudget(() => failing.promise, 50, deps);
  await flushMicrotasks();
  await timers.advance(50);
  expect((await second).kind).toBe("timeout");
  failing.resolve("ignored");
  await flushMicrotasks();
});

test("budget: shutdown and stream classes", () => {
  expect(DEFAULT_BUDGETS_MS).toEqual({
    first: 30_000,
    chain: 10_000,
    tap: 5_000,
    streamTap: 1_000,
    shutdown: 2_000,
    setup: 10_000,
    hook: 30_000,
  });
  expect(budgetClassOf(POINTS["session.shutdown"])).toBe("shutdown");
  expect(budgetClassOf(POINTS["boundary.message.update"])).toBe("streamTap");
  expect(budgetClassOf(POINTS["boundary.settle.after"])).toBe("tap");
  expect(budgetClassOf(POINTS["tool.call.before"])).toBe("first");
  expect(budgetClassOf(POINTS["boundary.step.after"])).toBe("chain");
  // collect는 값을 만드는 지점이라 chain 예산을 쓴다. guard는 first, lifecycle은 tap이다
  expect(budgetClassOf(POINTS["input.agent.before"])).toBe("chain");
  expect(budgetClassOf(POINTS["guard.model.before"])).toBe("first");
  expect(budgetClassOf(POINTS["lifecycle.agent.settled"])).toBe("tap");
  // detached tap도 예산을 받는다
  expect(budgetClassOf(POINTS["request.thinking.after"])).toBe("tap");
  expect(STREAM_TAP_POINTS).toEqual([
    "boundary.message.update",
    "request.stream",
    "tool.execution.update",
  ]);
  const budgetOf = budgetMsFrom(() => DEFAULT_BUDGETS_MS);
  expect(budgetOf(entry("session.shutdown"))).toBe(2_000);
  expect(budgetOf(entry("tool.call.before"))).toBe(30_000);
});

test("budget: session.shutdown handler is cut at 2000ms", async () => {
  const harness = await createOperationsHarness();
  const { t } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "bud-shutdown", points: ["session.shutdown"] }, (g) => {
      g.on("session.shutdown", () => new Promise<void>(() => {}));
    }),
  );
  const pending = t.host.dispatch(
    "session.shutdown",
    { reason: "quit" },
    { threadId: thread, dispatchKey: "k" },
  );
  await flushMicrotasks();
  await t.timers.advance(1_999);
  await t.timers.advance(1);
  const outcome = await pending;
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["timeout"]);
});

test("budget: drive has no time budget", async () => {
  const harness = await createOperationsHarness();
  const { t } = harness;
  const thread = t.newThread();
  const abortions: string[] = [];
  const gate = deferred<void>();
  await t.host.install(
    makeUnit({ name: "bud-drive", kind: "group", usesDrive: true }, (g) => {
      g.drive(async (loop) => {
        loop.signal.addEventListener("abort", () => abortions.push("aborted"));
        await gate.promise;
      });
    }),
  );
  await t.host.openThread(thread);
  await flushMicrotasks(100);
  await t.timers.advance(600_000);
  expect(abortions).toEqual([]);
  gate.resolve();
  await t.settled();
});

test("budget: outer abort is aborted not failure", async () => {
  const timers = fakeTimers();
  const deps = { now: timers.now, setTimer: timers.setTimer };
  const controller = new AbortController();
  const pending = runWithBudget(
    () => new Promise<string>(() => {}),
    1_000,
    deps,
    controller.signal,
  );
  await flushMicrotasks();
  controller.abort(new Error("user stop"));
  const outcome = await pending;
  expect(outcome.kind).toBe("aborted");
  expect(timers.pendingTimers()).toBe(0);
  // 이미 중단된 신호로 시작하면 work를 부르지 않는다
  let called = false;
  const second = await runWithBudget(
    () => {
      called = true;
      return "x";
    },
    1_000,
    deps,
    controller.signal,
  );
  expect(second.kind).toBe("aborted");
  expect(called).toBe(false);
});

test("budget: null budget never times out", async () => {
  const timers = fakeTimers();
  const deps = { now: timers.now, setTimer: timers.setTimer };
  const gate = deferred<string>();
  const pending = runWithBudget(() => gate.promise, null, deps);
  await flushMicrotasks();
  await timers.advance(600_000);
  expect(timers.pendingTimers()).toBe(0);
  gate.resolve("ok");
  expect(await pending).toEqual({ kind: "settled", value: "ok", activeMs: 600_000 });
});
