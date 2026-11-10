import { describe, expect, test } from "bun:test";
import { nextStuck, type StickInput } from "../../src/views/virtual-list-stick.ts";

// 기록 스크롤 바닥 판정(virtual-list.tsx). 값은 실제 기록 화면을 본떴다: 내용 1137px, 보이는 높이 632px, 바닥 위치 505px, 임계값 48px.
const TALL = 1137;
const CLIENT = 632;
const BOTTOM_TOP = 505;
const THRESHOLD = 48;

const base: StickInput = {
  prevStuck: true,
  prevTop: BOTTOM_TOP,
  prevScrollHeight: TALL,
  top: BOTTOM_TOP,
  scrollHeight: TALL,
  clientHeight: CLIENT,
  threshold: THRESHOLD,
};

describe("nextStuck (virtual-list 바닥 판정)", () => {
  test("at the bottom stays stuck", () => {
    expect(nextStuck(base)).toBe(true);
  });

  test("a small wheel-up from the bottom un-sticks (regression: 505 -> 465)", () => {
    expect(nextStuck({ ...base, top: 465 })).toBe(false);
  });

  test("scrolling back down into the threshold sticks again", () => {
    expect(nextStuck({ ...base, prevTop: 465, top: 490 })).toBe(true);
  });

  test("scrolling down but still outside the threshold stays unstuck", () => {
    expect(nextStuck({ ...base, prevStuck: false, prevTop: 300, top: 400 })).toBe(false);
  });

  test("an unchanged position keeps the previous decision", () => {
    expect(nextStuck({ ...base, prevStuck: true, prevTop: 465, top: 465 })).toBe(true);
    expect(nextStuck({ ...base, prevStuck: false, prevTop: 465, top: 465 })).toBe(false);
  });

  test("a content shrink that pulls the position up is not a user scroll-up", () => {
    // 내용이 1137 -> 1100으로 줄어 위치가 505 -> 455로 끌려 내려갔다. 바닥에서 13px이라 바닥이다
    const shrunk = { ...base, prevStuck: false, top: 455, scrollHeight: 1100 };
    expect(nextStuck(shrunk)).toBe(true);
    // 같은 위치 이동이라도 내용 높이가 그대로면 사용자가 50px 올린 것이다
    expect(nextStuck({ ...shrunk, scrollHeight: TALL })).toBe(false);
  });

  test("content growth while stuck keeps stuck until the user scrolls to the new bottom", () => {
    // 바닥에 붙은 채 내용이 1137 -> 1200으로 늘었다. 위치가 그대로면 바닥에 붙은 상태를 지킨다
    expect(nextStuck({ ...base, scrollHeight: 1200 })).toBe(true);
    // 스크롤이 새 바닥(568)에 닿으면 다시 바닥이다
    expect(nextStuck({ ...base, top: 568, scrollHeight: 1200 })).toBe(true);
  });

  test("without an earlier reading only the distance to the bottom decides", () => {
    const first = { ...base, prevStuck: false, prevTop: null, prevScrollHeight: null };
    // 바닥에서 105px이면 멀다
    expect(nextStuck({ ...first, top: 400 })).toBe(false);
    // 바닥에서 40px이면 임계값 안이라 이전 판정(false)과 무관하게 바닥이다
    expect(nextStuck({ ...first, top: 465 })).toBe(true);
  });
});
