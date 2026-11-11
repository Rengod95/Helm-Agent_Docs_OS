import { describe, expect, test } from "bun:test";
import * as motionReact from "motion/react";
import {
  AnimatePresence,
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

  test("이징 값은 정해진 제어점이다", () => {
    expect(EASE).toEqual({
      standard: [0.2, 0, 0, 1],
      enter: [0, 0, 0, 1],
      exit: [0.3, 0, 1, 1],
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

  test("스프링 값은 정해진 세 수치다", () => {
    expect(SPRING).toEqual({ type: "spring", stiffness: 400, damping: 40, mass: 1 });
  });

  test("스프링은 임계 감쇠라 오버슛이 없다(감쇠비 1)", () => {
    const ratio = SPRING.damping / (2 * Math.sqrt(SPRING.stiffness * SPRING.mass));
    expect(ratio).toBe(1);
  });
});
