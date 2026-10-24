import { describe, expect, jest, test, afterEach } from "bun:test";
import type { AssistantMessageEvent, AssistantMessage } from "@xeon/contracts/conversation";
import type { UsageRecord } from "@xeon/contracts/services";
import { fixedIdFactory, flushMicrotasks } from "@xeon/ext-host/testing";
import { loadTape, t, tape } from "../src/testing/index.ts";
import { createHarness, unwrap } from "./support/harness.ts";
import { memoryLogger, type LogLine } from "./support/logger.ts";
import { transcriptOf } from "./support/transcript.ts";

async function collect(
  stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

afterEach(() => {
  jest.useRealTimers();
});

const ANSWER = tape("core-models/answer", [
  {
    role: "main",
    response: {
      type: "message",
      content: [t.text("hello")],
      stopReason: "stop",
      usage: { input: 1000, output: 500 },
    },
  },
]);

describe("stream", () => {
  test("plays a tape turn through pi-ai and records usage with a computed cost", async () => {
    const h = createHarness({ tape: ANSWER });
    const events = await collect(h.service.stream(h.request("hi")));
    expect(events.at(0)?.type).toBe("start");
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.message.content).toEqual([{ type: "text", text: "hello" }]);
    // 단가 입력 1, 출력 2 (100만 토큰당): 1000 * 1e-6 + 500 * 2e-6
    expect(done.message.usage.cost.total).toBeCloseTo(0.002, 9);
    expect(h.service.usage.totals({ threadId: h.threadId })).toMatchObject({
      calls: 1,
      abortedCalls: 0,
      input: 1000,
      output: 500,
      totalTokens: 1500,
    });
    h.player.assertExhausted();
  });

  test("result() without iterating gives the same final message and records usage once", async () => {
    const h = createHarness({ tape: ANSWER });
    const stream = h.service.stream(h.request("hi"));
    const first = await stream.result();
    const second = await stream.result();
    expect(first).toBe(second);
    expect(first.stopReason).toBe("stop");
    expect(h.service.usage.totals({ threadId: h.threadId }).calls).toBe(1);
  });

  test("iterating and then result() records usage once", async () => {
    const h = createHarness({ tape: ANSWER });
    const stream = h.service.stream(h.request("hi"));
    await collect(stream);
    await stream.result();
    expect(h.service.usage.totals({ threadId: h.threadId }).calls).toBe(1);
  });

  test("closing the iteration before the terminal event records an aborted call with zero usage", async () => {
    const h = createHarness({ tape: ANSWER });
    const stream = h.service.stream(h.request("hi"));
    for await (const event of stream) {
      if (event.type === "start") break;
    }
    expect(h.service.usage.totals({ threadId: h.threadId })).toMatchObject({
      calls: 1,
      abortedCalls: 1,
      totalTokens: 0,
    });
  });

  test("a provider that is not registered ends with a provider_unavailable error message", async () => {
    const h = createHarness({ tape: ANSWER });
    const request = h.request("hi");
    const message = await h.service
      .stream({
        ...request,
        resolved: {
          ...request.resolved,
          binding: { ...request.resolved.binding, provider: "nowhere" },
        },
      })
      .result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toStartWith("provider_unavailable:");
    expect(h.service.classify(message)).toBe("provider_unavailable");
    expect(h.service.usage.totals({ threadId: h.threadId }).calls).toBe(1);
    expect(h.fake.calls()).toHaveLength(0);
  });

  test("a request that cannot be sent is logged with its kind", async () => {
    const lines: LogLine[] = [];
    const h = createHarness({ tape: ANSWER, logger: memoryLogger(lines) });
    const request = h.request("hi");
    await h.service
      .stream({
        ...request,
        resolved: {
          ...request.resolved,
          binding: { ...request.resolved.binding, provider: "nowhere" },
        },
      })
      .result();
    expect(lines).toEqual([
      {
        level: "warn",
        event: "model.request_not_sent",
        fields: {
          kind: "provider_unavailable",
          provider: "nowhere",
          modelId: "tape-1",
          role: "main",
        },
      },
    ]);
  });

  test("a provider disabled in l1.models.providers is unavailable", async () => {
    const h = createHarness({ tape: ANSWER });
    h.setSettings({
      providers: [
        { id: h.fake.provider.id, enabled: false, apiKeyRef: "secret://tape-key", baseUrl: null },
      ],
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(h.service.classify(message)).toBe("provider_unavailable");
    expect(h.secrets.leaseCalls()).toBe(0);
  });

  test("an unknown model id ends with model_not_found", async () => {
    const h = createHarness({ tape: ANSWER });
    const request = h.request("hi");
    const message = await h.service
      .stream({
        ...request,
        resolved: {
          ...request.resolved,
          binding: { ...request.resolved.binding, modelId: "missing" },
        },
      })
      .result();
    expect(h.service.classify(message)).toBe("model_not_found");
  });

  test("a baseUrl override in l1.models.providers reaches the provider and the secret target host", async () => {
    const h = createHarness({ tape: ANSWER });
    h.setSettings({
      providers: [
        {
          id: h.fake.provider.id,
          enabled: true,
          apiKeyRef: "secret://tape-key",
          baseUrl: "https://gateway.example.test:8443/v1",
        },
      ],
    });
    await h.service.stream(h.request("hi")).result();
    expect(h.secrets.lastCtx()?.target).toEqual({
      kind: "host",
      host: "gateway.example.test",
      port: 8443,
    });
  });

  test("cache retention follows the role: main caches by thread, summary does not", async () => {
    const h = createHarness({
      tape: tape("core-models/roles", [
        { role: "main", response: { type: "message", content: [t.text("a")], stopReason: "stop" } },
      ]),
      provider: { roleOf: () => "main" },
    });
    await h.service.stream(h.request("hi", "main")).result();
    expect(h.fake.calls()[0]?.sessionId).toBe(h.threadId);

    const summary = createHarness({
      tape: tape("core-models/roles-summary", [
        { role: "main", response: { type: "message", content: [t.text("a")], stopReason: "stop" } },
      ]),
    });
    await summary.service.stream(summary.request("hi", "summary")).result();
    expect(summary.fake.calls()[0]?.sessionId).toBeUndefined();
  });

  test("a reasoning model gets the resolved thinking level as pi-ai reasoning", async () => {
    const h = createHarness({
      tape: tape("core-models/reasoning", [
        { role: "main", response: { type: "message", content: [t.text("a")], stopReason: "stop" } },
      ]),
      provider: { models: [{ id: "tape-r", reasoning: true }] },
      settings: { default: "tape/tape-r:high" },
    });
    const request = h.request("hi");
    expect(request.resolved.binding.thinkingLevel).toBe("high");
    await h.service.stream(request).result();
    expect(h.fake.calls()[0]?.reasoning).toBe("high");
  });

  test("a non-reasoning model gets no reasoning option", async () => {
    const h = createHarness({ tape: ANSWER });
    expect(h.resolve().binding.thinkingLevel).toBe("off");
    await h.service.stream(h.request("hi")).result();
    expect(h.fake.calls()[0]?.reasoning).toBeUndefined();
  });
});

describe("usage_counts_aborted_response", () => {
  test("an aborted call with partial content counts its usage and bumps abortedCalls", async () => {
    const h = createHarness({
      tape: tape("core-models/aborted-call", [
        {
          role: "main",
          response: {
            type: "error",
            reason: "aborted",
            errorMessage: "aborted by user",
            afterContent: [t.text("partial")],
            usage: { input: 50, output: 5 },
          },
        },
      ]),
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("aborted");
    expect(h.service.classify(message)).toBe("aborted");
    expect(h.service.usage.totals({ threadId: h.threadId })).toMatchObject({
      calls: 1,
      abortedCalls: 1,
      input: 50,
      output: 5,
    });
  });
});

describe("stream_fn_records_usage_with_context", () => {
  test("the StreamFn call carries threadId, turnId, stepId, role and scopeId into the usage record", async () => {
    const h = createHarness({ tape: ANSWER });
    const ids = fixedIdFactory(100);
    const turnId = ids.next("trn");
    const stepId = ids.next("stp");
    const records: UsageRecord[] = [];
    h.service.usage.subscribe((record) => {
      records.push(record);
    });
    const streamFn = h.service.streamFn(h.ctx("subagent", { turnId, stepId, scopeId: "helm" }));
    const stream = await streamFn(h.fake.model, transcriptOf(h.context("hi").messages), {});
    await stream.result();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      threadId: h.threadId,
      turnId,
      stepId,
      role: "subagent",
      scopeId: "helm",
      provider: "tape",
      modelId: "tape-1",
      stopReason: "stop",
      aborted: false,
    });
    expect(records[0]?.usage.input).toBe(1000);
    expect(h.service.usage.totals({ threadId: h.threadId, turnId })).toMatchObject({
      calls: 1,
      input: 1000,
    });
    expect(h.service.usage.totals({ threadId: h.threadId, role: "main" }).calls).toBe(0);
    expect(h.service.usage.totals({ threadId: h.threadId, scopeId: "helm" }).calls).toBe(1);
  });

  test("an unknown model passed to the StreamFn ends the stream with an error message instead of throwing", async () => {
    const h = createHarness({ tape: ANSWER });
    const streamFn = h.service.streamFn(h.ctx());
    const stream = await streamFn(
      { ...h.fake.model, id: "nope" },
      transcriptOf(h.context("hi").messages),
      {},
    );
    const message = await stream.result();
    expect(h.service.classify(message)).toBe("model_not_found");
  });

  test("the abort signal passed in the StreamFn options is the one that reaches the provider", async () => {
    const h = createHarness({
      tape: tape("core-models/stall", [{ role: "main", response: { type: "stall" } }]),
    });
    const controller = new AbortController();
    const stream = await h.service.streamFn(h.ctx())(
      h.fake.model,
      transcriptOf(h.context("hi").messages),
      { signal: controller.signal },
    );
    const pending = stream.result();
    await flushMicrotasks();
    expect(h.fake.calls()).toHaveLength(1);
    controller.abort();
    const message = await pending;
    expect(message.stopReason).toBe("aborted");
    expect(h.service.usage.totals({ threadId: h.threadId })).toMatchObject({
      calls: 1,
      abortedCalls: 1,
    });
  });

  test("a call aborted before the provider started is reported as aborted, not as a provider error", async () => {
    const h = createHarness({ tape: ANSWER });
    const controller = new AbortController();
    controller.abort();
    const message = await h.service
      .stream(h.request("hi", "main", { signal: controller.signal }))
      .result();
    expect(message.stopReason).toBe("aborted");
    expect(h.service.classify(message)).toBe("aborted");
    expect(h.service.usage.totals({ threadId: h.threadId })).toMatchObject({
      calls: 1,
      abortedCalls: 1,
    });
  });
});

describe("complete", () => {
  test("returns the final message", async () => {
    const h = createHarness({ tape: ANSWER });
    const message = await h.service.complete(h.request("hi"));
    expect(message.content).toEqual([{ type: "text", text: "hello" }]);
  });

  test("retries a rate-limited call once and counts both calls", async () => {
    jest.useFakeTimers();
    const h = createHarness({
      tape: tape("core-models/retry", [
        {
          role: "main",
          response: { type: "error", reason: "error", errorMessage: "429 rate_limit_error" },
        },
        {
          role: "main",
          response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
        },
      ]),
      settings: { retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100 } },
    });
    const pending = h.service.complete(h.request("hi"));
    await flushMicrotasks();
    jest.advanceTimersByTime(20);
    await flushMicrotasks();
    const message = await pending;
    expect(message.stopReason).toBe("stop");
    expect(h.service.usage.totals({ threadId: h.threadId }).calls).toBe(2);
    h.player.assertExhausted();
  });

  test("a quota error is returned without a retry", async () => {
    const h = createHarness({
      tape: tape("core-models/quota", [
        {
          role: "main",
          response: { type: "error", reason: "error", errorMessage: "429 insufficient_quota" },
        },
      ]),
      settings: { retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 } },
    });
    const message = await h.service.complete(h.request("hi"));
    expect(h.service.classify(message)).toBe("quota_exhausted");
    expect(h.service.usage.totals({ threadId: h.threadId }).calls).toBe(1);
  });
});

describe("resolve and rebind", () => {
  test("resolve uses l1.models.default for every role in M1 and reports the source", () => {
    const h = createHarness({ tape: ANSWER });
    for (const role of ["main", "review", "summary", "subagent", "judge", "search"] as const) {
      const resolved = h.resolve(role);
      expect(resolved.binding).toEqual({
        role,
        provider: "tape",
        modelId: "tape-1",
        thinkingLevel: "off",
      });
      expect(resolved.source).toBe("default");
      expect(resolved.model.id).toBe("tape-1");
    }
  });

  test("an explicit reference wins over the default", () => {
    const h = createHarness({
      tape: ANSWER,
      provider: { models: [{ id: "tape-1" }, { id: "tape-2" }] },
    });
    const resolved = unwrap(h.service.resolve("main", { ref: "tape/tape-2" }));
    expect(resolved.binding.modelId).toBe("tape-2");
    expect(resolved.source).toBe("explicit");
  });

  test("no default and no override is no_model_for_role", () => {
    const h = createHarness({ tape: ANSWER, settings: { default: null } });
    expect(h.service.resolve("main")).toMatchObject({
      ok: false,
      error: { kind: "no_model_for_role" },
    });
  });

  test("a malformed or unknown reference is invalid_ref or model_not_found", () => {
    const h = createHarness({ tape: ANSWER });
    expect(h.service.resolve("main", { ref: "tape" })).toMatchObject({
      ok: false,
      error: { kind: "invalid_ref" },
    });
    expect(h.service.resolve("main", { ref: "tape/missing" })).toMatchObject({
      ok: false,
      error: { kind: "model_not_found" },
    });
  });

  test("rebind returns the pinned binding even after the default setting changes", () => {
    const h = createHarness({
      tape: ANSWER,
      provider: { models: [{ id: "tape-1" }, { id: "tape-2" }] },
    });
    const pinned = h.resolve().binding;
    h.setSettings({ default: "tape/tape-2" });
    expect(h.resolve().binding.modelId).toBe("tape-2");
    const rebound = unwrap(h.service.rebind(pinned));
    expect(rebound.binding).toEqual(pinned);
    expect(rebound.source).toBe("checkpoint");
    expect(rebound.model.id).toBe("tape-1");
  });

  test("rebind to a model that left the catalog is model_not_found", () => {
    const h = createHarness({ tape: ANSWER });
    expect(
      h.service.rebind({ role: "main", provider: "tape", modelId: "gone", thinkingLevel: "off" }),
    ).toMatchObject({
      ok: false,
      error: { kind: "model_not_found" },
    });
  });

  test("the first request after rebind goes to the pinned model", async () => {
    const h = createHarness({
      tape: ANSWER,
      provider: { models: [{ id: "tape-1" }, { id: "tape-2" }] },
    });
    const pinned = h.resolve().binding;
    h.setSettings({ default: "tape/tape-2" });
    const request = {
      ...h.ctx(),
      resolved: unwrap(h.service.rebind(pinned)),
      context: h.context("hi"),
    };
    await h.service.stream(request).result();
    expect(h.fake.calls()[0]?.modelId).toBe("tape-1");
  });
});

describe("list, tokens, registration", () => {
  test("list reports catalog models; available follows the configured credential reference", () => {
    const h = createHarness({ tape: ANSWER });
    const [info] = h.service.list();
    expect(info).toMatchObject({
      ref: "tape/tape-1",
      reasoning: false,
      supportedThinkingLevels: ["off"],
      available: true,
      cost: { input: 1, output: 2 },
    });
    expect(h.service.list({ available: true })).toHaveLength(1);
    h.setSettings({ providers: [] });
    expect(h.service.list({ available: true })).toHaveLength(0);
    expect(h.service.list({ reasoning: true })).toHaveLength(0);
    expect(h.service.list({ provider: "other" })).toHaveLength(0);
  });

  test("tokens delegate to pi-ai estimation", () => {
    const h = createHarness({ tape: ANSWER });
    const tokens = h.service.tokens.estimateMessage({
      role: "user",
      content: "x".repeat(400),
      timestamp: 1,
    });
    expect(tokens).toBeGreaterThan(50);
    const estimate = h.service.tokens.estimateContext(h.context("hello").messages);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(estimate.lastUsageIndex).toBeNull();
  });

  test("provider registration is not available before M2", () => {
    const h = createHarness({ tape: ANSWER });
    expect(h.service.addProvider("helm", "x", { kind: "config" })).toMatchObject({
      ok: false,
      error: { kind: "invalid_provider" },
    });
    expect(() => h.service.registerProvider("helm", "x", { kind: "config" })).toThrow();
  });
});

describe("a loaded tape drives a two-step turn", () => {
  test("tool call turn then final answer", async () => {
    const loaded = await loadTape(`${import.meta.dir}/tapes/read-then-answer.tape.jsonl`);
    const h = createHarness({ tape: loaded });
    const first: AssistantMessage = await h.service.complete(h.request("read a.txt"));
    expect(first.stopReason).toBe("toolUse");
    expect(first.content[0]).toMatchObject({ type: "toolCall", name: "read" });
    const second = await h.service.complete(h.request("continue"));
    expect(second.stopReason).toBe("stop");
    h.player.assertExhausted();
    expect(h.service.usage.totals({ threadId: h.threadId })).toMatchObject({
      calls: 2,
      input: 280,
      output: 27,
    });
  });
});
