import { describe, expect, test } from "bun:test";
import { createModels, type FetchFunction } from "@earendil-works/pi-ai";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { ModelCallRequest, ModelRetryEvent, ResolvedModel } from "@fresnel/contracts/services";
import { createModelService, DEFAULT_MODELS_SETTINGS, type ModelsSettings } from "../src/index.ts";
import { memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { FAKE_KEY, unwrap } from "./support/harness.ts";
import { fakeProvider, textSse } from "./support/provider-http.ts";

// 실제 pi-ai anthropic-messages 어댑터에 가짜 fetch를 꽂아 파이프라인의 재시도 이벤트, retry-after 표지, 끊긴 스트림을 본다.
// 재시도 대기는 pi-ai가 실제 시간으로 기다리므로 retry-after 2초를 두 번 기다리는 시험은 시간 상한을 늘려 둔다.

const PROVIDER = "fake-anthropic";
const MODEL = `${PROVIDER}/claude-test`;
const RATE_LIMITED = '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}';
const PROMPT_TOO_LONG =
  '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}';
const FORBIDDEN =
  '{"type":"error","error":{"type":"permission_error","message":"this key cannot use that model"}}';

/** 첫 이벤트 묶음만 보내고 연결을 끊는 fetch. 앞부분 text가 온 뒤 끊긴 스트림을 흉내 낸다 */
function cutAfter(parts: readonly string[]): FetchFunction {
  const encoder = new TextEncoder();
  let index = 0;
  const respond = (): Promise<Response> => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[index];
        index += 1;
        if (part === undefined) {
          controller.error(new TypeError("terminated"));
          return;
        }
        controller.enqueue(encoder.encode(part));
      },
    });
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  };
  return Object.assign(respond, { preconnect: () => undefined });
}

function setup(fetch: FetchFunction, maxRetries: number) {
  const clock = manualClock();
  const secrets = memorySecrets({ "tape-key": FAKE_KEY });
  const settings: ModelsSettings = {
    ...DEFAULT_MODELS_SETTINGS,
    default: MODEL,
    retry: { maxRetries, baseDelayMs: 500, maxDelayMs: 60_000 },
  };
  const service = createModelService({
    buildModels: (credentials) => createModels({ credentials }),
    secrets: secrets.service,
    clock,
    settings: () => settings,
    scheduler: clock,
    fetch,
  });
  unwrap(
    service.addProvider("ext.test", PROVIDER, {
      kind: "config",
      baseUrl: "http://127.0.0.1:9/anthropic",
      api: "anthropic-messages",
      apiKey: "secret://tape-key",
      models: [
        {
          id: "claude-test",
          reasoning: false,
          input: ["text"],
          contextWindow: 200_000,
          maxTokens: 8192,
        },
      ],
    }),
  );
  const resolved: ResolvedModel = unwrap(service.resolve("main"));
  const threadId = fixedIdFactory().next("thr");
  const call = (onRetry?: (event: ModelRetryEvent) => void): ModelCallRequest => ({
    threadId,
    turnId: null,
    stepId: null,
    role: "main",
    resolved,
    context: { messages: [{ role: "user", content: "hi", timestamp: clock.now() }] },
    ...(onRetry === undefined ? {} : { onRetry }),
  });
  return { service, call };
}

describe("retry_state_events_through_the_pipeline", () => {
  test("two 429s with retry-after 2 are reported as retries 1 and 2, then the success ends the call", async () => {
    let calls = 0;
    const provider = fakeProvider(() => {
      calls += 1;
      if (calls <= 2) return { status: 429, headers: { "retry-after": "2" }, body: RATE_LIMITED };
      return { body: textSse("ok", { input: 10, output: 1 }) };
    });
    const { service, call } = setup(provider.fetch, 3);
    const seen: ModelRetryEvent[] = [];
    const message = await service.stream(call((event) => seen.push(event))).result();
    expect(provider.seen).toHaveLength(3);
    expect(seen).toEqual([
      { attempt: 1, maxRetries: 3, waitMs: 2000 },
      { attempt: 2, maxRetries: 3, waitMs: 2000 },
    ]);
    expect(message.stopReason).toBe("stop");
    expect(message.errorMessage).toBeUndefined();
  }, 20_000);

  test("a 429 that keeps coming ends with the retry-after seconds in the message and is rate_limited", async () => {
    const provider = fakeProvider(() => ({
      status: 429,
      headers: { "retry-after": "2" },
      body: RATE_LIMITED,
    }));
    const { service, call } = setup(provider.fetch, 1);
    const seen: ModelRetryEvent[] = [];
    const message = await service.stream(call((event) => seen.push(event))).result();
    expect(provider.seen).toHaveLength(2);
    expect(seen).toEqual([{ attempt: 1, maxRetries: 1, waitMs: 2000 }]);
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toMatch(/ \[retry-after=2\]$/);
    expect(service.classify(message)).toBe("rate_limited");
  }, 20_000);

  test("a 403 is permission_denied, not auth, and is not retried", async () => {
    const provider = fakeProvider(() => ({ status: 403, body: FORBIDDEN }));
    const { service, call } = setup(provider.fetch, 3);
    const seen: ModelRetryEvent[] = [];
    const message = await service.stream(call((event) => seen.push(event))).result();
    expect(provider.seen).toHaveLength(1);
    expect(seen).toEqual([]);
    expect(message.errorMessage).toContain("permission_error");
    expect(message.errorMessage).not.toMatch(/\[retry-after=/);
    expect(service.classify(message)).toBe("permission_denied");
  });

  test("a complete call retried after a 429 announces the call-level retry with its backoff", async () => {
    // complete는 provider 요청 재시도를 끄고 호출 단계 재시도(retryAssistantCall)만 쓴다. 그 재시도도 알린다
    let calls = 0;
    const provider = fakeProvider(() => {
      calls += 1;
      if (calls === 1) return { status: 429, body: RATE_LIMITED };
      return { body: textSse("요약", { input: 10, output: 1 }) };
    });
    const { service, call } = setup(provider.fetch, 3);
    const seen: ModelRetryEvent[] = [];
    const message = await service.complete(call((event) => seen.push(event)));
    expect(provider.seen).toHaveLength(2);
    expect(seen).toEqual([{ attempt: 1, maxRetries: 3, waitMs: 500 }]);
    expect(message.stopReason).toBe("stop");
  }, 20_000);

  test("a 400 prompt is too long is not retried and classifies as context_overflow", async () => {
    // Anthropic이 입력이 창을 넘었다고 400으로 답하는 모양. 파이프라인이 재시도하지 않고 종결 메시지로 남겨야 core-loop가 컴팩션한다
    const provider = fakeProvider(() => ({ status: 400, body: PROMPT_TOO_LONG }));
    const { service, call } = setup(provider.fetch, 3);
    const seen: ModelRetryEvent[] = [];
    const message = await service.stream(call((event) => seen.push(event))).result();
    expect(provider.seen).toHaveLength(1);
    expect(seen).toEqual([]);
    expect(message.stopReason).toBe("error");
    // 종결 문장은 상태 코드와 응답 본문을 그대로 싣는다. 데스크톱·CLI의 오류 문장 판정이 이 모양을 읽는다
    expect(message.errorMessage).toBe(`400 ${PROMPT_TOO_LONG}`);
    expect(service.classify(message, 200_000)).toBe("context_overflow");
  });

  test("a stream cut after the first text is stream_interrupted and classified as transport", async () => {
    // message_start, content_block_start, content_block_delta까지만 보내고 끊는다
    const parts = textSse("앞부분", { input: 10, output: 1 })
      .split(/(?<=\n\n)/)
      .slice(0, 3);
    const { service, call } = setup(cutAfter(parts), 3);
    const message = await service.stream(call()).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage?.startsWith("stream_interrupted: ")).toBe(true);
    expect(message.content).toMatchObject([{ type: "text", text: "앞부분" }]);
    expect(service.classify(message)).toBe("transport");
  });
});
