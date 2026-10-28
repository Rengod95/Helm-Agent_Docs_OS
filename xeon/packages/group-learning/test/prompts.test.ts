import { expect, test } from "bun:test";
import { REVIEW_MARKERS, reviewTask } from "../src/review/prompts.ts";

test("prompts.contains-required-blocks: four signals, the preference order, five do-not-capture items, the memory areas and the DATA defense", () => {
  const task = reviewTask(["user_turns", "tool_iterations"]);
  for (const group of Object.values(REVIEW_MARKERS)) {
    for (const marker of group) expect(task).toContain(marker);
  }
  expect(REVIEW_MARKERS.signals.length).toBe(5);
  expect(REVIEW_MARKERS.order.length).toBe(4);
  expect(REVIEW_MARKERS.doNotCapture.length).toBe(5);
  // 보고는 제안 도구로만 한다
  expect(task).toContain("learning_propose");
  expect(task).toContain("call no tool");
});

test("prompts.states-why-the-review-started-and-has-no-active-bias", () => {
  expect(reviewTask(["user_turns"])).toContain("enough user turns");
  expect(reviewTask(["tool_iterations"])).toContain("tool iterations");
  expect(reviewTask(["manual"])).toContain("the user asked for a review");
  // Hermes의 "Be ACTIVE" 편향 문구를 쓰지 않는다(spec §4.4 7)
  for (const text of [reviewTask(["user_turns"]), reviewTask(["manual"])]) {
    expect(text.toLowerCase()).not.toContain("be active");
  }
});
