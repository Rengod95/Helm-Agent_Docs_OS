import { describe, expect, test } from "bun:test";
import * as motionReact from "motion/react";
import {
  AnimatePresence,
  DUR,
  EASE,
  LayoutGroup,
  MotionConfig,
  SPRING,
  motion,
  useInView,
  useReducedMotion,
} from "../../src/lib/motion.ts";

// 래퍼가 재노출하는 심볼은 motion/react의 것과 같은 값이다(다시 만든 것이 아니다).
describe("motion 래퍼", () => {
  test("재노출 심볼은 motion/react와 같은 값이고 정의되어 있다", () => {
    expect(motion).toBe(motionReact.motion);
    expect(AnimatePresence).toBe(motionReact.AnimatePresence);
    expect(LayoutGroup).toBe(motionReact.LayoutGroup);
    expect(MotionConfig).toBe(motionReact.MotionConfig);
    expect(useInView).toBe(motionReact.useInView);
    expect(useReducedMotion).toBe(motionReact.useReducedMotion);
    expect(typeof AnimatePresence).toBe("function");
    expect(typeof useReducedMotion).toBe("function");
    expect(typeof useInView).toBe("function");
  });

  test("이징 값은 정해진 제어점이다(DP-105)", () => {
    expect(EASE).toEqual({
      standard: [0.2, 0, 0, 1],
      enter: [0.22, 1, 0.36, 1],
      panel: [0.32, 0.72, 0, 1],
      exit: [0.4, 0, 1, 1],
    });
  });

  test("이징 제어점의 y 값은 0과 1 사이라 곡선이 오버슛하지 않는다", () => {
    for (const curve of Object.values(EASE)) {
      expect(curve[1]).toBeGreaterThanOrEqual(0);
      expect(curve[1]).toBeLessThanOrEqual(1);
      expect(curve[3]).toBeGreaterThanOrEqual(0);
      expect(curve[3]).toBeLessThanOrEqual(1);
    }
  });

  test("시간은 정해진 값이고 나감은 들어옴의 60% 안팎이다", () => {
    expect(DUR).toEqual({ micro: 0.12, enter: 0.2, layout: 0.28, exit: 0.12, exitLayout: 0.18 });
    expect(DUR.exit / DUR.enter).toBeCloseTo(0.6, 5);
    expect(DUR.exitLayout / DUR.layout).toBeCloseTo(0.643, 2);
  });

  test("스프링은 bounce 0(임계 감쇠)이라 넘치지 않는다", () => {
    expect(SPRING).toEqual({ type: "spring", bounce: 0, visualDuration: 0.28 });
  });
});
