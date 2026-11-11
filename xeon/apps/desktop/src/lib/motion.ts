// 화면이 쓰는 motion 표면. 화면은 motion/react를 직접 부르지 않고 이 파일만 import한다.
// 이징과 스프링은 오버슛이 없는 값이다. 베지어 y 제어점은 0~1 안에 있고, 스프링은 임계 감쇠(감쇠비 1)다.

export {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";

/** cubic-bezier 제어점 [x1, y1, x2, y2] */
export type Bezier = readonly [number, number, number, number];

export const EASE: {
  /** 기본 이동과 크기 변화 */
  readonly standard: Bezier;
  /** 나타날 때(감속) */
  readonly enter: Bezier;
  /** 사라질 때(가속) */
  readonly exit: Bezier;
} = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
};

/** motion의 `transition`에 그대로 넣는 스프링. 감쇠비 damping / (2 * sqrt(stiffness * mass)) = 1이라 튀지 않는다. */
export const SPRING: {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
} = {
  type: "spring",
  stiffness: 400,
  damping: 40,
  mass: 1,
};
