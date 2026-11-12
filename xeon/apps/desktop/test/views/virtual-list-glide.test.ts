import { describe, expect, test } from "bun:test";
import { GLIDE_RATE, glideStep, shouldGlide } from "../../src/views/virtual-list-glide.ts";

// 따라 내려가기 감쇠 보간(DP-106).

describe("glideStep", () => {
  test("한 프레임(16.7ms)에 남은 거리의 22%를 간다", () => {
    expect(GLIDE_RATE).toBe(0.22);
    expect(glideStep(0, 100, 1000 / 60)).toBeCloseTo(22, 6);
  });

  test("두 프레임 시간이면 한 프레임씩 두 번 간 것과 같다", () => {
    const once = glideStep(glideStep(0, 100, 1000 / 60), 100, 1000 / 60);
    expect(glideStep(0, 100, 2000 / 60)).toBeCloseTo(once, 6);
  });

  test("목표를 넘지 않고, 반 픽셀 안이면 목표에 붙는다", () => {
    let top = 0;
    const seen: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      top = glideStep(top, 200, 1000 / 60);
      seen.push(top);
    }
    expect(Math.max(...seen)).toBe(200);
    expect(seen.every((v, i) => i === 0 || v >= (seen[i - 1] ?? 0))).toBe(true);
    expect(glideStep(199.7, 200, 16)).toBe(200);
  });

  test("200px은 0.25초 안에 거의 다 닿는다", () => {
    let top = 0;
    for (let i = 0; i < 15; i += 1) top = glideStep(top, 200, 1000 / 60);
    expect(200 - top).toBeLessThan(5);
  });
});

describe("shouldGlide", () => {
  test("한 화면 안의 늘어남만 보간한다", () => {
    expect(shouldGlide({ distance: 120, viewportHeight: 600, reduced: false })).toBe(true);
    expect(shouldGlide({ distance: 900, viewportHeight: 600, reduced: false })).toBe(false);
    expect(shouldGlide({ distance: 0.4, viewportHeight: 600, reduced: false })).toBe(false);
  });

  test("움직임을 줄이면 바로 간다", () => {
    expect(shouldGlide({ distance: 120, viewportHeight: 600, reduced: true })).toBe(false);
  });
});
