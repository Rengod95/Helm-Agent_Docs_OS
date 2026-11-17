import { expect, test } from "bun:test";
import { FIRST_DENY, type AgentSpawnBeforePayload } from "@fresnel/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// M5e 스펙 §5.1 H-2: `tool.call.before`와 `agent.spawn.before`는 모든 핸들러를 돌린 뒤 `block` > `replace` > `ask`로 합친다.
// 다른 first 훅은 처음 결정에서 멈춘다.

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

async function setup() {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

test("ask then block: the block wins, and the handler after the ask decides it", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "asker", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => ({ ask: true, reason: "confirm the read" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "blocker", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => ({ block: true, reason: "no", terminate: false }));
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ block: true, reason: "no", terminate: false });
  expect(outcome.decidedBy?.extension).toBe("blocker");
  expect(outcome.substituted).toBe(false);
});

test("a block alone stops the dispatch, and the handler after it does not run", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "blocker", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("blocker");
        return { block: true, reason: "stop", terminate: false };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "after", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("after");
        return { ask: true, reason: "never reached" };
      });
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ block: true, reason: "stop", terminate: false });
  expect(calls).toEqual(["blocker"]);
});

test("replace then ask: the replace wins, and the ask after it still ran", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "replacer", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("replacer");
        return {
          replace: { content: [{ type: "text", text: "cached" }], isError: false },
          reason: "from the cache",
        };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "asker", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("asker");
        return { ask: true, reason: "confirm" };
      });
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({
    replace: { content: [{ type: "text", text: "cached" }], isError: false },
    reason: "from the cache",
  });
  expect(outcome.decidedBy?.extension).toBe("replacer");
  expect(calls).toEqual(["replacer", "asker"]);
});

test("ask then ask: the first ask's reason wins", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "first-asker", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => ({ ask: true, reason: "first reason" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "second-asker", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => ({ ask: true, reason: "second reason" }));
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ ask: true, reason: "first reason" });
  expect(outcome.decidedBy?.extension).toBe("first-asker");
});

test("an ask alone is the decision, and every handler after it ran on the original payload", async () => {
  const { t, thread } = await setup();
  const seen: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "asker", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", (payload) => {
        seen.push(payload);
        return { ask: true, reason: "confirm" };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "quiet", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", (payload) => {
        seen.push(payload);
        return undefined;
      });
    }),
  );
  const outcome = await t.host.dispatch("tool.call.before", toolCall, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ ask: true, reason: "confirm" });
  expect(outcome.decidedBy?.extension).toBe("asker");
  expect(seen).toEqual([toolCall, toolCall]);
});

test("an ask followed by a throwing handler is FIRST_DENY (the closed rule beats the ask)", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "asker", hooks: ["tool.call.before"], loadIndex: 0 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("asker");
        return { ask: true, reason: "confirm" };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "thrower", hooks: ["tool.call.before"], loadIndex: 1 }, (g) => {
      g.on("tool.call.before", () => {
        calls.push("thrower");
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "after", hooks: ["tool.call.before"], loadIndex: 2 }, (g) => {
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
  expect(outcome.decidedBy?.extension).toBe("thrower");
  expect(calls).toEqual(["asker", "thrower"]);
});

test("agent.spawn.before merges the same way: a replace after an ask wins", async () => {
  const { t, thread } = await setup();
  const spawn = {
    threadId: thread,
    requestId: "req-1",
    agent: "reviewer",
    task: "look at it",
    caller: "main",
    depth: 0,
    entry: "tool",
    background: false,
  } satisfies AgentSpawnBeforePayload;
  await t.host.install(
    makeUnit({ name: "asker", hooks: ["agent.spawn.before"], loadIndex: 0 }, (g) => {
      g.on("agent.spawn.before", () => ({ ask: true, reason: "confirm the spawn" }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "replacer", hooks: ["agent.spawn.before"], loadIndex: 1 }, (g) => {
      g.on("agent.spawn.before", () => ({ replace: { report: "done" }, reason: "known" }));
    }),
  );
  const outcome = await t.host.dispatch("agent.spawn.before", spawn, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ replace: { report: "done" }, reason: "known" });
  expect(outcome.decidedBy?.extension).toBe("replacer");
});

test("a first hook that is not merged still stops at its first decision", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "canceller", hooks: ["thread.switch.before"], loadIndex: 0 }, (g) => {
      g.on("thread.switch.before", () => {
        calls.push("canceller");
        return { cancel: true, reason: "busy" };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "after", hooks: ["thread.switch.before"], loadIndex: 1 }, (g) => {
      g.on("thread.switch.before", () => {
        calls.push("after");
        return undefined;
      });
    }),
  );
  const outcome = await t.host.dispatch(
    "thread.switch.before",
    { reason: "new" },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(outcome.decision).toEqual({ cancel: true, reason: "busy" });
  expect(calls).toEqual(["canceller"]);
});
