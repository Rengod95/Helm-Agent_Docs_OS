import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ResourceRecord, ResourceRegistry } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import {
  createLearningRunner,
  slotReader,
  type LearningRunner,
} from "../../src/assembly/learning.ts";

// 학습 그룹을 싣는 조립 코드의 단위 시험: 읽기 면 자리와 `/learning` 명령 실행기. 실제 엔진 위의 시험은 test/int/proposals.int.test.ts다.

const ids = fixedIdFactory(3);
const FIRST: ThreadId = ids.next("thr");
const LAST: ThreadId = ids.next("thr");
const SIGNAL = new AbortController().signal;

interface Seen {
  args: string;
  threadId: ThreadId | null;
  invocationId: string;
  signal: AbortSignal;
}

function registry(handler: (seen: Seen) => void, name = "learning"): ResourceRegistry {
  const record: ResourceRecord = {
    kind: "command",
    name,
    exposed: name,
    scopeId: "scope_x",
    extension: "learning",
    builtin: true,
    def: {
      handler: (
        args: string,
        ctx: { threadId: ThreadId | null; invocationId: string; signal: AbortSignal },
      ) => {
        handler({
          args,
          threadId: ctx.threadId,
          invocationId: ctx.invocationId,
          signal: ctx.signal,
        });
        return Promise.resolve();
      },
    },
  };
  return {
    list: (kind) => (kind === undefined || kind === "command" ? [record] : []),
    subscribe: () => () => undefined,
    setFlag: () => ({ ok: true, value: undefined }),
  };
}

function runnerOf(
  seen: Seen[],
  held: readonly ThreadId[],
  active: ThreadId | null,
): LearningRunner {
  const runner: LearningRunner = createLearningRunner({
    resources: () =>
      registry((call) => {
        seen.push(call);
        runner.report({ kind: "cancel", cancelled: true }, call.invocationId);
      }),
    ids: fixedIdFactory(7),
    heldThreads: () => held,
    activeThread: () => active,
  });
  return runner;
}

test("learning.runner runs the command in the preferred thread when this host holds it and returns the result of that invocation", async () => {
  const seen: Seen[] = [];
  const runner = runnerOf(seen, [FIRST, LAST], LAST);
  const ran = await runner.run("queue reject prop_1", FIRST, SIGNAL);
  expect(ran).toEqual({ kind: "report", report: { kind: "cancel", cancelled: true } });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.args).toBe("queue reject prop_1");
  expect(seen[0]?.threadId).toBe(FIRST);
  // 호출마다 새 invocationId를 만든다
  await runner.run("queue", FIRST, SIGNAL);
  expect(new Set(seen.map((call) => call.invocationId)).size).toBe(2);
});

test("learning.runner hands the caller's cancel signal to the command handler as the same object", async () => {
  const seen: Seen[] = [];
  const controller = new AbortController();
  await runnerOf(seen, [FIRST], FIRST).run("queue", FIRST, controller.signal);
  expect(seen[0]?.signal).toBe(controller.signal);
});

test("learning.runner falls back to the most recently opened thread and says unavailable when none is open", async () => {
  const seen: Seen[] = [];
  const fallback = await runnerOf(seen, [LAST], LAST).run("queue", FIRST, SIGNAL);
  expect(fallback.kind).toBe("report");
  expect(seen[0]?.threadId).toBe(LAST);
  const none = await runnerOf([], [], null).run("queue", undefined, SIGNAL);
  expect(none).toEqual({
    kind: "unavailable",
    detail: "no conversation is open to record the decision",
  });
});

test("learning.runner says unavailable when the command is not registered or returned nothing", async () => {
  const missing = createLearningRunner({
    resources: () => undefined,
    ids: fixedIdFactory(7),
    heldThreads: () => [FIRST],
    activeThread: () => FIRST,
  });
  expect(await missing.run("queue", undefined, SIGNAL)).toEqual({
    kind: "unavailable",
    detail: "the learning command is not registered",
  });
  const silent = createLearningRunner({
    resources: () => registry(() => undefined),
    ids: fixedIdFactory(7),
    heldThreads: () => [FIRST],
    activeThread: () => FIRST,
  });
  expect(await silent.run("queue", undefined, SIGNAL)).toEqual({
    kind: "unavailable",
    detail: "the learning command returned no result",
  });
});

test("learning.reader-slot: reads are store failures until the projection fills the slot", async () => {
  const slot: Parameters<typeof slotReader>[0] = { current: undefined };
  const reader = slotReader(slot);
  const before = await reader.listProposals({});
  expect(before).toEqual({
    ok: false,
    error: { kind: "learning.storeUnavailable", detail: "the learning projection is not ready" },
  });
  slot.current = {
    getProposal: () => Promise.resolve({ ok: true, value: undefined }),
    listProposals: () => Promise.resolve({ ok: true, value: [] }),
    getReviewByChild: () => Promise.resolve({ ok: true, value: undefined }),
    getReview: () => Promise.resolve({ ok: true, value: undefined }),
    listReviews: () => Promise.resolve({ ok: true, value: [] }),
  };
  expect(await reader.listProposals({})).toEqual({ ok: true, value: [] });
});

test("learning.runner leaves no result behind when the command handler throws", async () => {
  const stored: string[] = [];
  const runner: LearningRunner = createLearningRunner({
    resources: () =>
      registry((call) => {
        runner.report({ kind: "cancel", cancelled: true }, call.invocationId);
        stored.push(call.invocationId);
        throw new Error("boom");
      }),
    ids: fixedIdFactory(7),
    heldThreads: () => [FIRST],
    activeThread: () => FIRST,
  });
  let thrown = false;
  try {
    await runner.run("queue", FIRST, SIGNAL);
  } catch (error) {
    thrown = error instanceof Error;
  }
  expect(thrown).toBe(true);
  // 같은 id로 다시 보고하는 일이 없으니 남은 항목은 다음 실행에 섞이지 않는다
  const later = await runnerOf([], [FIRST], FIRST).run("queue", FIRST, SIGNAL);
  expect(later.kind).toBe("report");
  expect(stored).toHaveLength(1);
});
