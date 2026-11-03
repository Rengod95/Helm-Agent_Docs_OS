import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { UsageMeter, UsageRecord } from "@fresnel/contracts/services";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { err, ok } from "@fresnel/contracts";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createUsageSource } from "../../src/assembly/usage.ts";

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

test("without a threadId there are no gauges, even when records exist", async () => {
  const { meter, push } = fakeMeter();
  const source = createUsageSource(meter);
  push(record(THREAD_A, "anthropic", 10, 0.001));
  expect(await source.gauges({}, SIGNAL)).toEqual([]);
  expect(await source.gauges({ providerId: "anthropic" }, SIGNAL)).toEqual([]);
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
