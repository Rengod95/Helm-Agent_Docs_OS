import { expect, test } from "bun:test";
import { FIRST_DENY } from "@xeon/contracts/extensions";
import { createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import type { DispatchPolicy } from "../../src/primitives/index.ts";
import { makeUnit, returning } from "./fixtures/support.ts";

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

async function setup(policy?: DispatchPolicy) {
  const t = await createTestHost(policy === undefined ? {} : { policy });
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

test("first throw yields FIRST_DENY", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "first-a", points: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("a");
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "first-b", points: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("b");
        return undefined;
      });
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual(FIRST_DENY["tool.call.before"]);
  expect(outcome.substituted).toBe(true);
  expect(outcome.decidedBy?.extension).toBe("first-a");
  expect(calls).toEqual(["a"]);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["threw"]);
});

test.each([0, "", null, false, { block: false }])("first %p is not a decision", async (bad) => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "first-bad", points: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", returning(bad));
    }),
  );
  await t.host.install(
    makeUnit({ name: "first-after", points: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("after");
        return undefined;
      });
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual(FIRST_DENY["tool.call.before"]);
  expect(outcome.substituted).toBe(true);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["result_invalid"]);
  expect(calls).toEqual([]);
});

test("first undefined passes through", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "first-pass", points: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", () => undefined);
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toBeUndefined();
  expect(outcome.decidedBy).toBeNull();
  expect(outcome.substituted).toBe(false);
});

test("first returns the first valid decision and stops", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "first-deny", points: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("deny");
        return { block: true, reason: "no" };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "first-late", points: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("late");
        return undefined;
      });
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ block: true, reason: "no" });
  expect(outcome.decidedBy?.extension).toBe("first-deny");
  expect(calls).toEqual(["deny"]);
});

test("first timeout denies", async () => {
  const policy: DispatchPolicy = {
    tierOf: () => 0,
    budgetMs: () => 50,
    onHandlerFailure: () => {},
  };
  const { t, thread } = await setup(policy);
  let handlerSignal: AbortSignal | undefined;
  await t.host.install(
    makeUnit({ name: "first-slow", points: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", (_payload, ctx) => {
        handlerSignal = ctx.signal;
        return new Promise<undefined>(() => {});
      });
    }),
  );
  const pending = t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  await t.timers.advance(100);
  const outcome = await pending;
  expect(outcome.decision).toEqual(FIRST_DENY["tool.call.before"]);
  expect(outcome.substituted).toBe(true);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["timeout"]);
  expect(handlerSignal?.aborted).toBe(true);
  expect(handlerSignal?.reason).toBeInstanceOf(DOMException);
});

test("first handler that finishes within budget still counts", async () => {
  const policy: DispatchPolicy = {
    tierOf: () => 0,
    budgetMs: () => 50,
    onHandlerFailure: () => {},
  };
  const { t, thread } = await setup(policy);
  await t.host.install(
    makeUnit({ name: "first-timely", points: ["tool.call.before"] }, (g) => {
      g.on(
        "tool.call.before",
        () =>
          new Promise((resolve) =>
            t.timers.setTimer(49, () => resolve({ block: true, reason: "late but ok" })),
          ),
      );
    }),
  );
  const pending = t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  await t.timers.advance(60);
  const outcome = await pending;
  expect(outcome.decision).toEqual({ block: true, reason: "late but ok" });
  expect(outcome.substituted).toBe(false);
});
