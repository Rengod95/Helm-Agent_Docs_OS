import { describe, expect, test } from "bun:test";
import { cssPxOf, cssZoomOf } from "../../src/lib/zoom.ts";

// 앱 확대 환산(DP-171·DP-173)

describe("cssZoomOf", () => {
  test("확대를 모르거나 틀린 값이면 1", () => {
    expect(cssZoomOf({ currentCSSZoom: 1.25 })).toBe(1.25);
    expect(cssZoomOf({})).toBe(1);
    expect(cssZoomOf({ currentCSSZoom: 0 })).toBe(1);
    expect(cssZoomOf({ currentCSSZoom: Number.NaN })).toBe(1);
  });
});

describe("cssPxOf", () => {
  test("화면 px을 확대로 나눠 CSS px로 옮긴다", () => {
    expect([0.9, 1, 1.25, 1.5, 2].map((z) => cssPxOf(180, z))).toEqual([200, 180, 144, 120, 90]);
  });

  test("틀린 확대 값이면 그대로", () => {
    expect([cssPxOf(120, 0), cssPxOf(120, Number.NaN), cssPxOf(120, -1)]).toEqual([120, 120, 120]);
  });
});
