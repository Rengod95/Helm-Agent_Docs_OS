import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { BoundaryValue } from "@xeon/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import {
  assistantStop,
  makeUnit,
  rejectionOf,
  toolResultMessage,
  unsafeInput,
  userText,
} from "./fixtures/support.ts";

async function setup(strict = true) {
  const t = await createTestHost({ strict });
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

test("chain merge rejection skips", async () => {
  const { t, thread } = await setup();
  const seen: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "chain-bad", points: ["boundary.message.after"], loadIndex: 0 }, (g) => {
      g.on("boundary.message.after", () => ({ message: assistantStop }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "chain-good", points: ["boundary.message.after"], loadIndex: 1 }, (g) => {
      g.on("boundary.message.after", (_payload, current) => {
        seen.push(current.message);
        return { message: { ...userText, content: "edited" } };
      });
    }),
  );
  const outcome = await t.host.dispatch(
    "boundary.message.after",
    { message: userText },
    { threadId: thread, dispatchKey: "k", initial: { message: userText } },
  );
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["merge_rejected"]);
  expect(outcome.applied.map((ref) => ref.extension)).toEqual(["chain-good"]);
  expect(seen).toEqual([userText]);
  expect(outcome.value).toEqual({ message: { ...userText, content: "edited" } });
});

test("chain stop halts", async () => {
  const { t, thread } = await setup();
  const calls: string[] = [];
  await t.host.install(
    makeUnit({ name: "chain-h", points: ["input.user.before"], loadIndex: 0 }, (g) => {
      g.on("input.user.before", () => {
        calls.push("h");
        return { action: "handled" };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "chain-after", points: ["input.user.before"], loadIndex: 1 }, (g) => {
      g.on("input.user.before", () => {
        calls.push("after");
        return { action: "transform", text: "x" };
      });
    }),
  );
  const outcome = await t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    { threadId: thread, dispatchKey: "k", initial: { text: "hi", handled: false } },
  );
  expect(calls).toEqual(["h"]);
  expect(outcome.stopped).toBe(true);
  expect(outcome.value.handled).toBe(true);
});

test("chain payload stays original", async () => {
  const { t, thread } = await setup();
  const payload = { text: "hi", source: "interactive" as const };
  const seen: { payload: unknown; current: unknown }[] = [];
  await t.host.install(
    makeUnit({ name: "chain-one", points: ["input.user.before"], loadIndex: 0 }, (g) => {
      g.on("input.user.before", (p, current) => {
        seen.push({ payload: p, current });
        return { action: "transform", text: "one" };
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "chain-two", points: ["input.user.before"], loadIndex: 1 }, (g) => {
      g.on("input.user.before", (p, current) => {
        seen.push({ payload: p, current });
        return { action: "transform", text: "two" };
      });
    }),
  );
  const outcome = await t.host.dispatch("input.user.before", payload, {
    threadId: thread,
    dispatchKey: "k",
    initial: { text: "hi", handled: false },
  });
  expect(seen[0]?.payload).toBe(payload);
  expect(seen[1]?.payload).toBe(payload);
  expect(seen[1]?.current).toEqual({ text: "one", handled: false });
  expect(outcome.value.text).toBe("two");
});

function turnEndPayload(t: Awaited<ReturnType<typeof createTestHost>>) {
  return {
    stepIndex: 0,
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

test("boundary finalize once", async () => {
  const { t, thread } = await setup();
  const finalized: BoundaryValue[] = [];
  await t.host.install(
    makeUnit({ name: "chain-turn", points: ["boundary.step.after"], loadIndex: 0 }, (g) => {
      g.on("boundary.step.after", () => ({ continue: true }));
    }),
  );
  await t.host.install(
    makeUnit({ name: "chain-turn2", points: ["boundary.step.after"], loadIndex: 1 }, (g) => {
      g.on("boundary.step.after", () => ({ continue: false }));
    }),
  );
  const outcome = await t.host.dispatch("boundary.step.after", turnEndPayload(t), {
    threadId: thread,
    dispatchKey: "k",
    initial: { entries: [], continue: false },
    finalize: (value) => {
      finalized.push(value);
      return { ...value, entries: [] };
    },
  });
  expect(finalized).toEqual([{ entries: [], continue: false }]);
  expect(outcome.applied.length).toBe(2);
});

test("boundary finalize missing is a Bug", async () => {
  const { t, thread } = await setup();
  const error = await rejectionOf(() =>
    t.host.dispatch("boundary.step.after", turnEndPayload(t), {
      threadId: thread,
      dispatchKey: "k",
      initial: { entries: [], continue: false },
    }),
  );
  expect(error).toBeInstanceOf(Bug);
  expect(error instanceof Error && error.message).toContain("dispatch.finalize_missing");
});

test("chain has no next", async () => {
  const { t, thread } = await setup();
  const argCounts: number[] = [];
  const handler = (...args: readonly unknown[]): undefined => {
    argCounts.push(args.length);
    return undefined;
  };
  await t.host.install(
    makeUnit({ name: "chain-twice", points: ["input.user.before"] }, (g) => {
      g.on("input.user.before", handler);
      g.on("input.user.before", handler);
    }),
  );
  await t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    { threadId: thread, dispatchKey: "k", initial: { text: "hi", handled: false } },
  );
  // (payload, current, ctx) 셋뿐이다. next 인자는 없다. 같은 핸들러를 두 번 등록해도 각자 한 번씩 돈다
  expect(argCounts).toEqual([3, 3]);
});

test("payload violations are L1 bugs in strict mode", async () => {
  const { t, thread } = await setup();
  const error = await rejectionOf(() =>
    t.host.dispatch("input.user.before", unsafeInput({ text: 5 }), {
      threadId: thread,
      dispatchKey: "k",
      initial: { text: "x", handled: false },
    }),
  );
  expect(error instanceof Bug && error.message).toContain("dispatch.payload_invalid");
});

test("strict payloads are frozen", async () => {
  const { t, thread } = await setup();
  let frozen = false;
  await t.host.install(
    makeUnit({ name: "chain-freeze", points: ["input.user.before"] }, (g) => {
      g.on("input.user.before", (payload) => {
        frozen = Object.isFrozen(payload);
        return undefined;
      });
    }),
  );
  await t.host.dispatch(
    "input.user.before",
    { text: "hi", source: "interactive" },
    { threadId: thread, dispatchKey: "k", initial: { text: "hi", handled: false } },
  );
  expect(frozen).toBe(true);
});
