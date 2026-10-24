import { expect, test } from "bun:test";
import { createTestHost } from "../../src/testing/index.ts";
import type { DispatchPolicy, HandlerFailure } from "../../src/primitives/index.ts";
import { makeUnit } from "./fixtures/support.ts";

/** () => number는 () => void 자리에 들어간다. 런타임에는 값이 돌아간다 */
function noisyTap(effect: () => unknown): () => void {
  return () => {
    effect();
    return 5;
  };
}

async function setup() {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

function settledPayload(t: Awaited<ReturnType<typeof createTestHost>>) {
  return { turnId: t.ids.next("trn"), aborted: false };
}

test("tap continues after throw", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "tap-a", points: ["agent_settled"], loadIndex: 0 }, (g) => {
      g.on("agent_settled", () => {
        calls.push("a");
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "tap-b", points: ["agent_settled"], loadIndex: 1 }, (g) => {
      g.on("agent_settled", () => {
        calls.push("b");
      });
    }),
  );
  const outcome = await t.host.dispatch("agent_settled", settledPayload(t), {
    threadId: thread,
    dispatchKey: "k1",
  });
  expect(calls).toEqual(["a", "b"]);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["threw"]);
  expect(outcome.failures[0]?.handler.extension).toBe("tap-a");
});

test("tap ignores returned value", async () => {
  const reasons: string[] = [];
  const settled: string[] = [];
  const policy: DispatchPolicy = {
    tierOf: () => 0,
    budgetMs: () => null,
    onHandlerFailure: (failure) => reasons.push(failure.reason),
    onHandlerSettled: (entry) => settled.push(entry.extension),
  };
  const t = await createTestHost({ policy });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "tap-val", points: ["agent_settled"], loadIndex: 0 }, (g) => {
      g.on(
        "agent_settled",
        noisyTap(() => calls.push("val")),
      );
    }),
  );
  await t.host.install(
    makeUnit({ name: "tap-next", points: ["agent_settled"], loadIndex: 1 }, (g) => {
      g.on("agent_settled", () => {
        calls.push("next");
      });
    }),
  );
  const outcome = await t.host.dispatch("agent_settled", settledPayload(t), {
    threadId: thread,
    dispatchKey: "k2",
  });
  expect(calls).toEqual(["val", "next"]);
  expect(outcome.failures).toEqual([]);
  expect(reasons).toEqual(["value_from_tap"]);
  expect(settled).toEqual(["tap-val", "tap-next"]);
});

test("policy run replaces own timer", async () => {
  const runs: string[] = [];
  const failures: HandlerFailure[] = [];
  const settled: number[] = [];
  const policy: DispatchPolicy = {
    tierOf: () => 0,
    budgetMs: () => 5,
    onHandlerFailure: (failure) => failures.push(failure),
    onHandlerSettled: (_entry, activeMs) => settled.push(activeMs),
    run: async (entry, work, outer) => {
      runs.push(entry.extension);
      if (outer?.aborted === true) return { kind: "aborted", reason: outer.reason };
      try {
        const value = await work(new AbortController().signal, {
          pause: () => {},
          resume: () => {},
        });
        return { kind: "settled", value, activeMs: 3 };
      } catch (error) {
        return { kind: "threw", error, activeMs: 1 };
      }
    },
  };
  const t = await createTestHost({ policy });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "tap-run", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", () => {});
    }),
  );
  await t.host.dispatch("agent_settled", settledPayload(t), {
    threadId: thread,
    dispatchKey: "k3",
  });
  expect(runs).toEqual(["tap-run"]);
  expect(t.timers.pendingTimers()).toBe(0);
  expect(settled).toEqual([3]);
  expect(failures).toEqual([]);
});

test("settled reported once per success", async () => {
  const settled: string[] = [];
  const failures: string[] = [];
  const policy: DispatchPolicy = {
    tierOf: () => 0,
    budgetMs: () => null,
    onHandlerFailure: (failure) => failures.push(failure.reason),
    onHandlerSettled: (entry) => settled.push(entry.extension),
  };
  const t = await createTestHost({ policy });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "ok-one", points: ["agent_settled"], loadIndex: 0 }, (g) => {
      g.on("agent_settled", () => {});
    }),
  );
  await t.host.install(
    makeUnit({ name: "bad-one", points: ["agent_settled"], loadIndex: 1 }, (g) => {
      g.on("agent_settled", () => {
        throw new Error("x");
      });
    }),
  );
  await t.host.dispatch("agent_settled", settledPayload(t), {
    threadId: thread,
    dispatchKey: "k4",
  });
  expect(settled).toEqual(["ok-one"]);
  expect(failures).toEqual(["threw"]);
});
