import { expect, test } from "bun:test";
import type { DispatchPolicy, HandlerFailure } from "../../src/primitives/index.ts";
import { createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

function infoPayload(thread: ReturnType<Host["newThread"]>) {
  return { threadId: thread, name: "renamed" };
}

/** 손으로 끝내는 약속 */
function gate(): { promise: Promise<void>; open: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: resolve };
}

function recordingPolicy(failures: HandlerFailure[], budget: number | null = null): DispatchPolicy {
  return {
    tierOf: () => 0,
    budgetMs: () => budget,
    onHandlerFailure: (failure) => {
      failures.push(failure);
    },
  };
}

test("detached tap returns before its handlers run and keeps their order", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const waiting = gate();
  const order: string[] = [];
  await t.host.install(
    makeUnit({ name: "dt-a", points: ["session_info_changed"], loadIndex: 0 }, (g) => {
      g.on("session_info_changed", async () => {
        order.push("a:start");
        await waiting.promise;
        order.push("a:end");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "dt-b", points: ["session_info_changed"], loadIndex: 1 }, (g) => {
      g.on("session_info_changed", () => {
        order.push("b");
      });
    }),
  );
  const outcome = await t.host.dispatch("session_info_changed", infoPayload(thread), {
    threadId: thread,
    dispatchKey: "k",
  });
  // 디스패치는 핸들러를 기다리지 않는다
  expect(outcome).toEqual({ fold: "tap", detached: true, failures: [] });
  expect(order).toEqual([]);
  await flushMicrotasks();
  expect(order).toEqual(["a:start"]);
  waiting.open();
  await t.settled();
  expect(order).toEqual(["a:start", "a:end", "b"]);
});

test("a late failure is reported to the policy only, not in the outcome", async () => {
  const failures: HandlerFailure[] = [];
  const t = await createTestHost({ policy: recordingPolicy(failures) });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "dt-fail", points: ["session_info_changed"] }, (g) => {
      g.on("session_info_changed", async () => {
        await Promise.resolve();
        throw new Error("late boom");
      });
    }),
  );
  const outcome = await t.host.dispatch("session_info_changed", infoPayload(thread), {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.failures).toEqual([]);
  expect(failures).toEqual([]);
  await t.settled();
  expect(failures.map((failure) => failure.reason)).toEqual(["threw"]);
  expect(failures[0]?.handler.extension).toBe("dt-fail");
  expect(t.diagnostics.some((d) => d.code === "handler_failed")).toBe(true);
});

test("closing the thread aborts a running detached handler and drops the rest without a failure report", async () => {
  const failures: HandlerFailure[] = [];
  const t = await createTestHost({ policy: recordingPolicy(failures) });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const waiting = gate();
  const calls: string[] = [];
  let signalAborted: boolean | undefined;
  await t.host.install(
    makeUnit({ name: "dt-slow", points: ["session_info_changed"], loadIndex: 0 }, (g) => {
      g.on("session_info_changed", async (_payload, ctx) => {
        calls.push("slow");
        await waiting.promise;
        signalAborted = ctx.signal.aborted;
        throw new Error("finished after the session ended");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "dt-next", points: ["session_info_changed"], loadIndex: 1 }, (g) => {
      g.on("session_info_changed", () => {
        calls.push("next");
      });
    }),
  );
  await t.host.dispatch("session_info_changed", infoPayload(thread), {
    threadId: thread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  expect(calls).toEqual(["slow"]);
  await t.host.closeThread(thread);
  waiting.open();
  await t.settled();
  expect(signalAborted).toBe(true);
  // 세션이 끝난 뒤의 결과는 버린다: 뒤 핸들러는 실행하지 않고 늦은 예외도 실패로 세지 않는다
  expect(calls).toEqual(["slow"]);
  expect(failures).toEqual([]);
});

test("a detached handler still gets the time budget", async () => {
  const failures: HandlerFailure[] = [];
  const t = await createTestHost({ policy: recordingPolicy(failures, 50) });
  const thread = t.newThread();
  await t.host.openThread(thread);
  let aborted = false;
  await t.host.install(
    makeUnit({ name: "dt-budget", points: ["session_info_changed"] }, (g) => {
      g.on("session_info_changed", (_payload, ctx) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<void>(() => {});
      });
    }),
  );
  await t.host.dispatch("session_info_changed", infoPayload(thread), {
    threadId: thread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  await t.timers.advance(60);
  await t.settled();
  expect(failures.map((failure) => failure.reason)).toEqual(["timeout"]);
  expect(aborted).toBe(true);
});

test("a thread that is not open can still receive a detached dispatch", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "dt-unopened", points: ["session_info_changed"] }, (g) => {
      g.on("session_info_changed", () => {
        calls.push("ran");
      });
    }),
  );
  await t.host.dispatch("session_info_changed", infoPayload(thread), {
    threadId: thread,
    dispatchKey: "k",
  });
  await t.settled();
  expect(calls).toEqual(["ran"]);
});
