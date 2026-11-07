import { describe, expect, test } from "bun:test";
import type { FetchFunction } from "@earendil-works/pi-ai";
import type { ModelRetryEvent } from "@fresnel/contracts/services";
import { createRetryFetch, RETRYING_FETCH_APIS } from "../src/retry-fetch.ts";
import { manualClock } from "./support/clock.ts";
import { memoryLogger, type LogLine } from "./support/logger.ts";

// 준비한 응답을 차례로 돌려주는 가짜 fetch. 준비한 것을 다 쓰면 마지막 것을 되풀이한다. Error는 연결 예외로 던진다
type Reply =
  | { readonly status: number; readonly headers?: Readonly<Record<string, string>> }
  | Error;

function scripted(replies: readonly Reply[]): FetchFunction {
  let index = 0;
  const respond = (): Promise<Response> => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply === undefined) return Promise.reject(new Error("no scripted reply"));
    if (reply instanceof Error) return Promise.reject(reply);
    const headers = reply.headers === undefined ? {} : { headers: reply.headers };
    return Promise.resolve(new Response("{}", { status: reply.status, ...headers }));
  };
  return Object.assign(respond, { preconnect: () => undefined });
}

interface Setup {
  readonly replies: readonly Reply[];
  readonly maxRetries?: number;
  readonly maxDelayMs?: number;
  readonly signal?: AbortSignal;
  readonly throwing?: boolean;
}

function setup(options: Setup) {
  const clock = manualClock();
  const events: ModelRetryEvent[] = [];
  const lines: LogLine[] = [];
  const http = createRetryFetch({
    base: scripted(options.replies),
    clock,
    maxRetries: options.maxRetries ?? 3,
    maxDelayMs: options.maxDelayMs ?? 60_000,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    logger: memoryLogger(lines),
    onRetry: (event) => {
      events.push(event);
      if (options.throwing === true) throw new Error("listener broke");
    },
  });
  return { clock, events, lines, http };
}

const TARGET = "http://127.0.0.1:9/fake";

describe("retry_events_from_the_wrapped_fetch", () => {
  test("two 429s with retry-after 2 are reported as retries 1 and 2 with 2000 ms; the success is not", async () => {
    const h = setup({
      replies: [
        { status: 429, headers: { "retry-after": "2" } },
        { status: 429, headers: { "retry-after": "2" } },
        { status: 200 },
      ],
    });
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([
      { attempt: 1, maxRetries: 3, waitMs: 2000 },
      { attempt: 2, maxRetries: 3, waitMs: 2000 },
    ]);
    expect(h.http.last()).toEqual({ status: 200, serverDelayMs: null });
  });

  test("without a server wait the estimate doubles from 500 ms and stops at 8000 ms", async () => {
    const h = setup({
      replies: [
        { status: 503 },
        { status: 503 },
        { status: 503 },
        { status: 503 },
        { status: 503 },
        { status: 503 },
      ],
      maxRetries: 5,
    });
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    expect(h.events.map((event) => event.waitMs)).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(h.events.map((event) => event.attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  test("retry-after-ms wins over retry-after", async () => {
    const h = setup({
      replies: [
        { status: 429, headers: { "retry-after-ms": "1500", "retry-after": "9" } },
        { status: 200 },
      ],
    });
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([{ attempt: 1, maxRetries: 3, waitMs: 1500 }]);
    expect(h.http.last()).toEqual({ status: 429, serverDelayMs: 1500 });
  });

  test("an HTTP date in retry-after is read against the clock", async () => {
    const clock = manualClock();
    const later = new Date(clock.now() + 5000).toUTCString();
    const events: ModelRetryEvent[] = [];
    const http = createRetryFetch({
      base: scripted([{ status: 429, headers: { "retry-after": later } }, { status: 200 }]),
      clock,
      maxRetries: 3,
      maxDelayMs: 60_000,
      onRetry: (event) => events.push(event),
    });
    await http.fetch(TARGET);
    expect(events).toEqual([{ attempt: 1, maxRetries: 3, waitMs: 5000 }]);
    expect(http.last()?.serverDelayMs).toBe(5000);
  });

  test("x-should-retry overrides the status: true retries a 400, false stops a 429", async () => {
    const h = setup({
      replies: [
        { status: 400, headers: { "x-should-retry": "true" } },
        { status: 429, headers: { "x-should-retry": "false" } },
      ],
    });
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([{ attempt: 1, maxRetries: 3, waitMs: 500 }]);
  });

  test("statuses that pi-ai does not retry are not reported", async () => {
    const h = setup({ replies: [{ status: 400 }, { status: 401 }, { status: 403 }] });
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([]);
  });

  test("a retry-after above the cap is not retried, so it is not reported", async () => {
    const h = setup({
      replies: [{ status: 429, headers: { "retry-after": "120" } }, { status: 200 }],
      maxDelayMs: 60_000,
    });
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([]);
  });

  test("with no retries left nothing is reported, and maxRetries 0 reports nothing at all", async () => {
    const bounded = setup({
      replies: [{ status: 429 }, { status: 429 }, { status: 429 }],
      maxRetries: 1,
    });
    await bounded.http.fetch(TARGET);
    await bounded.http.fetch(TARGET);
    await bounded.http.fetch(TARGET);
    expect(bounded.events).toEqual([{ attempt: 1, maxRetries: 1, waitMs: 500 }]);

    const off = setup({ replies: [{ status: 429 }], maxRetries: 0 });
    await off.http.fetch(TARGET);
    expect(off.events).toEqual([]);
    expect(off.http.last()).toEqual({ status: 429, serverDelayMs: null });
  });

  test("a connection error is reported as a retry with the estimate and is still thrown", async () => {
    const h = setup({ replies: [new TypeError("fetch failed"), { status: 200 }] });
    const outcome = await h.http.fetch(TARGET).then(
      () => "resolved",
      (error: unknown) => (error instanceof TypeError ? error.message : "other"),
    );
    expect(outcome).toBe("fetch failed");
    expect(h.http.last()).toEqual({ status: null, serverDelayMs: null });
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([{ attempt: 1, maxRetries: 3, waitMs: 500 }]);
  });

  test("an aborted request reports no retry", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = setup({ replies: [{ status: 429 }], signal: controller.signal });
    await h.http.fetch(TARGET);
    expect(h.events).toEqual([]);
  });

  test("a listener that throws does not stop the request, and the failure is logged", async () => {
    const h = setup({ replies: [{ status: 429 }], throwing: true });
    const response = await h.http.fetch(TARGET);
    expect(response.status).toBe(429);
    expect(h.lines.map((line) => [line.level, line.event])).toEqual([
      ["warn", "model.retry_listener_failed"],
    ]);
  });
});

describe("retrying_fetch_apis", () => {
  test("the anthropic and openai adapters take the wrapped fetch, google and mistral do not", () => {
    expect(RETRYING_FETCH_APIS.has("anthropic-messages")).toBe(true);
    expect(RETRYING_FETCH_APIS.has("openai-completions")).toBe(true);
    expect(RETRYING_FETCH_APIS.has("google-generative-ai")).toBe(false);
    expect(RETRYING_FETCH_APIS.has("mistral-conversations")).toBe(false);
  });
});
