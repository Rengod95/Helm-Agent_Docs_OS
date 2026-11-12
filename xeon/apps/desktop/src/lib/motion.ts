// 화면이 쓰는 motion 표면. 화면은 motion/react를 직접 부르지 않고 이 파일과 motion-presets.tsx만 import한다.
// 성격은 "크리스탈"(DP-105 [결정: 2026-11-11 사용자]): 빨리 시작해 끝이 부드럽게 가라앉고 넘치지 않는다.
// 베지어 y 제어점은 0~1 안에 있고, 스프링은 임계 감쇠(bounce 0)다. caustic 토큰(quick 120 · swift 180 · gentle 280)과 같은 값이다.

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
  /** 색, 접힘처럼 자리에 남는 것 */
  readonly standard: Bezier;
  /** 들어옴(강한 감속) */
  readonly enter: Bezier;
  /** 패널, 시트, 배치 이동 */
  readonly panel: Bezier;
  /** 나감(가속, 짧게만 쓴다) */
  readonly exit: Bezier;
} = {
  standard: [0.2, 0, 0, 1],
  enter: [0.22, 1, 0.36, 1],
  panel: [0.32, 0.72, 0, 1],
  exit: [0.4, 0, 1, 1],
};

/** 시간(초). 나감은 들어옴의 60% 안팎이다 */
export const DUR: {
  /** 색·투명도 미세 변화 */
  readonly micro: number;
  /** 블록·띠·화면 들어옴 */
  readonly enter: number;
  /** 패널, 펼침 높이, 배치 이동 */
  readonly layout: number;
  /** 블록·띠 나감 */
  readonly exit: number;
  /** 패널·펼침 나감 */
  readonly exitLayout: number;
} = {
  micro: 0.12,
  enter: 0.2,
  layout: 0.28,
  exit: 0.12,
  exitLayout: 0.18,
};

/** 움직이는 거리(px) */
export const SHIFT: {
  /** 블록 들어옴: 이만큼 아래에서 오른다 */
  readonly block: number;
  /** 화면·띠 들어옴 */
  readonly screen: number;
  /** 나감: 이만큼 위로 비키며 사라진다 */
  readonly exit: number;
} = { block: 6, screen: 8, exit: 2 };

/** 블록이 들어올 때 처음 흐림(px). 초점이 맞듯 0이 된다 */
export const ENTER_BLUR = 4;

/** motion의 `transition`에 그대로 넣는 스프링. bounce 0은 임계 감쇠라 넘치지 않는다. 끌기를 놓을 때, 위치를 이어받을 때 쓴다 */
export const SPRING: {
  readonly type: "spring";
  readonly bounce: number;
  readonly visualDuration: number;
} = {
  type: "spring",
  bounce: 0,
  visualDuration: DUR.layout,
};
