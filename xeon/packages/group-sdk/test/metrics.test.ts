import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { AssistantMessage, TurnId, UserMessage } from "@xeon/contracts/conversation";
import type {
  AgentSettledPayload,
  HandlerContext,
  ToolCallDecision,
  ToolCallPayload,
} from "@xeon/contracts/extensions";
import type { DurableEventEnvelope, EventKind } from "@xeon/contracts/records";
import { createTestHost, fixedIdFactory } from "@xeon/ext-host/testing";
import {
  defaultMetricsRegistry,
  createMetricsRegistry,
  defineGroup,
  summarizeUsage,
  type GroupApi,
  type GroupMetrics,
  type GroupUsageDelta,
} from "../src/index.ts";
import { createMetricsCounter } from "../src/metrics/counter.ts";
import { countedHandler } from "../src/metrics/handler.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const NONE: GroupUsageDelta = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };

function usage(part: Partial<GroupUsageDelta>): GroupUsageDelta {
  return { ...NONE, ...part };
}

/** 토큰과 비용만 본다. 계수 필드는 다른 시험이 본다 */
function usageOf(snapshot: GroupMetrics | undefined): unknown {
  return { tokens: snapshot?.tokens, costUsd: snapshot?.costUsd };
}

test("metrics.add-usage-accumulates-into-the-snapshot", async () => {
  const cases: readonly {
    readonly name: string;
    readonly calls: readonly GroupUsageDelta[];
    readonly expected: unknown;
  }[] = [
    {
      name: "no call leaves zeros",
      calls: [],
      expected: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0 },
    },
    {
      name: "one call is copied",
      calls: [usage({ input: 10, output: 4, cacheRead: 2, cacheWrite: 1, costUsd: 0.5 })],
      expected: { tokens: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1 }, costUsd: 0.5 },
    },
    {
      name: "calls add up",
      calls: [
        usage({ input: 10, output: 4, costUsd: 0.25 }),
        usage({ input: 5, cacheWrite: 3, costUsd: 0.125 }),
        usage({ output: 1 }),
      ],
      expected: { tokens: { input: 15, output: 5, cacheRead: 0, cacheWrite: 3 }, costUsd: 0.375 },
    },
    {
      name: "zero amounts change nothing",
      calls: [usage({}), usage({ input: 7 })],
      expected: { tokens: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0 },
    },
  ];
  // 시험마다 호스트를 따로 만들고 나란히 돌린다
  await Promise.all(
    cases.map(async (testCase, index) => {
      const t = await createTestHost();
      let api: GroupApi<never> | undefined;
      await install(
        t,
        defineGroup({
          manifest: groupManifestOf({ name: `usage-sum-${String(index)}` }),
          setup(g) {
            api = g;
          },
        }),
      );
      for (const call of testCase.calls) api?.metrics.addUsage(call);
      expect({ name: testCase.name, value: usageOf(api?.metrics.snapshot()) }).toEqual({
        name: testCase.name,
        value: testCase.expected,
      });
    }),
  );
});

test("metrics.add-usage-rejects-negative-and-non-finite-amounts-without-adding", async () => {
  const t = await createTestHost();
  let api: GroupApi<never> | undefined;
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "usage-bad" }),
      setup(g) {
        api = g;
      },
    }),
  );
  api?.metrics.addUsage(usage({ input: 2, costUsd: 1 }));
  for (const bad of [
    usage({ input: -1, costUsd: 9 }),
    usage({ output: Number.NaN, costUsd: 9 }),
    usage({ costUsd: Number.POSITIVE_INFINITY }),
    usage({ cacheRead: -0.5, input: 3 }),
  ]) {
    expect(() => api?.metrics.addUsage(bad)).toThrow(Bug);
  }
  // 거부된 호출은 한 값도 더하지 않는다
  expect(usageOf(api?.metrics.snapshot())).toEqual({
    tokens: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: 1,
  });
});

test("metrics.registry-replaces-by-group-id-and-resets", () => {
  const registry = createMetricsRegistry();
  const first = createMetricsCounter("alpha");
  const second = createMetricsCounter("alpha");
  first.bump("posts", 2);
  second.bump("posts", 5);
  registry.register("alpha", first.handle);
  expect(registry.get("alpha")?.snapshot().posts).toBe(2);
  registry.register("alpha", second.handle);
  expect(registry.get("alpha")?.snapshot().posts).toBe(5);
  expect(registry.get("beta")).toBeUndefined();
  registry.reset();
  expect(registry.get("alpha")).toBeUndefined();
});

test("metrics.setup-registers-the-group-counter-in-the-default-registry", async () => {
  defaultMetricsRegistry.reset();
  const t = await createTestHost();
  let api: GroupApi<never> | undefined;
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "registered" }),
      setup(g) {
        api = g;
      },
    }),
  );
  api?.metrics.addUsage(usage({ costUsd: 0.75 }));
  expect(defaultMetricsRegistry.get("registered")?.snapshot()).toEqual(api?.metrics.snapshot());
  expect(defaultMetricsRegistry.get("registered")?.snapshot().costUsd).toBe(0.75);
  defaultMetricsRegistry.reset();
});

test("metrics.on-counts-a-defined-first-return-as-a-denial", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "denier", points: ["tool.call.before"] }),
      setup(g) {
        g.on("tool.call.before", (payload) =>
          payload.toolName === "write" ? { block: true, reason: "no writes" } : undefined,
        );
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  const dispatch = (toolCallId: string, toolName: string) =>
    t.host.dispatch(
      "tool.call.before",
      { toolCallId, toolName, input: {} },
      { threadId: thread, dispatchKey: `tc-${toolCallId}` },
    );
  expect((await dispatch("c1", "write")).decision).toMatchObject({ block: true });
  expect((await dispatch("c2", "read")).decision).toBeUndefined();
  expect((await dispatch("c3", "write")).decision).toMatchObject({ block: true });
  // undefined 반환은 결정이 아니라 세지 않는다
  expect(defaultMetricsRegistry.get("denier")?.snapshot()).toMatchObject({
    denies: 2,
    chainPatches: 0,
    handlerErrors: 0,
  });
});

test("metrics.on-counts-a-defined-chain-return-as-a-patch", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const user: UserMessage = { role: "user", content: "hi", timestamp: 1_700_000_000_001 };
  const assistant: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "answer" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1_700_000_000_002,
  };
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "patcher", points: ["boundary.message.after"] }),
      setup(g) {
        g.on("boundary.message.after", (payload) =>
          payload.message.role === "user" ? { message: payload.message } : undefined,
        );
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  const dispatch = (key: string, message: UserMessage | AssistantMessage) =>
    t.host.dispatch(
      "boundary.message.after",
      { message },
      { threadId: thread, dispatchKey: key, initial: { message } },
    );
  await dispatch("m1", user);
  await dispatch("m2", assistant);
  await dispatch("m3", user);
  expect(defaultMetricsRegistry.get("patcher")?.snapshot()).toMatchObject({
    denies: 0,
    chainPatches: 2,
    handlerErrors: 0,
  });
});

test("metrics.on-counts-a-thrown-handler-and-the-host-reports-it", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "thrower", points: ["boundary.settle.after"] }),
      setup(g) {
        g.on("boundary.settle.after", () => {
          throw new Error("settle failed");
        });
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "settle-1" },
  );
  expect(defaultMetricsRegistry.get("thrower")?.snapshot()).toMatchObject({
    handlerErrors: 1,
    denies: 0,
    chainPatches: 0,
  });
  expect(t.diagnostics.map((entry) => entry.code)).toContain("handler_failed");
});

/** 실행이 던지거나 거부한 값. 던지지 않았으면 undefined다 */
async function thrownOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

test("metrics.counted-handler-rethrows-the-same-error-and-keeps-async-values", async () => {
  const ids = fixedIdFactory(7);
  const context: HandlerContext<unknown> = {
    scopeId: "unit",
    state: {},
    threadId: ids.next("thr"),
    signal: new AbortController().signal,
  };
  const settled: AgentSettledPayload = { turnId: ids.next("trn"), aborted: false };
  const call: ToolCallPayload = { toolCallId: "c", toolName: "write", input: {} };
  const marker = new Error("marker");
  const counter = createMetricsCounter("unit");

  const throwing = countedHandler(
    "boundary.settle.after",
    () => {
      throw marker;
    },
    counter,
  );
  expect(await thrownOf(() => throwing(settled, context))).toBe(marker);

  const rejecting = countedHandler(
    "boundary.settle.after",
    async () => {
      throw marker;
    },
    counter,
  );
  expect(await thrownOf(() => rejecting(settled, context))).toBe(marker);
  expect(counter.handle.snapshot().handlerErrors).toBe(2);

  const decision: ToolCallDecision = { block: true, reason: "x" };
  const asyncDecision = countedHandler("tool.call.before", async () => decision, counter);
  expect(await asyncDecision(call, context)).toEqual({ block: true, reason: "x" });
  expect(counter.handle.snapshot()).toMatchObject({ denies: 1, handlerErrors: 2 });
});

/** 요약 시험의 이벤트 봉투. 순번은 만든 순서이고 시각은 인자로 준다. 시계는 읽지 않는다 */
const eventIds = fixedIdFactory(100);
const THREAD = eventIds.next("thr");
const turnIds = new Map<string, TurnId>();

function turnOf(label: string): TurnId {
  const found = turnIds.get(label);
  if (found !== undefined) return found;
  const created = eventIds.next("trn");
  turnIds.set(label, created);
  return created;
}

function envelope(
  seq: number,
  kind: EventKind,
  payload: unknown,
  recordedAt: number,
  turn: string | null = null,
): DurableEventEnvelope {
  return {
    id: eventIds.next("evt"),
    kind,
    version: 1,
    threadId: THREAD,
    turnId: turn === null ? null : turnOf(turn),
    stepId: null,
    recordedAt,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

/** 같은 시험 안에서 순번을 1부터 준다 */
function sequenced(
  events: readonly ((seq: number) => DurableEventEnvelope)[],
): DurableEventEnvelope[] {
  return events.map((make, index) => make(index + 1));
}

const USAGE = {
  input: 10,
  output: 5,
  cacheRead: 2,
  cacheWrite: 1,
  totalTokens: 18,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.25 },
};

test("metrics.usage-summary-table", () => {
  const cases: readonly {
    readonly name: string;
    readonly events: readonly DurableEventEnvelope[];
    readonly expected: Record<string, unknown>;
  }[] = [
    { name: "no events", events: [], expected: {} },
    {
      name: "a closed lease adds its interval",
      events: sequenced([
        (seq) =>
          envelope(seq, "lease.acquired", { leaseId: "l1", scopeId: "helm", limits: {} }, 1_000),
        (seq) =>
          envelope(
            seq,
            "lease.released",
            { leaseId: "l1", scopeId: "helm", reason: "budget" },
            1_250,
          ),
      ]),
      expected: {
        helm: {
          leases: 1,
          leaseMs: 250,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
        },
      },
    },
    {
      name: "an open lease counts once and adds no time",
      events: sequenced([
        (seq) =>
          envelope(seq, "lease.acquired", { leaseId: "l1", scopeId: "helm", limits: {} }, 1_000),
      ]),
      expected: {
        helm: {
          leases: 1,
          leaseMs: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
        },
      },
    },
    {
      name: "two leases of one scope add up",
      events: sequenced([
        (seq) =>
          envelope(seq, "lease.acquired", { leaseId: "l1", scopeId: "helm", limits: {} }, 100),
        (seq) =>
          envelope(seq, "lease.released", { leaseId: "l1", scopeId: "helm", reason: "idle" }, 160),
        (seq) =>
          envelope(seq, "lease.acquired", { leaseId: "l2", scopeId: "helm", limits: {} }, 500),
        (seq) =>
          envelope(
            seq,
            "lease.released",
            { leaseId: "l2", scopeId: "helm", reason: "idle" },
            1_000,
          ),
      ]),
      expected: {
        helm: {
          leases: 2,
          leaseMs: 560,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
        },
      },
    },
    {
      name: "a release without an acquire is ignored",
      events: sequenced([
        (seq) =>
          envelope(
            seq,
            "lease.released",
            { leaseId: "ghost", scopeId: "helm", reason: "idle" },
            900,
          ),
      ]),
      expected: {},
    },
    {
      name: "turn usage goes to the scope of its turn.started",
      events: sequenced([
        (seq) =>
          envelope(
            seq,
            "turn.started",
            { inputItemIds: [], requestId: null, scopeId: "helm" },
            10,
            "t1",
          ),
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            { status: "completed", stepCount: 1, usage: USAGE, error: null },
            20,
            "t1",
          ),
      ]),
      expected: {
        helm: {
          leases: 0,
          leaseMs: 0,
          tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
          costUsd: 0.25,
        },
      },
    },
    {
      name: "a turn without a scope is not attributed",
      events: sequenced([
        (seq) =>
          envelope(
            seq,
            "turn.started",
            { inputItemIds: [], requestId: null, scopeId: null },
            10,
            "t2",
          ),
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            { status: "completed", stepCount: 1, usage: USAGE, error: null },
            20,
            "t2",
          ),
      ]),
      expected: {},
    },
    {
      name: "a turn.completed without a started turn is not attributed",
      events: sequenced([
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            { status: "completed", stepCount: 1, usage: USAGE, error: null },
            20,
            "t3",
          ),
      ]),
      expected: {},
    },
    {
      name: "a turn.completed without usage creates no scope entry",
      events: sequenced([
        (seq) =>
          envelope(
            seq,
            "turn.started",
            { inputItemIds: [], requestId: null, scopeId: "helm" },
            10,
            "t4",
          ),
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            { status: "completed", stepCount: 1, usage: null, error: null },
            20,
            "t4",
          ),
      ]),
      expected: {},
    },
    {
      name: "payloads that fail their schema are skipped",
      events: sequenced([
        (seq) => envelope(seq, "lease.acquired", { leaseId: "bad" }, 100),
        (seq) => envelope(seq, "turn.started", { inputItemIds: "nope" }, 110, "t5"),
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            { status: "completed", stepCount: 1, usage: USAGE, error: null },
            120,
            "t5",
          ),
      ]),
      expected: {},
    },
    {
      name: "two scopes keep separate sums",
      events: sequenced([
        (seq) =>
          envelope(
            seq,
            "turn.started",
            { inputItemIds: [], requestId: null, scopeId: "helm" },
            10,
            "t6",
          ),
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            { status: "completed", stepCount: 1, usage: USAGE, error: null },
            20,
            "t6",
          ),
        (seq) =>
          envelope(
            seq,
            "turn.started",
            { inputItemIds: [], requestId: null, scopeId: "learning" },
            30,
            "t7",
          ),
        (seq) =>
          envelope(
            seq,
            "turn.completed",
            {
              status: "completed",
              stepCount: 1,
              usage: { ...USAGE, input: 1, cost: { ...USAGE.cost, total: 0.5 } },
              error: null,
            },
            40,
            "t7",
          ),
      ]),
      expected: {
        helm: {
          leases: 0,
          leaseMs: 0,
          tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
          costUsd: 0.25,
        },
        learning: {
          leases: 0,
          leaseMs: 0,
          tokens: { input: 1, output: 5, cacheRead: 2, cacheWrite: 1 },
          costUsd: 0.5,
        },
      },
    },
  ];
  for (const testCase of cases) {
    const summary: Record<string, unknown> = Object.fromEntries(summarizeUsage(testCase.events));
    expect({ name: testCase.name, summary }).toEqual({
      name: testCase.name,
      summary: testCase.expected,
    });
  }
});
