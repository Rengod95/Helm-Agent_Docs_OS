import { expect, test } from "bun:test";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { FIRST_DENY } from "@xeon/contracts/extensions";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

const beforeAgentStart = { prompt: "hi", systemPrompt: "sys", systemPromptOptions: {} };
const hint = (content: string) => ({
  customType: "grp.helm.hint.added",
  content,
  display: true,
});

function compactPayload(threadId: ThreadId, firstKeptEventId: EventId) {
  return {
    threadId,
    reason: "manual" as const,
    willRetry: false,
    preparation: {
      firstKeptEventId,
      tokensBefore: 1,
      isSplitTurn: false,
      previousSummary: null,
      messagesToSummarize: 1,
    },
    instructions: null,
  };
}

async function setup() {
  const t = await createTestHost({});
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

test("collect: every handler gets the original payload and no current, contributions merge once in order", async () => {
  const { t, thread } = await setup();
  const seenArgs: number[] = [];
  const contributor = (
    name: string,
    loadIndex: number,
    result: () => { message?: ReturnType<typeof hint>; systemPrompt?: string } | undefined,
  ) =>
    t.host.install(
      makeUnit({ name, points: ["input.agent.before"], loadIndex }, (g) => {
        g.on("input.agent.before", (...args) => {
          seenArgs.push(args.length);
          return result();
        });
      }),
    );
  await contributor("col-a", 0, () => ({ message: hint("a"), systemPrompt: "first" }));
  await contributor("col-b", 1, () => undefined);
  await contributor("col-c", 2, () => ({ message: hint("c"), systemPrompt: "last" }));
  const outcome = await t.host.dispatch("input.agent.before", beforeAgentStart, {
    threadId: thread,
    dispatchKey: "k",
    initial: { messages: [], systemPrompt: "sys" },
  });
  expect(seenArgs).toEqual([2, 2, 2]);
  expect(outcome.fold).toBe("collect");
  expect(outcome.value.messages.map((m) => m.content)).toEqual(["a", "c"]);
  expect(outcome.value.systemPrompt).toBe("last");
  expect(outcome.contributed.map((ref) => ref.extension)).toEqual(["col-a", "col-c"]);
  expect(outcome.failures).toEqual([]);
});

test("collect is fail-open: a throwing handler loses only its contribution", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "col-throw", points: ["session.resources"], loadIndex: 0 }, (g) => {
      g.on("session.resources", () => {
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "col-ok", points: ["session.resources"], loadIndex: 1 }, (g) => {
      g.on("session.resources", () => ({ skillPaths: ["/s"] }));
    }),
  );
  const outcome = await t.host.dispatch(
    "session.resources",
    { cwd: "/work", reason: "startup" },
    {
      threadId: thread,
      dispatchKey: "k",
      initial: { skillPaths: ["/base"], promptPaths: [], themePaths: [] },
    },
  );
  expect(outcome.value).toEqual({ skillPaths: ["/base", "/s"], promptPaths: [], themePaths: [] });
  expect(outcome.contributed.map((ref) => ref.extension)).toEqual(["col-ok"]);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["threw"]);
});

test("collect with strict checks drops a contribution that breaks the result schema", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "col-bad", points: ["input.agent.before"], loadIndex: 0 }, (g) => {
      g.on("input.agent.before", () => {
        const bad: unknown = { systemPrompt: 5 };
        return Object.assign({}, bad);
      });
    }),
  );
  const outcome = await t.host.dispatch("input.agent.before", beforeAgentStart, {
    threadId: thread,
    dispatchKey: "k",
    initial: { messages: [], systemPrompt: "sys" },
  });
  expect(outcome.value).toEqual({ messages: [], systemPrompt: "sys" });
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["result_invalid"]);
});

test("session.compact.before is fail-open: a throwing handler is skipped and the next decides", async () => {
  const { t, thread } = await setup();
  const payload = compactPayload(thread, t.ids.next("evt"));
  await t.host.install(
    makeUnit({ name: "cmp-throw", points: ["session.compact.before"], loadIndex: 0 }, (g) => {
      g.on("session.compact.before", () => {
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "cmp-cancel", points: ["session.compact.before"], loadIndex: 1 }, (g) => {
      g.on("session.compact.before", () => ({ cancel: true, reason: "later" }));
    }),
  );
  const outcome = await t.host.dispatch("session.compact.before", payload, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(outcome.decision).toEqual({ cancel: true, reason: "later" });
  expect(outcome.substituted).toBe(false);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["threw"]);
});

test("session.compact.before with only a throwing handler gives no decision, never a deny", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "cmp-only", points: ["session.compact.before"], loadIndex: 0 }, (g) => {
      g.on("session.compact.before", () => {
        throw new Error("boom");
      });
    }),
  );
  const outcome = await t.host.dispatch(
    "session.compact.before",
    compactPayload(thread, t.ids.next("evt")),
    { threadId: thread, dispatchKey: "k" },
  );
  expect(outcome.decision).toBeUndefined();
  expect(outcome.substituted).toBe(false);
});

test("guard points are fail-closed", async () => {
  const { t, thread } = await setup();
  await t.host.install(
    makeUnit({ name: "grd-throw", points: ["guard.tool.before"], loadIndex: 0 }, (g) => {
      g.on("guard.tool.before", () => {
        throw new Error("boom");
      });
    }),
  );
  const outcome = await t.host.dispatch(
    "guard.tool.before",
    { toolCallId: "call_1", toolName: "read", input: { path: "a" } },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(outcome.decision).toEqual(FIRST_DENY["guard.tool.before"]);
  expect(outcome.substituted).toBe(true);
});

test("a guard handler can block with a reason and no handler means pass", async () => {
  const { t, thread } = await setup();
  const payload = {
    threadId: thread,
    turnId: t.ids.next("trn"),
    target: "display" as const,
    content: "x",
  };
  const pass = await t.host.dispatch("guard.output.before", payload, {
    threadId: thread,
    dispatchKey: "k",
  });
  expect(pass.decision).toBeUndefined();
  await t.host.install(
    makeUnit({ name: "grd-block", points: ["guard.output.before"], loadIndex: 0 }, (g) => {
      g.on("guard.output.before", () => ({ block: true, reason: "no" }));
    }),
  );
  const blocked = await t.host.dispatch("guard.output.before", payload, {
    threadId: thread,
    dispatchKey: "k2",
  });
  expect(blocked.decision).toEqual({ block: true, reason: "no" });
});

test("lifecycle points dispatch as tap and fail open", async () => {
  const { t, thread } = await setup();
  const seen: string[] = [];
  await t.host.install(
    makeUnit({ name: "lc-throw", points: ["lifecycle.lease.rejected"], loadIndex: 0 }, (g) => {
      g.on("lifecycle.lease.rejected", () => {
        throw new Error("boom");
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "lc-ok", points: ["lifecycle.lease.rejected"], loadIndex: 1 }, (g) => {
      g.on("lifecycle.lease.rejected", (payload) => {
        seen.push(payload.groupId);
      });
    }),
  );
  const outcome = await t.host.dispatch(
    "lifecycle.lease.rejected",
    { groupId: "helm", reason: "wait_limit", requestSeq: 2 },
    { threadId: thread, dispatchKey: "evt_1" },
  );
  expect(outcome.fold).toBe("tap");
  expect(seen).toEqual(["helm"]);
  expect(outcome.failures.map((failure) => failure.reason)).toEqual(["threw"]);
});
