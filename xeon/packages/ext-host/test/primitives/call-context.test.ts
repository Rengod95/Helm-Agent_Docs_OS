import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { hostOf, type ScopeCallContext, type ScopeHostApi } from "../../src/primitives/index.ts";
import { createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import { createOperationsHarness } from "../operations/support/harness.ts";
import { makeGroupUnit, makeUnit } from "./fixtures/support.ts";

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

test("callContext is the on context with thread, point and a live signal inside a handler", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: (ScopeCallContext | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "cc-on", points: ["tool.call.before"] }, (g) => {
      const host = hostOf(g);
      seen.push(host.callContext());
      g.on("tool.call.before", async () => {
        await Promise.resolve();
        seen.push(host.callContext());
        return undefined;
      });
    }),
  );
  await t.host.dispatch("tool.call.before", toolCall, { threadId: thread, dispatchKey: "k" });
  // setup 안은 문맥이 없고, 핸들러 안은 await 뒤에도 on 문맥이다
  expect(seen[0]).toBeUndefined();
  const inside = seen[1];
  expect(inside?.kind).toBe("on");
  expect(inside?.threadId).toBe(thread);
  expect(inside?.point).toBe("tool.call.before");
  expect(inside?.signal.aborted).toBe(false);
});

test("callContext is undefined outside on and drive after setup", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  let host: ScopeHostApi | undefined;
  await t.host.install(
    makeUnit({ name: "cc-out", points: ["tool.call.before"] }, (g) => {
      host = hostOf(g);
    }),
  );
  expect(host?.callContext()).toBeUndefined();
});

test("callContext is the drive context with the lease signal, and cut inside turn and spawn", async () => {
  const inTurn: { host: ScopeHostApi | undefined; seen: (ScopeCallContext | undefined)[] } = {
    host: undefined,
    seen: [],
  };
  const t = await createTestHost({
    loop: {
      runTurn: () => {
        inTurn.seen.push(inTurn.host?.callContext());
        return Promise.resolve({
          outcome: { turnId: t.ids.next("trn"), status: "completed" as const },
          usage: null,
        });
      },
      runSpawn: () => {
        inTurn.seen.push(inTurn.host?.callContext());
        return Promise.resolve({
          outcome: { childThreadId: t.ids.next("thr"), status: "completed" as const },
          usage: null,
        });
      },
    },
  });
  const thread = t.newThread();
  const driveSeen: { context: ScopeCallContext | undefined; loopSignal: AbortSignal | undefined } =
    { context: undefined, loopSignal: undefined };
  await t.host.install(
    makeGroupUnit({ name: "cc-drive" }, (g) => {
      const host = hostOf(g);
      inTurn.host = host;
      g.drive(async (loop) => {
        driveSeen.context = host.callContext();
        driveSeen.loopSignal = loop.signal;
        await loop.turn({ input: { kind: "user", content: "go" } });
        await loop.spawn({ agent: "worker", task: "child" });
        inTurn.seen.push(host.callContext());
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(driveSeen.context?.kind).toBe("drive");
  expect(driveSeen.context?.threadId).toBe(thread);
  expect(driveSeen.context?.point).toBeUndefined();
  expect(driveSeen.context?.signal).toBe(driveSeen.loopSignal);
  // turn과 spawn 안은 문맥이 끊기고(처음 둘), drive 함수로 돌아오면 다시 drive 문맥이다
  expect(inTurn.seen.map((c) => c?.kind)).toEqual([undefined, undefined, "drive"]);
});

test("callContext only reports the scope that owns g", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const owner: { host: ScopeHostApi | undefined } = { host: undefined };
  const seen: { own: ThreadId | undefined; other: ThreadId | undefined } = {
    own: undefined,
    other: undefined,
  };
  await t.host.install(
    makeUnit({ name: "cc-owner" }, (g) => {
      owner.host = hostOf(g);
    }),
  );
  await t.host.install(
    makeUnit({ name: "cc-caller", points: ["tool.call.before"] }, (g) => {
      const host = hostOf(g);
      g.on("tool.call.before", () => {
        seen.own = host.callContext()?.threadId;
        seen.other = owner.host?.callContext()?.threadId;
        return undefined;
      });
    }),
  );
  await t.host.dispatch("tool.call.before", toolCall, { threadId: thread, dispatchKey: "k" });
  expect(seen).toEqual({ own: thread, other: undefined });
});

test("a timed-out handler's context reports an aborted signal", async () => {
  const { t } = await createOperationsHarness();
  const thread = t.newThread();
  await t.host.openThread(thread);
  let context: ScopeCallContext | undefined;
  await t.host.install(
    makeUnit({ name: "cc-timeout", points: ["tool.call.before"] }, (g) => {
      const host = hostOf(g);
      g.on("tool.call.before", () => {
        context = host.callContext();
        return new Promise<undefined>(() => {});
      });
    }),
  );
  const pending = t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  await flushMicrotasks();
  expect(context?.signal.aborted).toBe(false);
  await t.timers.advance(30_000);
  await pending;
  expect(context?.signal.aborted).toBe(true);
});
