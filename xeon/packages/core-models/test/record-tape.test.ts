import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { loadTape, tapeFetch } from "../src/testing/index.ts";
import { KEY_HINT, main, type RecordDeps } from "../scripts/record-tape.ts";
import { SCENARIOS } from "../scripts/scenarios.ts";
import {
  fakeProvider,
  textSse,
  toolSse,
  type FakeProviderResponse,
} from "./support/provider-http.ts";

const KEY = ["sk", "ant", "api03", "ZZrecorderZZrecorder1234567"].join("-");

interface Rig {
  readonly deps: RecordDeps;
  readonly out: string;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly seen: { readonly headers: Readonly<Record<string, string>> }[];
}

async function rig(
  env: Record<string, string | undefined>,
  reply: (request: { readonly body: string }) => FakeProviderResponse,
): Promise<Rig> {
  const dir = await mkdtemp(join(tmpdir(), "xeon-tape-"));
  const provider = fakeProvider(reply);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let tick = 0;
  return {
    deps: {
      env,
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
      fetch: provider.fetch,
      now: () => {
        tick += 3;
        return tick;
      },
      clock: () => new Date("2026-10-25T09:00:00.000Z"),
      outDir: dir,
      models: () => builtinModels(),
      piAiVersion: () => Promise.resolve("1.3.0"),
    },
    out: join(dir, "hello-text.tape.jsonl"),
    stdout,
    stderr,
    seen: provider.seen,
  };
}

const hello = () => ({ body: textSse("Hi there", { input: 20, output: 4 }) });

describe("record_tape_entry", () => {
  test("a missing key exits 2 with the secret-add hint and sends nothing", async () => {
    const r = await rig({}, hello);
    const code = await main(["hello-text", r.out], r.deps);
    expect(code).toBe(2);
    expect(r.stderr.join("")).toContain(KEY_HINT);
    expect(r.seen).toEqual([]);
    expect(await Bun.file(r.out).exists()).toBe(false);
  });

  test("a CI run, a short key and a subscription token are environment problems (exit 2)", async () => {
    const ci = await rig({ ANTHROPIC_API_KEY: KEY, CI: "true" }, hello);
    expect(await main(["hello-text", ci.out], ci.deps)).toBe(2);
    const short = await rig({ ANTHROPIC_API_KEY: "short" }, hello);
    expect(await main(["hello-text", short.out], short.deps)).toBe(2);
    const oauth = await rig(
      { ANTHROPIC_API_KEY: ["sk", "ant", "oat01", "abcdefghijklmnop"].join("-") },
      hello,
    );
    expect(await main(["hello-text", oauth.out], oauth.deps)).toBe(2);
    expect([ci, short, oauth].flatMap((x) => x.seen)).toEqual([]);
  });

  test("bad arguments exit 1: unknown scenario, wrong number of arguments, output outside the tape folder", async () => {
    const r = await rig({ ANTHROPIC_API_KEY: KEY }, hello);
    expect(await main(["no-such", r.out], r.deps)).toBe(1);
    expect(r.stderr.join("")).toContain("hello-text");
    expect(await main(["hello-text"], r.deps)).toBe(1);
    expect(await main(["hello-text", join(tmpdir(), "elsewhere.tape.jsonl")], r.deps)).toBe(1);
    expect(r.seen).toEqual([]);
  });

  test("records a tape that replays through tapeFetch, and never writes the key", async () => {
    // 서버가 받은 키를 그대로 되풀이하는 최악의 경우
    const r = await rig({ ANTHROPIC_API_KEY: KEY }, () => ({
      body: textSse(`Hi, key ${KEY}`, { input: 20, output: 4 }),
    }));
    const code = await main(["hello-text", r.out], r.deps);
    expect(r.stderr.join("")).toBe("");
    expect(code).toBe(0);
    // 요청은 환경의 키로 나가고 identity 인코딩을 요구했다
    expect(r.seen[0]?.headers["x-api-key"]).toBe(KEY);
    expect(r.seen[0]?.headers["accept-encoding"]).toBe("identity");
    const text = await Bun.file(r.out).text();
    expect(text).not.toContain(KEY);
    expect(r.stdout.join("") + r.stderr.join("")).not.toContain(KEY);
    const tape = await loadTape(r.out);
    expect(tape.header).toEqual({
      kind: "header",
      format: "xeon.model-tape.v1",
      tapeId: "recorded/hello-text",
      origin: "recorded",
      matching: "role-queue",
      recordedFrom: {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        piAi: "1.3.0",
        at: "2026-10-25T09:00:00.000Z",
      },
    });
    expect(tape.turns).toHaveLength(1);
    const turn = tape.turns[0];
    expect(turn?.role).toBe("main");
    expect(turn?.response).toEqual({
      type: "message",
      content: [{ type: "text", text: "Hi, key [REDACTED]" }],
      stopReason: "stop",
      usage: { input: 20, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 24 },
    });
    expect(turn?.wire?.request).toEqual({ model: "claude-haiku-4-5", messages: 1, tools: [] });
    expect(Object.keys(turn?.wire?.headers ?? {})).toEqual(["content-type"]);

    // 같은 시나리오 요청이 테이프 요청과 짝지어진다
    const replay = tapeFetch(tape);
    const models = builtinModels();
    const model = models.getModel("anthropic", "claude-haiku-4-5");
    const scenario = SCENARIOS["hello-text"];
    const first = scenario?.turns[0];
    if (model === undefined || first === undefined) throw new Error("fixture missing");
    const replayed = await models
      .streamSimple(model, first.context([]), {
        apiKey: KEY,
        fetch: replay.fetch,
        maxTokens: first.maxTokens,
      })
      .result();
    replay.assertExhausted();
    expect(replayed.content).toEqual([{ type: "text", text: "Hi, key [REDACTED]" }]);
  });

  test("an existing tape is not overwritten; re-recording means deleting it first", async () => {
    const r = await rig({ ANTHROPIC_API_KEY: KEY }, hello);
    await Bun.write(r.out, "keep me\n");
    expect(await main(["hello-text", r.out], r.deps)).toBe(1);
    expect(await Bun.file(r.out).text()).toBe("keep me\n");
    expect(r.seen).toEqual([]);
  });

  test("a provider error writes no tape and the message does not carry the key", async () => {
    const r = await rig({ ANTHROPIC_API_KEY: KEY }, () => ({
      status: 401,
      body: `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${KEY}"}}`,
    }));
    const code = await main(["hello-text", r.out], r.deps);
    expect(code).toBe(1);
    expect(await Bun.file(r.out).exists()).toBe(false);
    expect(r.stderr.join("")).not.toContain(KEY);
  });

  test("the tool scenario records the tool call and the declared tool names", async () => {
    expect(Object.keys(SCENARIOS).toSorted()).toEqual(["hello-text", "read-tool-call"]);
    const r = await rig({ ANTHROPIC_API_KEY: KEY }, () => ({
      body: toolSse("read", { path: "notes.txt" }),
    }));
    const out = join(r.deps.outDir, "read-tool-call.tape.jsonl");
    expect(await main(["read-tool-call", out], r.deps)).toBe(0);
    const tape = await loadTape(out);
    const response = tape.turns[0]?.response;
    expect(response?.type === "message" ? response.stopReason : "").toBe("toolUse");
    expect(tape.turns[0]?.wire?.request.tools).toEqual(["read"]);
  });
});
