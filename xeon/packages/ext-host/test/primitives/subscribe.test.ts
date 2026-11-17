import { expect, test } from "bun:test";
import { attempt } from "@fresnel/contracts";
import type { EventEnvelope } from "@fresnel/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import { PrimitiveError } from "../../src/primitives/errors.ts";
import { makeUnit } from "./fixtures/support.ts";

// M5e 스펙 §4.4.1 `g.subscribe`. 이벤트 하나마다 `g.on` 등록을 하나 하고, 핸들러 결과는 무시하며, 고빈도 이벤트에만 표본 추출을 준다.

const noop = (): void => undefined;
const settledPayload = (t: Awaited<ReturnType<typeof createTestHost>>) => ({
  turnId: t.ids.next("trn"),
  aborted: false,
});
const SHUTDOWN = { reason: "quit" } as const;
const TOOL_UPDATE = {
  toolCallId: "call_1",
  toolName: "read",
  args: { path: "a" },
  partialResult: { content: [{ type: "text", text: "x" }], details: null },
};

test("subscribe receives an envelope for each of two events with the event, thread, key, and payload", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: EventEnvelope[] = [];
  await t.host.install(
    makeUnit(
      { name: "sub-two", hooks: ["boundary.settle.after", "thread.shutdown"], loadIndex: 0 },
      (g) => {
        g.subscribe(["boundary.settle.after", "thread.shutdown"], (event) => {
          seen.push(event);
        });
      },
    ),
  );
  const settled = settledPayload(t);
  await t.host.dispatch("boundary.settle.after", settled, {
    threadId: thread,
    dispatchKey: "k-settle",
  });
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-down" });
  expect(seen.map((event) => [event.event, event.threadId, event.eventKey])).toEqual([
    ["boundary.settle.after", thread, "k-settle"],
    ["thread.shutdown", thread, "k-down"],
  ]);
  expect(seen[0]?.payload).toEqual(settled);
  expect(seen[1]?.payload).toEqual(SHUTDOWN);
  // 흐름 자리는 위치 표가 준다. 표가 자리를 주지 않는 이벤트에는 없다
  expect(seen[0]?.anchor).toBeUndefined();
});

test("a subscribed event carries its flow anchor from the position table", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: EventEnvelope[] = [];
  await t.host.install(
    makeUnit({ name: "sub-anchor", hooks: ["tool.execution.update"], loadIndex: 0 }, (g) => {
      g.subscribe(["tool.execution.update"], (event) => {
        seen.push(event);
      });
    }),
  );
  await t.host.dispatch("tool.execution.update", TOOL_UPDATE, {
    threadId: thread,
    dispatchKey: "k-anchor",
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.anchor).toEqual({ block: "tools", side: "after" });
});

test("a throwing subscriber does not change the other handlers or the dispatch outcome", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "sub-throws", hooks: ["boundary.settle.after"], loadIndex: 0 }, (g) => {
      g.subscribe(["boundary.settle.after"], () => {
        calls.push("subscriber");
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "sub-after", hooks: ["boundary.settle.after"], loadIndex: 1 }, (g) => {
      g.on("boundary.settle.after", () => {
        calls.push("after");
      });
    }),
  );
  const outcome = await t.host.dispatch("boundary.settle.after", settledPayload(t), {
    threadId: thread,
    dispatchKey: "k-throw",
  });
  expect(calls).toEqual(["subscriber", "after"]);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["threw"]);
  expect(outcome.failures[0]?.handler.extension).toBe("sub-throws");
});

test("the same dispatch key gives the same eventKey on redelivery", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const keys: string[] = [];
  await t.host.install(
    makeUnit({ name: "sub-key", hooks: ["thread.shutdown"], loadIndex: 0 }, (g) => {
      g.subscribe(["thread.shutdown"], (event) => {
        keys.push(event.eventKey);
      });
    }),
  );
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-same" });
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-same" });
  expect(keys).toEqual(["k-same", "k-same"]);
});

test("the payload handed to a subscriber is frozen", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const frozen: boolean[] = [];
  const mutations: string[] = [];
  await t.host.install(
    makeUnit({ name: "sub-frozen", hooks: ["thread.shutdown"], loadIndex: 0 }, (g) => {
      g.subscribe(["thread.shutdown"], (event) => {
        frozen.push(Object.isFrozen(event.payload));
        const write = attempt(() => Object.assign(event.payload, { reason: "reload" }));
        mutations.push(write.ok ? "written" : "refused");
      });
    }),
  );
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-fz" });
  expect(frozen).toEqual([true]);
  expect(mutations).toEqual(["refused"]);
});

test('"all" subscribes to the declared event hooks only, and ignores declared non-event hooks', async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: string[] = [];
  await t.host.install(
    makeUnit(
      {
        name: "sub-all",
        hooks: ["boundary.settle.after", "thread.shutdown", "tool.call.before"],
        loadIndex: 0,
      },
      (g) => {
        g.subscribe("all", (event) => {
          seen.push(event.event);
        });
      },
    ),
  );
  await t.host.dispatch("boundary.settle.after", settledPayload(t), {
    threadId: thread,
    dispatchKey: "k-all-1",
  });
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-all-2" });
  expect(seen).toEqual(["boundary.settle.after", "thread.shutdown"]);
});

test("an undeclared event is refused the same way g.on refuses it", async () => {
  const t = await createTestHost();
  const refused: string[] = [];
  await t.host.install(
    makeUnit({ name: "sub-undeclared", hooks: ["boundary.settle.after"], loadIndex: 0 }, (g) => {
      const tried = attempt(() => g.subscribe(["thread.shutdown"], () => undefined));
      if (!tried.ok && tried.error.cause instanceof PrimitiveError) {
        refused.push(tried.error.cause.code);
      }
    }),
  );
  expect(refused).toEqual(["hook_undeclared"]);
});

test('sample "coalesce" is refused for an event that is not high-frequency', async () => {
  const t = await createTestHost();
  const refused: string[] = [];
  await t.host.install(
    makeUnit({ name: "sub-plain", hooks: ["boundary.settle.after"], loadIndex: 0 }, (g) => {
      const tried = attempt(() =>
        g.subscribe(["boundary.settle.after"], () => undefined, { sample: "coalesce" }),
      );
      if (!tried.ok && tried.error.cause instanceof PrimitiveError) {
        refused.push(tried.error.cause.code);
      }
    }),
  );
  expect(refused).toEqual(["subscribe_not_high_frequency"]);
});

test('sample "coalesce" delivers the last of the events that arrived while the subscriber was busy, with dropped', async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const delivered: { readonly key: string; readonly dropped: number | undefined }[] = [];
  let release: () => void = noop;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await t.host.install(
    makeUnit({ name: "sub-coalesce", hooks: ["tool.execution.update"], loadIndex: 0 }, (g) => {
      g.subscribe(
        ["tool.execution.update"],
        async (event) => {
          delivered.push({ key: event.eventKey, dropped: event.dropped });
          if (first) {
            first = false;
            await gate;
          }
        },
        { sample: "coalesce" },
      );
    }),
  );
  await t.host.dispatch("tool.execution.update", TOOL_UPDATE, {
    threadId: thread,
    dispatchKey: "c1",
  });
  await t.host.dispatch("tool.execution.update", TOOL_UPDATE, {
    threadId: thread,
    dispatchKey: "c2",
  });
  await t.host.dispatch("tool.execution.update", TOOL_UPDATE, {
    threadId: thread,
    dispatchKey: "c3",
  });
  release();
  await t.settled();
  expect(delivered).toEqual([
    { key: "c1", dropped: 0 },
    { key: "c3", dropped: 1 },
  ]);
});

test("unsubscribe stops deliveries", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: string[] = [];
  let stop: () => void = noop;
  await t.host.install(
    makeUnit({ name: "sub-off", hooks: ["thread.shutdown"], loadIndex: 0 }, (g) => {
      stop = g.subscribe(["thread.shutdown"], (event) => {
        seen.push(event.eventKey);
      });
    }),
  );
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-on" });
  stop();
  await t.host.dispatch("thread.shutdown", SHUTDOWN, { threadId: thread, dispatchKey: "k-off" });
  expect(seen).toEqual(["k-on"]);
});
