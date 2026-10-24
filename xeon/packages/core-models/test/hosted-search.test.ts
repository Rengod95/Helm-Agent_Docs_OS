import { describe, expect, test } from "bun:test";
import type { HostedSearchRequest } from "@xeon/contracts/services";
import { createStreamAccumulator, type AccumulatedMessage } from "../src/anthropic-stream.ts";
import {
  decodeContinuation,
  encodeContinuation,
  HOSTED_SEARCH_THREAD,
} from "../src/hosted-search.ts";
import { tape, type ModelTape } from "../src/testing/index.ts";
import { flushMicrotasks } from "@xeon/ext-host/testing";
import { searchEvents, type SearchEventsInput } from "./support/anthropic-events.ts";
import { spyDispatcher } from "./support/dispatcher.ts";
import { createHarness, FAKE_KEY, type Harness } from "./support/harness.ts";
import { at } from "./support/json.ts";
import { memoryLogger, type LogLine } from "./support/logger.ts";

// L1.models.plan L1C.3 HostedSearchPort 테이프 시험. 네트워크 없이 어댑터의 원시 SSE 이벤트를 테이프로 재생한다.

const SYSTEM = "Search the web for the user's query and stop. Do not answer.";

function request(patch: Partial<HostedSearchRequest> = {}): HostedSearchRequest {
  return {
    model: "auto",
    system: SYSTEM,
    query: "xeon runtime",
    maxOutputTokens: 512,
    domains: { allow: [], deny: [] },
    continuation: null,
    ...patch,
  };
}

function searchTape(...turns: readonly SearchEventsInput[]): ModelTape {
  return tape(
    "core-models/hosted-search",
    turns.map((input) => ({
      role: "search" as const,
      response: {
        type: "message" as const,
        content: [],
        stopReason: "stop" as const,
        usage: { input: input.inputTokens ?? 120, output: input.outputTokens ?? 30 },
      },
      rawEvents: searchEvents(input),
    })),
  );
}

function harness(
  turns: readonly SearchEventsInput[],
  extra: { readonly secretValues?: Record<string, string>; readonly logger?: LogLine[] } = {},
): Harness {
  return createHarness({
    tape: searchTape(...turns),
    provider: {
      id: "anthropic",
      api: "anthropic-messages",
      roleOf: () => "search",
      baseUrl: "https://api.anthropic.com",
    },
    ...(extra.secretValues === undefined ? {} : { secretValues: extra.secretValues }),
    ...(extra.logger === undefined ? {} : { logger: memoryLogger(extra.logger) }),
  });
}

function hosted(h: Harness): NonNullable<Harness["service"]["hostedSearch"]> {
  const port = h.service.hostedSearch;
  if (port === undefined) throw new Error("hostedSearch is not provided");
  return port;
}

const SIGNAL = new AbortController().signal;

describe("support", () => {
  test("an anthropic-messages model from the anthropic provider supports hosted search", () => {
    const h = harness([{}]);
    expect(hosted(h).support("auto")).toEqual({
      supported: true,
      provider: "anthropic",
      modelId: "tape-1",
    });
    expect(hosted(h).support("anthropic/tape-1")).toMatchObject({ supported: true });
  });

  test("another api has no hosted search and an unknown model is no_model", () => {
    const other = createHarness({ tape: searchTape({}) });
    expect(other.service.hostedSearch?.support("auto")).toEqual({
      supported: false,
      reason: "no_hosted_search",
    });
    const h = harness([{}]);
    expect(hosted(h).support("anthropic/does-not-exist")).toEqual({
      supported: false,
      reason: "no_model",
    });
    expect(hosted(h).support("not a reference")).toEqual({ supported: false, reason: "no_model" });
  });

  test("a third-party host behind the anthropic api is not treated as Anthropic", () => {
    const h = createHarness({
      tape: searchTape({}),
      provider: {
        id: "kimi",
        api: "anthropic-messages",
        baseUrl: "https://api.kimi.example/anthropic",
      },
    });
    expect(h.service.hostedSearch?.support("auto")).toEqual({
      supported: false,
      reason: "no_hosted_search",
    });
  });

  test("support never calls the model or the secret service", () => {
    const h = harness([{}]);
    hosted(h).support("auto");
    expect(h.fake.calls()).toHaveLength(0);
    expect(h.secrets.leaseCalls()).toBe(0);
  });
});

describe("hosted_search_single_turn", () => {
  test("sends one request with the server tool and maps results, citations, usage", async () => {
    const h = harness([
      {
        hits: [
          { url: "https://example.org/a", title: "A", pageAge: "2 days ago" },
          { url: "https://example.org/b", title: "B" },
        ],
        text: "ignored answer",
        citations: [{ url: "https://example.org/a", title: "A", cited: "cited sentence" }],
        inputTokens: 200,
        outputTokens: 40,
      },
    ]);
    const result = await hosted(h).search(request(), SIGNAL);
    expect(result).toMatchObject({
      ok: true,
      value: {
        stopReason: "end_turn",
        text: "ignored answer",
        results: [
          { url: "https://example.org/a", title: "A", pageAge: "2 days ago" },
          { url: "https://example.org/b", title: "B", pageAge: null },
        ],
        citations: [{ url: "https://example.org/a", title: "A", citedText: "cited sentence" }],
        usage: { inputTokens: 200, outputTokens: 40, searchRequests: 1 },
        model: { provider: "anthropic", modelId: "tape-1" },
        continuation: null,
      },
    });
    expect(h.fake.calls()).toHaveLength(1);
    const payload = h.fake.calls()[0]?.payload;
    expect(at(payload, "tools")).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: 1 },
    ]);
    // 시스템 프롬프트와 정규화한 검색어 한 줄이 전부다
    expect(JSON.stringify(at(payload, "messages"))).toContain(SYSTEM);
    expect(JSON.stringify(at(payload, "messages"))).toContain("xeon runtime");
    h.player.assertExhausted();
  });

  test("encrypted_content never reaches the caller", async () => {
    const h = harness([{ text: "t", citations: [{ url: "https://x.example", cited: "c" }] }]);
    const result = await hosted(h).search(request(), SIGNAL);
    expect(JSON.stringify(result)).not.toContain("ENCRYPTED");
    expect(JSON.stringify(result)).not.toContain("ENC-IDX");
  });

  test("the call is a search-role call with no cache and its usage is metered apart from threads", async () => {
    const h = harness([{ inputTokens: 300, outputTokens: 50 }]);
    await hosted(h).search(request(), SIGNAL);
    expect(h.fake.calls()[0]?.sessionId).toBeUndefined();
    expect(h.fake.calls()[0]?.role).toBe("search");
    expect(h.fake.calls()[0]?.reasoning).toBeUndefined();
    expect(
      h.service.usage.totals({ threadId: HOSTED_SEARCH_THREAD, role: "search" }),
    ).toMatchObject({
      calls: 1,
      input: 300,
      output: 50,
    });
  });

  test("an explicit model reference and the search role routing both pick the model", async () => {
    const h = createHarness({
      tape: searchTape({}),
      provider: {
        id: "anthropic",
        api: "anthropic-messages",
        roleOf: () => "search",
        models: [{ id: "big" }, { id: "small" }],
      },
    });
    h.setSettings({ default: "anthropic/big", routing: { search: "anthropic/small" } });
    const viaRole = await hosted(h).search(request(), SIGNAL);
    expect(viaRole.ok && viaRole.value.model.modelId).toBe("small");
  });

  test("request points are not fired for a call that belongs to no thread", async () => {
    const spy = spyDispatcher();
    const h = createHarness({
      tape: searchTape({}),
      dispatcher: spy.dispatcher,
      provider: { id: "anthropic", api: "anthropic-messages", roleOf: () => "search" },
    });
    await hosted(h).search(request(), SIGNAL);
    expect(spy.selects).toHaveLength(0);
    expect(spy.headers).toHaveLength(0);
    expect(spy.rawEvents).toHaveLength(0);
  });
});

async function toolOf(domains: HostedSearchRequest["domains"]): Promise<unknown> {
  const h = harness([{}]);
  await hosted(h).search(request({ domains }), SIGNAL);
  return at(h.fake.calls()[0]?.payload, "tools", 0);
}

describe("domain filters", () => {
  test("allow only, deny only", async () => {
    expect(await toolOf({ allow: ["a.example"], deny: [] })).toMatchObject({
      allowed_domains: ["a.example"],
    });
    const deny = await toolOf({ allow: [], deny: ["b.example"] });
    expect(deny).toMatchObject({ blocked_domains: ["b.example"] });
    expect(at(deny, "allowed_domains")).toBeUndefined();
  });

  test("both lists: only allow is sent and the dropped deny list is logged", async () => {
    const lines: LogLine[] = [];
    const h = harness([{}], { logger: lines });
    await hosted(h).search(
      request({ domains: { allow: ["a.example"], deny: ["b.example"] } }),
      SIGNAL,
    );
    const tool = at(h.fake.calls()[0]?.payload, "tools", 0);
    expect(at(tool, "allowed_domains")).toEqual(["a.example"]);
    expect(at(tool, "blocked_domains")).toBeUndefined();
    expect(lines.some((line) => line.event === "hosted_search.deny_not_sent")).toBe(true);
  });
});

describe("pause_turn continuation", () => {
  test("pause_turn returns an opaque continuation that the next request sends back as an assistant turn", async () => {
    const h = harness([{ stopReason: "pause_turn" }, { stopReason: "end_turn" }]);
    const first = await hosted(h).search(request(), SIGNAL);
    expect(first.ok && first.value.stopReason).toBe("pause_turn");
    const continuation = first.ok ? first.value.continuation : null;
    expect(continuation).not.toBeNull();
    if (continuation === null) return;
    // 호출자는 안쪽을 읽지 않는다. 안에는 encrypted_content가 있고 응답 객체에는 없다
    expect(JSON.stringify(first)).not.toContain("ENCRYPTED");
    expect(JSON.stringify(decodeContinuation(continuation))).toContain("ENCRYPTED-1");

    const second = await hosted(h).search(request({ continuation }), SIGNAL);
    expect(second.ok && second.value.stopReason).toBe("end_turn");
    expect(second.ok && second.value.continuation).toBeNull();
    const messages = at(h.fake.calls()[1]?.payload, "messages");
    expect(Array.isArray(messages)).toBe(true);
    const last = Array.isArray(messages) ? messages.at(-1) : undefined;
    expect(at(last, "role")).toBe("assistant");
    expect(JSON.stringify(at(last, "content"))).toContain("ENCRYPTED-1");
    expect(JSON.stringify(at(last, "content"))).toContain("server_tool_use");
    // 첫 요청과 이어 요청에서 사용자 메시지는 같다
    expect(JSON.stringify(messages)).toContain("xeon runtime");
  });

  test("an invalid continuation is an upstream error and sends nothing", async () => {
    const h = harness([{}]);
    const result = await hosted(h).search(request({ continuation: "garbage" }), SIGNAL);
    expect(result).toMatchObject({ ok: false, error: { kind: "upstream", status: null } });
    expect(h.fake.calls()).toHaveLength(0);
  });

  test("encode and decode are inverse for response blocks", () => {
    const blocks = [{ type: "text", text: "é한글" }];
    expect(decodeContinuation(encodeContinuation(blocks))).toEqual(blocks);
    expect(decodeContinuation("hs1:!!!")).toBeUndefined();
    expect(decodeContinuation("other:abc")).toBeUndefined();
  });
});

describe("stop reasons", () => {
  test("max_tokens keeps the results that arrived", async () => {
    const h = harness([{ stopReason: "max_tokens" }]);
    const result = await hosted(h).search(request(), SIGNAL);
    expect(result).toMatchObject({
      ok: true,
      value: { stopReason: "max_tokens", results: [{ url: "https://example.org/a" }] },
    });
  });

  test("a refusal is a normal stop reason, not an error", async () => {
    const table = tape("core-models/hosted-refusal", [
      {
        role: "search",
        response: {
          type: "error",
          reason: "error",
          errorMessage: "The model refused to complete the request",
        },
        rawEvents: searchEvents({ stopReason: "refusal", hits: [] }),
      },
    ]);
    const h = createHarness({
      tape: table,
      provider: { id: "anthropic", api: "anthropic-messages", roleOf: () => "search" },
    });
    const result = await hosted(h).search(request(), SIGNAL);
    expect(result).toMatchObject({ ok: true, value: { stopReason: "refusal", results: [] } });
  });
});

function errorHarness(errorMessage: string): Harness {
  return createHarness({
    tape: tape("core-models/hosted-error", [
      { role: "search", response: { type: "error", reason: "error", errorMessage } },
    ]),
    provider: { id: "anthropic", api: "anthropic-messages", roleOf: () => "search" },
  });
}

describe("failures", () => {
  test("a 400 about web search being disabled for the organization is org_disabled", async () => {
    const h = errorHarness(
      '400 {"error":{"message":"The web_search tool is not enabled for your organization"}}',
    );
    expect(await hosted(h).search(request(), SIGNAL)).toEqual({
      ok: false,
      error: { kind: "org_disabled" },
    });
  });

  test("an unrelated 400 is an upstream error with its status", async () => {
    const h = errorHarness("400 invalid request: max_tokens too small");
    expect(await hosted(h).search(request(), SIGNAL)).toEqual({
      ok: false,
      error: {
        kind: "upstream",
        status: 400,
        message: "400 invalid request: max_tokens too small",
      },
    });
  });

  test("429 is rate_limited and 5xx is upstream", async () => {
    expect(
      await hosted(errorHarness("429 rate limit exceeded")).search(request(), SIGNAL),
    ).toMatchObject({ ok: false, error: { kind: "rate_limited" } });
    expect(await hosted(errorHarness("529 overloaded")).search(request(), SIGNAL)).toMatchObject({
      ok: false,
      error: { kind: "upstream", status: 529 },
    });
  });

  test("a tool error block without results maps too_many_requests and others", async () => {
    const limited = harness([{ toolError: "too_many_requests" }]);
    expect(await hosted(limited).search(request(), SIGNAL)).toMatchObject({
      ok: false,
      error: { kind: "rate_limited" },
    });
    const unavailable = harness([{ toolError: "unavailable" }]);
    expect(await hosted(unavailable).search(request(), SIGNAL)).toMatchObject({
      ok: false,
      error: { kind: "upstream", message: "web_search_tool_result_error: unavailable" },
    });
  });

  test("an error event inside the stream is an upstream error", async () => {
    const table = tape("core-models/hosted-stream-error", [
      {
        role: "search",
        response: { type: "message", content: [], stopReason: "stop" },
        rawEvents: [{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }],
      },
    ]);
    const h = createHarness({
      tape: table,
      provider: { id: "anthropic", api: "anthropic-messages", roleOf: () => "search" },
    });
    expect(await hosted(h).search(request(), SIGNAL)).toMatchObject({
      ok: false,
      error: { kind: "upstream", message: "overloaded_error: Overloaded" },
    });
  });

  test("an already aborted signal is cancelled without a request", async () => {
    const h = harness([{}]);
    const controller = new AbortController();
    controller.abort();
    expect(await hosted(h).search(request(), controller.signal)).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
    expect(h.fake.calls()).toHaveLength(0);
  });

  test("aborting while the provider stalls is cancelled", async () => {
    const h = createHarness({
      tape: tape("core-models/hosted-stall", [{ role: "search", response: { type: "stall" } }]),
      provider: { id: "anthropic", api: "anthropic-messages", roleOf: () => "search" },
    });
    const controller = new AbortController();
    const pending = hosted(h).search(request(), controller.signal);
    await flushMicrotasks();
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  test("a subscription oauth token on the default provider is blocked before the request", async () => {
    const h = harness([{}], { secretValues: { "tape-key": "sk-ant-oat01-fake" } });
    const result = await hosted(h).search(request(), SIGNAL);
    expect(result).toMatchObject({ ok: false, error: { kind: "upstream" } });
    expect(!result.ok && result.error.kind === "upstream" && result.error.message).toStartWith(
      "oauth_token_on_default_provider:",
    );
    expect(h.fake.calls()).toHaveLength(0);
  });

  test("the resolved key reaches the provider and never the result or the logs", async () => {
    const lines: LogLine[] = [];
    const h = harness([{}], { logger: lines });
    const result = await hosted(h).search(request(), SIGNAL);
    expect(h.fake.calls()[0]?.apiKey).toBe(FAKE_KEY);
    expect(JSON.stringify([result, lines])).not.toContain(FAKE_KEY);
  });
});

function accumulate(events: readonly unknown[]): AccumulatedMessage {
  const accumulator = createStreamAccumulator();
  for (const event of events) accumulator.push(event);
  return accumulator.snapshot();
}

describe("stream accumulator", () => {
  test("rebuilds blocks in index order with the tool input from partial json", () => {
    const snapshot = accumulate(
      searchEvents({
        query: "hello world",
        text: "answer",
        citations: [{ url: "https://u.example", cited: "c" }],
      }),
    );
    expect(snapshot.blocks.map((block) => block["type"])).toEqual([
      "server_tool_use",
      "web_search_tool_result",
      "text",
    ]);
    expect(snapshot.blocks[0]?.["input"]).toEqual({ query: "hello world" });
    expect(snapshot.blocks[2]?.["citations"]).toHaveLength(1);
    expect(snapshot).toMatchObject({
      stopReason: "end_turn",
      inputTokens: 120,
      outputTokens: 30,
      searchRequests: 1,
      streamError: null,
    });
  });

  test("ignores events it does not know and malformed events", () => {
    const snapshot = accumulate([
      "text",
      null,
      { type: "ping" },
      { type: "content_block_delta", index: 9, delta: { type: "text_delta", text: "x" } },
      { type: "content_block_start", index: "x", content_block: {} },
    ]);
    expect(snapshot.blocks).toEqual([]);
    expect(snapshot.stopReason).toBeNull();
  });

  test("tool input that is not valid json stays as received", () => {
    const snapshot = accumulate([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "server_tool_use", id: "s", name: "web_search", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{" },
      },
      { type: "content_block_stop", index: 0 },
    ]);
    expect(snapshot.blocks[0]?.["input"]).toEqual({});
  });
});
