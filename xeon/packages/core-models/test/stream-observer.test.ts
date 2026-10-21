import { describe, expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent } from "@xeon/contracts/conversation";
import type { AssistantMessageEventStream } from "@xeon/contracts/services";
import { observeStream } from "../src/stream-observer.ts";

function message(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "tape",
    provider: "tape",
    model: "tape-1",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 1,
  };
}

function sourceOf(
  events: readonly AssistantMessageEvent[],
  final: AssistantMessage,
): AssistantMessageEventStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    result: () => Promise.resolve(final),
  };
}

const START: AssistantMessageEvent = { type: "start", partial: message("", "pending") };

function hooks() {
  const log: string[] = [];
  return {
    log,
    hooks: {
      finalize: (m: AssistantMessage): AssistantMessage => ({ ...m, errorMessage: "finalized" }),
      onSettled: (m: AssistantMessage): void => {
        log.push(`settled:${m.stopReason}`);
      },
      onAbandoned: (): void => {
        log.push("abandoned");
      },
    },
  };
}

describe("observeStream", () => {
  test("rewrites the done event, settles once, and result() returns the same message", async () => {
    const final = message("hi");
    const probe = hooks();
    const observed = observeStream(
      sourceOf([START, { type: "done", reason: "stop", message: final }], final),
      probe.hooks,
    );
    const seen: AssistantMessageEvent[] = [];
    for await (const event of observed) seen.push(event);
    const done = seen.at(-1);
    expect(done?.type === "done" && done.message.errorMessage).toBe("finalized");
    const settled = await observed.result();
    expect(done?.type === "done" && done.message === settled).toBe(true);
    expect(probe.log).toEqual(["settled:stop"]);
  });

  test("rewrites an error event too", async () => {
    const failed = message("", "error");
    const probe = hooks();
    const observed = observeStream(
      sourceOf([START, { type: "error", reason: "error", error: failed }], failed),
      probe.hooks,
    );
    const seen: AssistantMessageEvent[] = [];
    for await (const event of observed) seen.push(event);
    expect(seen.at(-1)?.type === "error" && seen.at(-1)).toMatchObject({
      error: { errorMessage: "finalized" },
    });
    expect(probe.log).toEqual(["settled:error"]);
  });

  test("closing early reports abandonment once and never settles", async () => {
    const final = message("hi");
    const probe = hooks();
    const observed = observeStream(
      sourceOf([START, { type: "done", reason: "stop", message: final }], final),
      probe.hooks,
    );
    for await (const event of observed) {
      if (event.type === "start") break;
    }
    expect(probe.log).toEqual(["abandoned"]);
  });

  test("nothing happens until a consumer drives the stream", () => {
    const final = message("hi");
    const probe = hooks();
    observeStream(sourceOf([], final), probe.hooks);
    expect(probe.log).toEqual([]);
  });
});
