import { describe, expect, test } from "bun:test";
import { SPRING_MS, springAt, springLinear } from "../../../src/views/craft/spring.ts";

describe("spring easing", () => {
  test("starts at 0 and settles on 1 within the stated time", () => {
    expect(springAt(0)).toBe(0);
    expect(springAt(0.62)).toBeGreaterThan(0.997);
    expect(springAt(0.62)).toBeLessThan(1.003);
    expect(SPRING_MS).toBe(620);
  });

  test("the CSS linear() value has 33 points and ends exactly on 1", () => {
    const css = springLinear();
    expect(css.startsWith("linear(0.000, ")).toBe(true);
    expect(css.endsWith(", 1)")).toBe(true);
    expect(css.slice("linear(".length, -1).split(", ").length).toBe(33);
  });

  test("the spring overshoots: some point is above 1 before it settles", () => {
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => springAt((i / 200) * 0.62)));
    expect(peak).toBeGreaterThan(1);
  });
});
