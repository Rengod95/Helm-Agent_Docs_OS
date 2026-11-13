import { expect, test } from "bun:test";
import {
  ATTENTION_LIVE_LIMIT,
  isAttentionLive,
  joinAttentionLive,
  leaveAttentionLive,
} from "../../src/views/effects/attention-budget.ts";

// 살아 움직이는 표시의 상한(DP-190): 먼저 선 것부터 상한까지 움직이고, 앞이 빠지면 다음이 받는다

test("marks: the first three move, the rest stay still", () => {
  expect(ATTENTION_LIVE_LIMIT).toEqual({ mark: 3, progress: 8, card: 1 });
  const ids = ["m1", "m2", "m3", "m4", "m5"];
  for (const id of ids) joinAttentionLive("mark", id);
  expect(ids.map((id) => isAttentionLive("mark", id))).toEqual([true, true, true, false, false]);
  leaveAttentionLive("mark", "m2");
  expect(ids.map((id) => isAttentionLive("mark", id))).toEqual([true, false, true, true, false]);
  for (const id of ids) leaveAttentionLive("mark", id);
  expect(ids.map((id) => isAttentionLive("mark", id))).toEqual([false, false, false, false, false]);
});

test("cards: one aurora flows; joining twice keeps one place", () => {
  joinAttentionLive("card", "c1");
  joinAttentionLive("card", "c1");
  joinAttentionLive("card", "c2");
  expect([isAttentionLive("card", "c1"), isAttentionLive("card", "c2")]).toEqual([true, false]);
  leaveAttentionLive("card", "c1");
  expect([isAttentionLive("card", "c1"), isAttentionLive("card", "c2")]).toEqual([false, true]);
  leaveAttentionLive("card", "c2");
});

test("progress orbs: eight move, the ninth and tenth stay still", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${String(i)}`);
  for (const id of ids) joinAttentionLive("progress", id);
  expect(ids.map((id) => isAttentionLive("progress", id))).toEqual([
    ...Array.from({ length: 8 }, () => true),
    false,
    false,
  ]);
  for (const id of ids) leaveAttentionLive("progress", id);
  expect(ids.some((id) => isAttentionLive("progress", id))).toBe(false);
});
