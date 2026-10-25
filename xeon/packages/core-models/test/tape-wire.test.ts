import { describe, expect, test } from "bun:test";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AssistantMessage, Context, FetchFunction } from "@earendil-works/pi-ai";
import {
  buildRecordedTape,
  findSecrets,
  loadTape,
  recordingFetch,
  renderRecordedTape,
  requestHashOf,
  scrubSecrets,
  tapeFetch,
  TapeLeftoverError,
  TapeMismatchError,
  TapeRecordError,
  type ModelTape,
  type RecordedTurn,
} from "../src/testing/index.ts";
import { fakeProvider, textSse, toolSse } from "./support/provider-http.ts";
import { rejectionOf } from "./support/rejection.ts";

// 가짜 키는 소스에 한 덩어리로 두지 않는다(gitleaks generic-api-key). 실행 때 이어 붙인다.
const KEY = ["sk", "ant", "api03", "ZZtestZZtestZZtest12345678"].join("-");

const CONTEXT: Context = {
  systemPrompt: "be terse",
  messages: [{ role: "user", content: "hi", timestamp: 1 }],
};

function clockOf(...times: number[]): () => number {
  let index = 0;
  return () => {
    const value = times[Math.min(index, times.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

async function callWith(
  fetchImpl: FetchFunction | undefined,
  context: Context,
): Promise<AssistantMessage> {
  const models = builtinModels();
  const model = models.getModel("anthropic", "claude-haiku-4-5");
  if (model === undefined) throw new Error("catalog lacks claude-haiku-4-5");
  const stream = models.streamSimple(model, context, {
    apiKey: KEY,
    maxTokens: 32,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
  return stream.result();
}

function textOf(message: AssistantMessage): string {
  return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

/** 가짜 provider를 녹화 fetch로 감싸 한 번 부르고, 테이프를 만들어 JSONL로 쓴 뒤 다시 읽는다 */
async function recordOne(
  body: string,
  chunkSize?: number,
  context: Context = CONTEXT,
): Promise<{ tape: ModelTape; message: AssistantMessage; text: string }> {
  const provider = fakeProvider(() => ({
    body,
    headers: { "set-cookie": "session=abc", "request-id": "req_1", "x-api-key": "echo" },
    ...(chunkSize === undefined ? {} : { chunkSize }),
  }));
  const recorder = recordingFetch({
    base: provider.fetch,
    now: clockOf(0, 5, 9, 20, 30),
    secrets: [KEY],
  });
  const message = await callWith(recorder.fetch, context);
  const turn: RecordedTurn = {
    role: "main",
    message,
    exchanges: recorder.take(),
  };
  const built = buildRecordedTape({
    scenario: "unit",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    piAi: "1.3.0",
    at: "2026-10-25T00:00:00.000Z",
    turns: [turn],
    secrets: [KEY],
  });
  if (!built.ok) throw new Error(`build failed: ${built.error.kind}`);
  const rendered = renderRecordedTape(built.value, [KEY]);
  if (!rendered.ok) throw new Error(`render failed: ${rendered.error.kind}`);
  const path = `${await Bun.$`mktemp -d`.text().then((t) => t.trim())}/unit.tape.jsonl`;
  await Bun.write(path, rendered.value);
  return { tape: await loadTape(path), message, text: rendered.value };
}

describe("tape_wire_request_hash", () => {
  test("key order and volatile fields do not change the hash, content does", () => {
    const a = requestHashOf(
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "x" }], user: "u1" }),
    );
    const b = requestHashOf(
      JSON.stringify({
        messages: [{ content: "x", role: "user" }],
        metadata: { user_id: "u2" },
        model: "m",
      }),
    );
    const c = requestHashOf(
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "y" }] }),
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("tape_wire_secrets", () => {
  test("patterns and known values are found without returning the value, then masked", () => {
    const text = `a ${KEY} b Bearer abcdefgh12345 c ${["gh", "p_"].join("")}${"a1".repeat(12)} d custom-value-9999`;
    const found = findSecrets(text, ["custom-value-9999"]);
    expect(found.map((f) => f.kind)).toEqual([
      "anthropic-key",
      "bearer-token",
      "github-token",
      "secret-value",
    ]);
    expect(JSON.stringify(found)).not.toContain(KEY);
    const scrubbed = scrubSecrets(text, ["custom-value-9999"]);
    expect(scrubbed).toBe("a [REDACTED] b Bearer [REDACTED] c [REDACTED] d [REDACTED]");
    expect(findSecrets(scrubbed, ["custom-value-9999"])).toEqual([]);
  });

  test("values shorter than the minimum are not treated as secrets", () => {
    expect(findSecrets("abc abc", ["abc"])).toEqual([]);
    expect(scrubSecrets("abc abc", ["abc"])).toBe("abc abc");
  });
});

describe("recording_fetch", () => {
  test("forces accept-encoding identity and keeps request headers out of the tape", async () => {
    const provider = fakeProvider(() => ({ body: textSse("hello", { input: 5, output: 3 }) }));
    const recorder = recordingFetch({
      base: provider.fetch,
      now: clockOf(0, 1, 2),
      secrets: [KEY],
    });
    await callWith(recorder.fetch, CONTEXT);
    const sent = provider.seen[0];
    expect(sent?.headers["accept-encoding"]).toBe("identity");
    // pi-ai는 키를 x-api-key로 보낸다. 그 값이 교환 기록에 있으면 안 된다
    expect(sent?.headers["x-api-key"]).toBe(KEY);
    const exchange = recorder.take();
    expect(exchange).toHaveLength(1);
    expect(JSON.stringify(exchange)).not.toContain(KEY);
    expect(JSON.stringify(exchange)).not.toContain("x-api-key");
    expect(recorder.take()).toEqual([]);
  });

  test("stores raw chunks with ms offsets and only allow-listed response headers", async () => {
    const { tape } = await recordOne(textSse("hello", { input: 5, output: 3 }));
    const wire = tape.turns[0]?.wire;
    expect(wire?.headers).toEqual({ "content-type": "text/event-stream", "request-id": "req_1" });
    expect(wire?.method).toBe("POST");
    expect(wire?.path).toBe("/v1/messages");
    expect(wire?.status).toBe(200);
    expect(wire?.request).toEqual({ model: "claude-haiku-4-5", messages: 1, tools: [] });
    const offsets = wire?.chunks.map((chunk) => chunk.t) ?? [];
    expect(offsets.length).toBe(6);
    expect(offsets.slice(0, 4)).toEqual([5, 9, 20, 30]);
    expect(offsets).toEqual(offsets.toSorted((a, b) => a - b));
    expect(wire?.chunks.map((chunk) => chunk.data).join("")).toBe(
      textSse("hello", { input: 5, output: 3 }),
    );
  });

  test("a compressed answer to an identity request stops the recording", async () => {
    const provider = fakeProvider(() => ({
      body: "x",
      headers: { "content-encoding": "gzip" },
    }));
    const recorder = recordingFetch({ base: provider.fetch, now: clockOf(0), secrets: [] });
    const rejected = await rejectionOf(
      recorder.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }),
    );
    expect(rejected).toBeInstanceOf(TapeRecordError);
  });

  test("a key in the request body stops the recording before the request leaves", async () => {
    const provider = fakeProvider(() => ({ body: "x" }));
    const recorder = recordingFetch({ base: provider.fetch, now: clockOf(0), secrets: [KEY] });
    const rejected = await rejectionOf(
      recorder.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: `my key ${KEY}` }] }),
      }),
    );
    expect(rejected).toBeInstanceOf(TapeRecordError);
    expect(provider.seen).toEqual([]);
  });

  test("a key echoed by the provider is masked in both the chunks and the parsed answer", async () => {
    const echo = textSse(`your key is ${KEY}`, { input: 5, output: 3 });
    const { tape, text } = await recordOne(echo);
    expect(text).not.toContain(KEY);
    const response = tape.turns[0]?.response;
    expect(response?.type === "message" ? response.content : []).toEqual([
      { type: "text", text: "your key is [REDACTED]" },
    ]);
    expect(tape.turns[0]?.wire?.chunks.map((c) => c.data).join("")).toContain("[REDACTED]");
  });

  test("a key split across two chunks is not written", async () => {
    const half = Math.floor(KEY.length / 2);
    // 같은 내용을 한 덩어리 크기로 쪼개서 키가 두 JSON 문자열에 걸치게 만든다
    const split = textSse(`k ${KEY}`, { input: 1, output: 1 });
    const cut = split.indexOf(KEY) + half;
    const recorder = recordingFetch({
      base: fakeProvider(() => ({ body: split, chunkSize: cut })).fetch,
      now: clockOf(0, 1, 2, 3),
      secrets: [KEY],
    });
    const message = await callWith(recorder.fetch, CONTEXT);
    const built = buildRecordedTape({
      scenario: "split",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      piAi: "1.3.0",
      at: "2026-10-25T00:00:00.000Z",
      turns: [{ role: "main", message, exchanges: recorder.take() }],
      secrets: [KEY],
    });
    expect(!built.ok && built.error.kind).toBe("secret_remains");
  });

  test("an HTTP error or a second request in one turn is not turned into a tape", async () => {
    const provider = fakeProvider(() => ({ status: 401, body: '{"error":"bad key"}' }));
    const recorder = recordingFetch({
      base: provider.fetch,
      now: clockOf(0, 1, 2),
      secrets: [KEY],
    });
    const message = await callWith(recorder.fetch, CONTEXT);
    const exchanges = recorder.take();
    const input = {
      scenario: "bad",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      piAi: "1.3.0",
      at: "2026-10-25T00:00:00.000Z",
      secrets: [KEY],
    };
    const failed = buildRecordedTape({ ...input, turns: [{ role: "main", message, exchanges }] });
    expect(failed.ok).toBe(false);
    const [first] = exchanges;
    if (first === undefined) throw new Error("no exchange recorded");
    const twice = buildRecordedTape({
      ...input,
      turns: [{ role: "main", message, exchanges: [first, first] }],
    });
    expect(!twice.ok && twice.error.kind).toBe("turn_exchange_count");
  });
});

describe("tape_fetch_replays_recorded_wire", () => {
  test("the replayed SSE gives pi-ai the same answer as the recorded response, with chunk boundaries kept", async () => {
    const body = textSse("hello there", { input: 5, output: 3 });
    // 이벤트 중간에서 끊기는 덩어리: 청크 경계 버그를 잡는 입력
    const { tape, message } = await recordOne(body, 37);
    const wire = tape.turns[0]?.wire;
    expect(wire?.chunks.length).toBe(Math.ceil(body.length / 37));
    const replay = tapeFetch(tape);
    const replayed = await callWith(replay.fetch, CONTEXT);
    replay.assertExhausted();
    expect(textOf(replayed)).toBe("hello there");
    expect(textOf(replayed)).toBe(textOf(message));
    expect(replayed.stopReason).toBe("stop");
    expect(replayed.usage.input).toBe(5);
    expect(replayed.usage.output).toBe(3);
    const recorded = tape.turns[0]?.response;
    expect(recorded?.type === "message" ? recorded.content : []).toEqual([
      { type: "text", text: "hello there" },
    ]);
  });

  test("a tool-call answer replays to the same tool call", async () => {
    const { tape } = await recordOne(toolSse("read", { path: "notes.txt" }), 50);
    const replay = tapeFetch(tape);
    const replayed = await callWith(replay.fetch, CONTEXT);
    replay.assertExhausted();
    expect(replayed.stopReason).toBe("toolUse");
    expect(
      replayed.content.flatMap((b) => (b.type === "toolCall" ? [[b.name, b.arguments]] : [])),
    ).toEqual([["read", { path: "notes.txt" }]]);
  });

  test("a request that differs from the recorded one is a miss that assertExhausted reports", async () => {
    const { tape } = await recordOne(textSse("hello", { input: 5, output: 3 }));
    const replay = tapeFetch(tape);
    const other: Context = {
      systemPrompt: "be terse",
      messages: [{ role: "user", content: "a different prompt", timestamp: 1 }],
    };
    const failed = await callWith(replay.fetch, other);
    // SDK가 fetch 오류를 삼켜 오류 응답으로 바꾼다. 시험이 모른 척하지 못하게 miss가 남는다
    expect(failed.stopReason).toBe("error");
    expect(replay.misses().length).toBeGreaterThan(0);
    expect(replay.misses()[0]?.path).toBe("/v1/messages");
    expect(replay.remaining()).toBe(1);
    expect(() => replay.assertExhausted()).toThrow(TapeMismatchError);
  });

  test("an entry nobody asked for fails the test", async () => {
    const { tape } = await recordOne(textSse("hello", { input: 5, output: 3 }));
    const replay = tapeFetch(tape);
    expect(replay.remaining()).toBe(1);
    expect(() => replay.assertExhausted()).toThrow(TapeLeftoverError);
  });

  test("two entries with the same request are consumed in tape order", async () => {
    const first = await recordOne(textSse("one", { input: 5, output: 3 }));
    const second = await recordOne(textSse("two", { input: 5, output: 3 }));
    const [a, b] = [first.tape.turns[0], second.tape.turns[0]];
    if (a === undefined || b === undefined) throw new Error("turns missing");
    const both: ModelTape = {
      header: first.tape.header,
      turns: [a, { ...b, n: 2 }],
    };
    const replay = tapeFetch(both);
    const one = await callWith(replay.fetch, CONTEXT);
    const two = await callWith(replay.fetch, CONTEXT);
    replay.assertExhausted();
    expect([textOf(one), textOf(two)]).toEqual(["one", "two"]);
  });

  test("recorded timing waits the recorded gap between chunks when a sleep is given", async () => {
    const { tape } = await recordOne(textSse("hello", { input: 5, output: 3 }));
    const waits: number[] = [];
    const replay = tapeFetch(tape, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await callWith(replay.fetch, CONTEXT);
    expect(waits.slice(0, 3)).toEqual([5, 4, 11]);
  });
});
