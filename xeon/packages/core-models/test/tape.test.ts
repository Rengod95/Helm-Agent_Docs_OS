import { describe, expect, test } from "bun:test";
import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import {
  contextHash,
  loadTape,
  t,
  tape,
  tapePlayer,
  TapeFormatError,
  TapeLeftoverError,
  TapeMismatchError,
} from "../src/testing/index.ts";
import { flushMicrotasks } from "@xeon/ext-host/testing";
import { manualClock } from "./support/clock.ts";
import { rejectionOf } from "./support/rejection.ts";

async function collect(
  stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const CONTEXT: Context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] };

function fixed() {
  return tape("core-models/fixed", [
    {
      role: "main",
      response: {
        type: "message",
        content: [
          t.thinking("hmm"),
          t.text("reading"),
          t.toolCall("read", { path: "a.txt" }, "call_1"),
        ],
        stopReason: "toolUse",
        usage: { input: 100, output: 20 },
      },
    },
    {
      role: "main",
      response: { type: "message", content: [t.text("done")], stopReason: "stop" },
    },
  ]);
}

async function playTwice(): Promise<string> {
  const player = tapePlayer(fixed(), { clock: manualClock() });
  const first = await collect(player.stream({ role: "main", context: CONTEXT }));
  const second = await collect(player.stream({ role: "main", context: CONTEXT }));
  return JSON.stringify([first, second]);
}

describe("tape_model_replays_fixed_stream", () => {
  test("a message response becomes start, per-block events, then done", async () => {
    const player = tapePlayer(fixed(), { clock: manualClock() });
    const events = await collect(player.stream({ role: "main", context: CONTEXT }));
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "text_start",
      "text_delta",
      "text_end",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    const last = events.at(-1);
    expect(last?.type).toBe("done");
    if (last?.type !== "done") return;
    expect(last.reason).toBe("toolUse");
    expect(last.message.usage).toMatchObject({ input: 100, output: 20, totalTokens: 120 });
    expect(last.message.content.map((block) => block.type)).toEqual([
      "thinking",
      "text",
      "toolCall",
    ]);
  });

  test("text and tool call blocks grow in partial messages (empty at start, full at end)", async () => {
    const player = tapePlayer(fixed(), { clock: manualClock() });
    const events = await collect(player.stream({ role: "main", context: CONTEXT }));
    const textStart = events.find((event) => event.type === "text_start");
    const textEnd = events.find((event) => event.type === "text_end");
    expect(textStart?.type === "text_start" && textStart.partial.content[1]).toEqual({
      type: "text",
      text: "",
    });
    expect(textEnd?.type === "text_end" && textEnd.partial.content[1]).toEqual({
      type: "text",
      text: "reading",
    });
    const toolStart = events.find((event) => event.type === "toolcall_start");
    expect(toolStart?.type === "toolcall_start" && toolStart.partial.content[2]).toMatchObject({
      type: "toolCall",
      arguments: {},
    });
  });

  test("the same tape and clock give the same event list twice (D0)", async () => {
    expect(await playTwice()).toBe(await playTwice());
  });

  test("the response message carries the target identity and the injected clock time", async () => {
    const clock = manualClock(5000);
    const player = tapePlayer(fixed(), { clock });
    const events = await collect(
      player.stream({
        role: "main",
        context: CONTEXT,
        target: { api: "anthropic-messages", provider: "anthropic", modelId: "claude-x" },
      }),
    );
    const done = events.at(-1);
    expect(done?.type === "done" && done.message).toMatchObject({
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-x",
      timestamp: 5000,
    });
  });

  test("consumed and remaining follow the queue; assertExhausted passes when empty", async () => {
    const player = tapePlayer(fixed(), { clock: manualClock() });
    expect(player.remaining()).toBe(2);
    await collect(player.stream({ role: "main", context: CONTEXT }));
    expect(player.remaining()).toBe(1);
    expect(() => {
      player.assertExhausted();
    }).toThrow(TapeLeftoverError);
    await collect(player.stream({ role: "main", context: CONTEXT }));
    expect(player.consumed().map((turn) => turn.n)).toEqual([1, 2]);
    player.assertExhausted();
  });

  test("allowLeftover lets unused turns pass", () => {
    const player = tapePlayer(
      tape("core-models/leftover-ok", [{ role: "main", response: { type: "stall" } }], {
        allowLeftover: true,
      }),
      { clock: manualClock() },
    );
    player.assertExhausted();
  });

  test("a request without a matching turn throws TapeMismatchError instead of becoming a model error", () => {
    const player = tapePlayer(fixed(), { clock: manualClock() });
    expect(() => player.stream({ role: "summary", context: CONTEXT })).toThrow(TapeMismatchError);
  });
});

describe("tape responses other than message", () => {
  test("error with afterContent emits the content, then an error event with the reason", async () => {
    const player = tapePlayer(
      tape("core-models/aborted", [
        {
          role: "main",
          response: {
            type: "error",
            reason: "aborted",
            errorMessage: "aborted by user",
            afterContent: [t.text("partial")],
            usage: { input: 40, output: 3 },
          },
        },
      ]),
      { clock: manualClock() },
    );
    const events = await collect(player.stream({ role: "main", context: CONTEXT }));
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "error",
    ]);
    const last = events.at(-1);
    expect(last?.type === "error" && last.reason).toBe("aborted");
    expect(last?.type === "error" && last.error).toMatchObject({
      stopReason: "aborted",
      errorMessage: "aborted by user",
      usage: { input: 40, output: 3 },
    });
  });

  test("an events response is emitted as written", async () => {
    const written = await collect(
      tapePlayer(fixed(), { clock: manualClock() }).stream({ role: "main", context: CONTEXT }),
    );
    const player = tapePlayer(
      tape("core-models/recorded-events", [
        { role: "main", response: { type: "events", events: written } },
      ]),
      { clock: manualClock() },
    );
    expect(await collect(player.stream({ role: "main", context: CONTEXT }))).toEqual(written);
  });

  test("a stall turn ends with an aborted error once the signal aborts", async () => {
    const player = tapePlayer(
      tape("core-models/stall", [{ role: "main", response: { type: "stall" } }]),
      {
        clock: manualClock(),
      },
    );
    const controller = new AbortController();
    const seen: string[] = [];
    const reading = (async (): Promise<void> => {
      for await (const event of player.stream({
        role: "main",
        context: CONTEXT,
        signal: controller.signal,
      })) {
        seen.push(event.type);
      }
    })();
    await flushMicrotasks();
    expect(seen).toEqual(["start"]);
    controller.abort();
    await reading;
    expect(seen).toEqual(["start", "error"]);
  });
});

describe("context-hash matching", () => {
  test("a turn plays only when the request hashes to the recorded value", async () => {
    const recorded = tape(
      "core-models/hash",
      [
        {
          role: "main",
          match: { contextHash: contextHash(CONTEXT) },
          response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
        },
      ],
      { matching: "context-hash" },
    );
    const player = tapePlayer(recorded, { clock: manualClock() });
    const events = await collect(player.stream({ role: "main", context: CONTEXT }));
    expect(events.at(-1)?.type).toBe("done");
  });

  test("a different context throws TapeMismatchError naming both hashes", () => {
    const other: Context = { messages: [{ role: "user", content: "different", timestamp: 1 }] };
    const recorded = tape(
      "core-models/hash-miss",
      [
        {
          role: "main",
          match: { contextHash: contextHash(CONTEXT) },
          response: { type: "message", content: [t.text("ok")], stopReason: "stop" },
        },
      ],
      { matching: "context-hash" },
    );
    const player = tapePlayer(recorded, { clock: manualClock() });
    expect(() => player.stream({ role: "main", context: other })).toThrow(contextHash(other));
  });

  test("contextHash is stable for equal contexts and covers messages and tools", () => {
    expect(contextHash(CONTEXT)).toBe(contextHash({ messages: [...CONTEXT.messages] }));
    expect(contextHash({ ...CONTEXT, systemPrompt: "x" })).not.toBe(contextHash(CONTEXT));
    expect(
      contextHash({
        ...CONTEXT,
        tools: [{ name: "read", description: "r", parameters: { type: "object" } }],
      }),
    ).not.toBe(contextHash(CONTEXT));
  });
});

describe("loadTape", () => {
  const dir = `${import.meta.dir}/tapes`;

  test("reads a JSONL tape and plays it", async () => {
    const loaded = await loadTape(`${dir}/read-then-answer.tape.jsonl`);
    expect(loaded.header.tapeId).toBe("core-models/read-then-answer");
    expect(loaded.turns.map((turn) => turn.n)).toEqual([1, 2]);
    const player = tapePlayer(loaded, { clock: manualClock() });
    const first = await collect(player.stream({ role: "main", context: CONTEXT }));
    expect(first.at(-1)?.type === "done" && first.at(-1)).toMatchObject({ reason: "toolUse" });
    await collect(player.stream({ role: "main", context: CONTEXT }));
    player.assertExhausted();
  });

  test("rejects a tape whose turn numbers skip", async () => {
    expect(await rejectionOf(loadTape(`${dir}/bad-turn-number.tape.jsonl`))).toBeInstanceOf(
      TapeFormatError,
    );
  });

  test("rejects a role outside the six ModelRole values", async () => {
    expect(await rejectionOf(loadTape(`${dir}/bad-role.tape.jsonl`))).toBeInstanceOf(
      TapeFormatError,
    );
  });

  test("rejects a recorded tape without recordedFrom", async () => {
    expect(await rejectionOf(loadTape(`${dir}/recorded-without-source.tape.jsonl`))).toBeInstanceOf(
      TapeFormatError,
    );
  });
});
