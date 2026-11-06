import { expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectUnsentUserItemId } from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { itm, summary, thr, userItem } from "./helpers.ts";

// 응답 없이 끝난 사용자 말: 마지막 item이 사용자 말이고 대화가 쉬는 중일 때만 표식이 선다.

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

test("a last user item in an idle thread is unsent", () => {
  expect(selectUnsentUserItemId(mirrorOf([userItem(1)], "idle"))).toBe(itm(1));
});

test("an answered user item, a running thread and an empty thread are not unsent", () => {
  expect(selectUnsentUserItemId(mirrorOf([userItem(1), REPLY], "idle"))).toBeNull();
  expect(selectUnsentUserItemId(mirrorOf([userItem(1)], "running"))).toBeNull();
  expect(selectUnsentUserItemId(mirrorOf([], "idle"))).toBeNull();
});
