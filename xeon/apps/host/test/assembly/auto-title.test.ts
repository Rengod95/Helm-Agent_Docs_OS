import { expect, test } from "bun:test";
import { err, ok, parse, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  DurableEventEnvelopeSchema,
  type DurableEventEnvelope,
  type ThreadSummaryRow,
} from "@xeon/contracts/records";
import type { AutoTitleDeps, TitleModelPort } from "@xeon/core-persistence";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import {
  startAutoTitle,
  titleModelFor,
  type TitleModelSkip,
} from "../../src/assembly/auto-title.ts";
import type { SessionLockPort } from "../../src/types.ts";
import { partial } from "../fixtures/unsafe.ts";

// M3-REQ-83, HS-73. 턴이 끝난 뒤 임시 제목만 모델로 바꾼다. 쓰기 소유가 없거나 모델을 쓸 수 없으면 건드리지 않는다.
// 모델은 가짜 포트다. 활성 가지의 첫 사용자·어시스턴트 텍스트는 가짜 세션의 항목 커밋으로 준다.

interface Logged {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: unknown;
}

function recorder(): { readonly logger: Logger; readonly lines: Logged[] } {
  const lines: Logged[] = [];
  const logger: Logger = {
    debug: (event, fields) => {
      lines.push({ level: "debug", event, fields });
    },
    info: (event, fields) => {
      lines.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      lines.push({ level: "warn", event, fields });
    },
    error: (event, fields) => {
      lines.push({ level: "error", event, fields });
    },
    child: () => logger,
  };
  return { logger, lines };
}

const ids = fixedIdFactory();
const clock: Clock = { now: () => 1_700_000_000_000 };
const THREAD: ThreadId = ids.next("thr");
const FIRST_INPUT = "빌드가 왜 느린지 알려 줘";

/** 저장소 커밋 하나. 이벤트 종류와 payload만 쓰고 나머지 칸은 채운다 */
function envelopeOf(kind: string, threadId: ThreadId, payload: unknown): DurableEventEnvelope {
  const parsed = parse(DurableEventEnvelopeSchema, {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: clock.now(),
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq: 1,
    parentId: null,
  });
  if (!parsed.ok) throw new Error(`the fixture envelope for ${kind} must be valid`);
  return parsed.value;
}

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** `item.recorded`의 payload: 사용자 텍스트 항목 하나 */
function userItemPayload(text: string): unknown {
  return {
    item: {
      itemId: ids.next("itm"),
      status: "completed",
      kind: "user",
      message: { role: "user", content: text, timestamp: clock.now() },
      requestId: null,
    },
  };
}

/** `item.recorded`의 payload: 어시스턴트 텍스트 항목 하나 */
function assistantItemPayload(text: string): unknown {
  return {
    item: {
      itemId: ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        api: "test",
        provider: "test",
        model: "tape",
        usage: USAGE,
        stopReason: "stop",
        timestamp: clock.now(),
      },
      partIds: [],
    },
  };
}

interface Harness {
  /** 커밋 묶음을 구독자에게 보낸다 */
  readonly emit: (events: readonly DurableEventEnvelope[]) => Promise<void>;
  /** thread의 저장된 제목을 바꾼다(사람의 이름 바꾸기나 첫 입력 제목) */
  setStoredTitle(title: string | null): void;
  readonly queries: { count: number };
  readonly branchReads: { count: number };
  readonly modelCalls: { system: string; user: string }[];
  readonly titleWrites: { threadId: ThreadId; title: string | null; requestKey: string }[];
  readonly logs: Logged[];
  readonly close: () => void;
}

/**
 * 시험 하네스. `branch`는 활성 가지의 항목 payload다(readBranch가 순서대로 준다). `modelFor`는 제목 모델을 정한다.
 * 소유가 없으면 `owned`를 거짓으로 둔다.
 */
function harness(options: {
  readonly title: string | null;
  readonly owned?: boolean;
  readonly branch?: readonly unknown[];
  readonly modelFor?: (threadId: ThreadId) => Result<TitleModelPort, TitleModelSkip>;
  readonly reply?: Result<string, { readonly kind: string }>;
}): Harness {
  const listeners: ((batch: {
    firstSeq: number;
    lastSeq: number;
    events: readonly DurableEventEnvelope[];
  }) => void)[] = [];
  const stored: { title: string | null } = { title: options.title };
  const queries = { count: 0 };
  const branchReads = { count: 0 };
  const modelCalls: { system: string; user: string }[] = [];
  const titleWrites: { threadId: ThreadId; title: string | null; requestKey: string }[] = [];
  const { logger, lines } = recorder();
  const model: TitleModelPort = {
    complete(input) {
      modelCalls.push({ system: input.system, user: input.user });
      return Promise.resolve(options.reply ?? ok('"빌드 속도 조사"\n두 번째 줄은 버린다'));
    },
  };
  const modelFor = options.modelFor ?? (() => ok(model));
  const session = partial<AutoTitleDeps["session"]>({
    readBranch: (threadId) => {
      branchReads.count += 1;
      const branch = options.branch ?? [];
      return (async function* items() {
        await Promise.resolve();
        for (const payload of branch) {
          yield ok(envelopeOf("item.recorded", threadId, payload));
        }
      })();
    },
    hydrate: (event) => Promise.resolve(event),
    query: partial<AutoTitleDeps["session"]["query"]>({
      thread: (threadId) => {
        queries.count += 1;
        return ok(partial<ThreadSummaryRow>({ threadId, title: stored.title }));
      },
    }),
    threads: partial<AutoTitleDeps["session"]["threads"]>({
      setTitle: (threadId, title, requestKey) => {
        titleWrites.push({ threadId, title, requestKey });
        stored.title = title;
        return ok(undefined);
      },
    }),
  });
  const locks = partial<SessionLockPort>({ holds: () => options.owned ?? true });
  const controller = new AbortController();
  const auto = startAutoTitle({
    feed: {
      onCommit(listener) {
        listeners.push(listener);
        return () => {
          listeners.splice(listeners.indexOf(listener), 1);
        };
      },
    },
    locks,
    session,
    modelFor,
    logger,
    signal: controller.signal,
  });
  return {
    emit: async (events) => {
      for (const listener of listeners) listener({ firstSeq: 1, lastSeq: 1, events });
      // 제목 작업은 백그라운드다. 모델과 세션의 약속이 모두 끝날 때까지 기다린다
      await Bun.sleep(0);
    },
    setStoredTitle: (title) => {
      stored.title = title;
    },
    queries,
    branchReads,
    modelCalls,
    titleWrites,
    logs: lines,
    close: () => {
      auto.close();
      controller.abort();
    },
  };
}

const turnCompleted = (): DurableEventEnvelope =>
  envelopeOf("turn.completed", THREAD, { status: "completed" });
const userCommit = (text: string): DurableEventEnvelope =>
  envelopeOf("item.recorded", THREAD, userItemPayload(text));

test("a completed first turn gives the thread the model's sanitised title", async () => {
  const h = harness({
    title: FIRST_INPUT,
    branch: [userItemPayload(FIRST_INPUT), assistantItemPayload("답변이다.")],
  });
  await h.emit([userCommit(FIRST_INPUT)]);
  await h.emit([turnCompleted()]);
  expect(h.titleWrites).toEqual([
    { threadId: THREAD, title: "빌드 속도 조사", requestKey: `autotitle:${THREAD}` },
  ]);
  // 모델에는 첫 사용자 입력과 첫 응답이 들어간다
  expect(h.modelCalls).toHaveLength(1);
  expect(h.modelCalls[0]?.user).toContain(FIRST_INPUT);
  expect(h.modelCalls[0]?.user).toContain("답변이다.");
  h.close();
});

test("a human rename made before the turn completes is not replaced", async () => {
  const h = harness({
    title: FIRST_INPUT,
    branch: [userItemPayload(FIRST_INPUT), assistantItemPayload("답")],
  });
  await h.emit([userCommit(FIRST_INPUT)]);
  h.setStoredTitle("내가 정한 제목");
  await h.emit([turnCompleted()]);
  expect(h.modelCalls).toEqual([]);
  expect(h.titleWrites).toEqual([]);
  h.close();
});

test("a model failure leaves the provisional title, logs the step, and is not retried on the next turn", async () => {
  const h = harness({
    title: FIRST_INPUT,
    branch: [userItemPayload(FIRST_INPUT), assistantItemPayload("답")],
    reply: err({ kind: "rate_limited" }),
  });
  await h.emit([userCommit(FIRST_INPUT)]);
  await h.emit([turnCompleted()]);
  await h.emit([turnCompleted()]);
  expect(h.titleWrites).toEqual([]);
  expect(h.modelCalls).toHaveLength(1);
  expect(h.logs).toEqual([
    {
      level: "error",
      event: "thread.auto_title_failed",
      fields: { threadId: THREAD, step: "model", kind: "rate_limited" },
    },
  ]);
  h.close();
});

test("a turn that completes on a thread this process does not own leaves the thread alone", async () => {
  const h = harness({ title: null, owned: false });
  await h.emit([turnCompleted()]);
  expect(h.queries.count).toBe(0);
  expect(h.branchReads.count).toBe(0);
  expect(h.titleWrites).toEqual([]);
  // 소유가 없는 것은 조용히 건너뛴다. 기록은 디버그 수준 하나뿐이다
  expect(h.logs).toEqual([
    {
      level: "debug",
      event: "thread.auto_title_skipped",
      fields: { threadId: THREAD, reason: "not_owner" },
    },
  ]);
  h.close();
});

test("without a title model the skip is logged once and the thread is not touched", async () => {
  const h = harness({
    title: null,
    modelFor: () => err({ kind: "no_credentials", detail: "tape/tape-1" }),
  });
  await h.emit([turnCompleted()]);
  await h.emit([turnCompleted()]);
  expect(h.queries.count).toBe(0);
  expect(h.titleWrites).toEqual([]);
  expect(h.logs).toEqual([
    {
      level: "info",
      event: "thread.auto_title_skipped",
      fields: { reason: "no_credentials", detail: "tape/tape-1" },
    },
  ]);
  h.close();
});

test("a human title is never replaced, and the thread is not asked again", async () => {
  const h = harness({ title: "내가 정한 제목" });
  await h.emit([turnCompleted()]);
  await h.emit([turnCompleted()]);
  expect(h.titleWrites).toEqual([]);
  expect(h.queries.count).toBe(1);
  expect(h.branchReads.count).toBe(0);
  h.close();
});

test("a provisional title with no reply yet is tried again on the next completed turn", async () => {
  const h = harness({ title: null });
  await h.emit([turnCompleted()]);
  await h.emit([turnCompleted()]);
  expect(h.branchReads.count).toBe(2);
  expect(h.titleWrites).toEqual([]);
  expect(h.logs.filter((line) => line.level === "error")).toEqual([]);
  h.close();
});

test("after close no further turn starts a title", async () => {
  const h = harness({ title: null });
  h.close();
  await h.emit([turnCompleted()]);
  expect(h.queries.count).toBe(0);
});

test("a title model that cannot be resolved reports no_model, with the role's error kind", () => {
  const resolved = titleModelFor(
    partial<Parameters<typeof titleModelFor>[0]>({
      resolve: () => err({ kind: "no_model_for_role", message: "no model" }),
    }),
    clock,
    THREAD,
  );
  expect(resolved).toEqual({
    ok: false,
    error: { kind: "no_model", detail: "no_model_for_role" },
  });
});
