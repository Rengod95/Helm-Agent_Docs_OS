import { expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectAwaitingFirstResponse } from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { itm, summary, thr, userItem } from "./helpers.ts";

// 첫 응답 대기: 실행 중이고 그려지는 마지막 item이 내 말일 때만 참이다.

const T = thr(1);

function mirrorOf(items: readonly ItemRecord[], status: "idle" | "running"): EngineMirror {
  const inputs: readonly MirrorInput[] = [
    { type: "threads", threads: [summary(T, { status })] },
    { type: "transcript_opening", threadId: T },
    { type: "transcript", threadId: T, asOfSeq: 1, items },
  ];
  let state = INITIAL_MIRROR;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

const REPLY: ItemRecord = {
  itemId: itm(2),
  status: "completed",
  kind: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  },
  partIds: [],
};

const SYSTEM: ItemRecord = {
  itemId: itm(4),
  status: "completed",
  kind: "system",
  message: { role: "system", content: "s", timestamp: 0 },
};

test("a running thread whose last drawn item is the user's is awaiting a first response", () => {
  expect(selectAwaitingFirstResponse(mirrorOf([userItem(1)], "running"))).toBe(true);
  expect(selectAwaitingFirstResponse(mirrorOf([userItem(1), SYSTEM], "running"))).toBe(true);
});

test("an idle thread, an answered turn and an empty thread are not awaiting", () => {
  expect(selectAwaitingFirstResponse(mirrorOf([userItem(1)], "idle"))).toBe(false);
  expect(selectAwaitingFirstResponse(mirrorOf([userItem(1), REPLY], "running"))).toBe(false);
  expect(selectAwaitingFirstResponse(mirrorOf([], "running"))).toBe(false);
});
