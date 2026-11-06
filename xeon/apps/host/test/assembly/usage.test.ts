import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { UsageMeter, UsageRecord } from "@fresnel/contracts/services";
import type { DurableEventEnvelope, SessionService } from "@fresnel/contracts/records";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { err, ok } from "@fresnel/contracts";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createUsageSource, readEventsOfAllBranches } from "../../src/assembly/usage.ts";

// M3-REQ-15: 조립 기본 사용량 원천은 L1.models 합산기의 기록으로 thread의 세션 게이지(tokens, usd, requests)를 만든다.
// 창, 한도, 계정 게이지는 L1이 기록을 보관하지 않아 없다. 기록은 구독으로 받고 중단된 호출도 센다.

const ids = fixedIdFactory();
const THREAD_A = ids.next("thr");
const THREAD_B = ids.next("thr");
const UNKNOWN = ids.next("thr");
const SIGNAL = new AbortController().signal;

/** 기록을 밀어 넣을 수 있는 합산기 대역. 원천은 `subscribe`만 쓴다 */
function fakeMeter(): {
  readonly meter: UsageMeter;
  readonly push: (record: UsageRecord) => void;
  readonly subscriptions: () => number;
} {
  const listeners = new Set<(record: UsageRecord) => void>();
  let subscribed = 0;
  const meter: UsageMeter = {
    totals: () => {
      throw new Error("the usage source reads records, not totals");
    },
    subscribe: (listener) => {
      subscribed += 1;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    meter,
    push: (record) => {
      for (const listener of listeners) listener(record);
    },
    subscriptions: () => subscribed,
  };
}

function record(
  threadId: ThreadId,
  provider: string,
  totalTokens: number,
  cost: number,
  aborted = false,
): UsageRecord {
  return {
    threadId,
    turnId: null,
    stepId: null,
    role: "main",
    scopeId: null,
    provider,
    modelId: `${provider}-model`,
    usage: {
      input: totalTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
    },
    stopReason: aborted ? "aborted" : "stop",
    aborted,
    recordedAt: 0,
  };
}

/** provider 하나의 세션 게이지 다섯 줄(tokens, usd, requests, cacheRead, cacheWrite 순서) */
function sessionGauges(
  providerId: string,
  used: {
    readonly tokens: number;
    readonly usd: number;
    readonly requests: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  },
): readonly UsageGauge[] {
  return [
    {
      id: `${providerId}::session:tokens`,
      providerId,
      account: null,
      window: "session",
      unit: "tokens",
      used: used.tokens,
      limit: null,
      resetsAt: null,
    },
    {
      id: `${providerId}::session:usd`,
      providerId,
      account: null,
      window: "session",
      unit: "usd",
      used: used.usd,
      limit: null,
      resetsAt: null,
    },
    {
      id: `${providerId}::session:requests`,
      providerId,
      account: null,
      window: "session",
      unit: "requests",
      used: used.requests,
      limit: null,
      resetsAt: null,
    },
    {
      id: `${providerId}::session:cacheRead`,
      providerId,
      account: null,
      window: "session",
      unit: "cacheRead",
      used: used.cacheRead ?? 0,
      limit: null,
      resetsAt: null,
    },
    {
      id: `${providerId}::session:cacheWrite`,
      providerId,
      account: null,
      window: "session",
      unit: "cacheWrite",
      used: used.cacheWrite ?? 0,
      limit: null,
      resetsAt: null,
    },
  ];
}

test("two providers on one thread give their session gauges in provider-name order, aborted calls included", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "openai", 7, 0.25));
  push(record(THREAD_A, "anthropic", 10, 0.001));
  push(record(THREAD_A, "anthropic", 5, 0.001, true));
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual([
    ...sessionGauges("anthropic", { tokens: 15, usd: 0.002, requests: 2 }),
    ...sessionGauges("openai", { tokens: 7, usd: 0.25, requests: 1 }),
  ]);
});

test("the sums come from the records: 15 tokens, 0.002 usd, 2 requests for anthropic", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "anthropic", 10, 0.001));
  push(record(THREAD_A, "anthropic", 5, 0.001, true));
  const used = (await source.gauges({ threadId: THREAD_A }, SIGNAL)).map((gauge) => gauge.used);
  expect(used).toEqual([15, 0.002, 2, 0, 0]);
});

test("a thread sees only its own records", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "anthropic", 10, 0.001));
  push(record(THREAD_B, "anthropic", 100, 1));
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 10, usd: 0.001, requests: 1 }),
  );
  expect(await source.gauges({ threadId: THREAD_B }, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 100, usd: 1, requests: 1 }),
  );
});

test("the providerId filter keeps only that provider's gauges on the thread", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "openai", 7, 0.25));
  push(record(THREAD_A, "anthropic", 10, 0.001));
  expect(await source.gauges({ threadId: THREAD_A, providerId: "openai" }, SIGNAL)).toEqual(
    sessionGauges("openai", { tokens: 7, usd: 0.25, requests: 1 }),
  );
  expect(await source.gauges({ threadId: THREAD_A, providerId: "google" }, SIGNAL)).toEqual([]);
});

test("without a threadId the gauges sum every thread, and providerId still filters", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "anthropic", 10, 0.001));
  push(record(THREAD_B, "anthropic", 100, 1));
  push(record(THREAD_B, "openai", 7, 0.25));
  expect(await source.gauges({}, SIGNAL)).toEqual([
    ...sessionGauges("anthropic", { tokens: 110, usd: 1.001, requests: 2 }),
    ...sessionGauges("openai", { tokens: 7, usd: 0.25, requests: 1 }),
  ]);
  expect(await source.gauges({ providerId: "openai" }, SIGNAL)).toEqual(
    sessionGauges("openai", { tokens: 7, usd: 0.25, requests: 1 }),
  );
});

test("without records there are no gauges for any scope", async () => {
  const { meter } = fakeMeter();
  const source = createUsageSource(meter);
  expect(await source.gauges({}, SIGNAL)).toEqual([]);
});

test("an unknown thread has no gauges", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "anthropic", 10, 0.001));
  expect(await source.gauges({ threadId: UNKNOWN }, SIGNAL)).toEqual([]);
});

test("the source subscribes to the meter once, when it is created", async () => {
  const { meter, push, subscriptions } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "anthropic", 10, 0.001));
  push(record(THREAD_A, "anthropic", 10, 0.001));
  expect(subscriptions()).toBe(1);
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 20, usd: 0.002, requests: 2 }),
  );
});

/** 어시스턴트 `item.recorded` 이벤트 한 건 */
function recordedEvent(
  seq: number,
  threadId: ThreadId,
  provider: string,
  used: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number },
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind: "item.recorded",
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    recordedAt: seq,
    causationId: null,
    correlationId: null,
    payload: {
      item: {
        itemId: ids.next("itm"),
        status: "completed",
        kind: "assistant",
        partIds: [],
        message: {
          role: "assistant",
          content: [],
          api: "test",
          provider,
          model: `${provider}-model`,
          usage: {
            input: used.input,
            output: used.output,
            cacheRead: used.cacheRead,
            cacheWrite: used.cacheWrite,
            totalTokens: used.input + used.output + used.cacheRead + used.cacheWrite,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: used.cost },
          },
          stopReason: "stop",
          timestamp: 1,
        },
      },
    },
    durable: true,
    seq,
    parentId: null,
  };
}

test("after a restart the gauges are rebuilt from durable records, cache read and write included", async () => {
  // 합산기는 비어 있다(재시작 직후). 내구 기록만 있다
  const { meter } = fakeMeter();
  const events = [
    recordedEvent(1, THREAD_A, "anthropic", {
      input: 10,
      output: 5,
      cacheRead: 100,
      cacheWrite: 20,
      cost: 0.5,
    }),
    recordedEvent(2, THREAD_A, "anthropic", {
      input: 1,
      output: 1,
      cacheRead: 50,
      cacheWrite: 0,
      cost: 0.25,
    }),
  ];
  const source = createUsageSource(meter, async (_threadId, query) =>
    ok(events.filter((event) => event.kind.startsWith(query.kindPrefix))),
  );
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual(
    sessionGauges("anthropic", {
      tokens: 187,
      usd: 0.75,
      requests: 2,
      cacheRead: 150,
      cacheWrite: 20,
    }),
  );
});

test("an unreadable durable log falls back to the in-memory meter", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter, async () => err({ kind: "port_unavailable" }));
  push(record(THREAD_A, "anthropic", 10, 0.001));
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 10, usd: 0.001, requests: 1 }),
  );
});

test("without a threadId the sum comes from the durable log of every thread, so a restart keeps it", async () => {
  const { meter } = fakeMeter();
  const events = [
    recordedEvent(1, THREAD_A, "anthropic", {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.5,
    }),
    recordedEvent(2, THREAD_B, "anthropic", {
      input: 1,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.25,
    }),
  ];
  const asked: (ThreadId | undefined)[] = [];
  const source = createUsageSource(meter, async (threadId, query) => {
    asked.push(threadId);
    return ok(events.filter((event) => event.kind.startsWith(query.kindPrefix)));
  });
  expect(await source.gauges({}, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 20, usd: 0.75, requests: 2 }),
  );
  expect(asked).toEqual([undefined]);
});

test("without a threadId an unreadable durable log falls back to the meter sum", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter, async () => err({ kind: "port_unavailable" }));
  push(record(THREAD_A, "anthropic", 10, 0.5));
  push(record(THREAD_B, "anthropic", 5, 0.25));
  expect(await source.gauges({}, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 15, usd: 0.75, requests: 2 }),
  );
});

/** `readFrom`만 가진 세션 대역. 모든 분기의 기록을 커밋 순서로 낸다 */
function fakeSession(rows: readonly DurableEventEnvelope[]): Pick<SessionService, "readFrom"> {
  return {
    readFrom: (afterSeq, options) =>
      (async function* () {
        for (const row of rows) {
          if (row.seq <= afterSeq) continue;
          if (options?.threadId !== undefined && row.threadId !== options.threadId) continue;
          yield ok(row);
        }
      })(),
  };
}

test("rewound and abandoned branches still count: every branch's assistant record is summed", async () => {
  const kept = recordedEvent(1, THREAD_A, "anthropic", {
    input: 10,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.5,
  });
  // 되감아 버려진 분기의 기록. 부모가 다른 가지에 있어 readBranch로는 읽히지 않는다
  const abandoned = {
    ...recordedEvent(2, THREAD_A, "anthropic", {
      input: 7,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.25,
    }),
    parentId: null,
  };
  const other = recordedEvent(3, THREAD_B, "anthropic", {
    input: 100,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 1,
  });
  const session = fakeSession([kept, abandoned, other]);
  const { meter } = fakeMeter();
  const source = createUsageSource(meter, (threadId, query) =>
    readEventsOfAllBranches(session, threadId, query.kindPrefix),
  );
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 17, usd: 0.75, requests: 2 }),
  );
  expect(await source.gauges({}, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 117, usd: 1.75, requests: 3 }),
  );
});

test("calls with no assistant item (summary, search, judge) are added to the durable sum, loop calls are not counted twice", async () => {
  const { meter, push } = fakeMeter();
  const events = [
    recordedEvent(1, THREAD_A, "anthropic", {
      input: 10,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.5,
    }),
  ];
  const source = createUsageSource(meter, async (_threadId, query) =>
    ok(events.filter((event) => event.kind.startsWith(query.kindPrefix))),
  );
  // 루프 호출은 내구 기록에 이미 있다. 요약 호출은 없다
  push({ ...record(THREAD_A, "anthropic", 10, 0.5), role: "main" });
  push({ ...record(THREAD_A, "anthropic", 3, 0.125), role: "summary" });
  push({ ...record(THREAD_B, "anthropic", 99, 9), role: "search" });
  expect(await source.gauges({ threadId: THREAD_A }, SIGNAL)).toEqual(
    sessionGauges("anthropic", { tokens: 13, usd: 0.625, requests: 2 }),
  );
});

test("context gives the last finished call's total tokens against that model's window, and nothing when the window is unknown", async () => {
  const { meter } = fakeMeter();
  const events = [
    recordedEvent(1, THREAD_A, "anthropic", {
      input: 10,
      output: 5,
      cacheRead: 100,
      cacheWrite: 20,
      cost: 0,
    }),
    recordedEvent(2, THREAD_A, "anthropic", {
      input: 30,
      output: 7,
      cacheRead: 150,
      cacheWrite: 0,
      cost: 0,
    }),
  ];
  const read = async (_threadId: ThreadId | undefined, query: { readonly kindPrefix: string }) =>
    ok(events.filter((event) => event.kind.startsWith(query.kindPrefix)));
  const windows = new Map([["anthropic/anthropic-model", 200_000]]);
  const source = createUsageSource(meter, read, (provider, modelId) =>
    windows.get(`${provider}/${modelId}`),
  );
  expect(await source.context(THREAD_A, SIGNAL)).toEqual({
    model: "anthropic/anthropic-model",
    used: 187,
    limit: 200_000,
  });
  windows.clear();
  expect(await source.context(THREAD_A, SIGNAL)).toBeUndefined();
  expect(await createUsageSource(meter).context(THREAD_A, SIGNAL)).toBeUndefined();
  const empty = createUsageSource(
    meter,
    async () => ok([]),
    () => 1000,
  );
  expect(await empty.context(THREAD_A, SIGNAL)).toBeUndefined();
  const broken = createUsageSource(
    meter,
    async () => err("io"),
    () => 1000,
  );
  expect(await broken.context(THREAD_A, SIGNAL)).toBeUndefined();
});
