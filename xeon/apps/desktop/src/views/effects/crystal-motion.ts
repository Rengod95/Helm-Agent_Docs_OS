// 크리스탈 표시의 상황별 마이크로 모션(DP-223 [결정: 2026-11-18 사용자 "각각에 대해 여러 상황에 대한 마이크로 모션", lcMk]).
// 표시는 쉴 때 멈춘 한 장면이다(프레임을 그리지 않는다). 상황이 바뀔 때만 짧게(150~420ms) 한 번 움직이고 멈춘다.
// 자세(`CrystalPose`)는 쉬는 자세 사이를 잇는 이음(tween)과 그 위에 한 번 얹는 겹(overlay: 빛 한 줄기, 눌림, 튐, 떨림)으로 정한다.
// 시간은 lib/motion.ts의 곡선(EASE)을 쓰고, 나감이 들어옴보다 짧다(PLAN-motion). 순수 값이라 시험이 끝값과 넘침을 본다.

import { assertNever } from "@fresnel/contracts";
import { EASE, type Bezier } from "../../lib/motion.ts";

/** 한 장면의 자세. 칠하기(crystal-mark.tsx)가 이 값만 읽는다 */
export interface CrystalPose {
  /** 칸 안 크기 배율 */
  readonly scale: number;
  readonly alpha: number;
  /** 틈 폭 배율(쉬는 자세 1) */
  readonly gap: number;
  /** 쉬는 자세에서 더 돈 각(라디안) */
  readonly yaw: number;
  /** 유리가 받은 빛(0~1): 테·면의 밝기와 오로라 빛깔의 채도. 쉬는 자세 0.6 */
  readonly glow: number;
  /** 두 조각이 틈을 따라 더 벌어진 거리(모형 단위) */
  readonly split: number;
  /** 면을 훑는 빛줄기의 자리(−1.7 아래 왼쪽 ~ 1.7 위 오른쪽). 없으면 null */
  readonly sweep: number | null;
}

/** 쉬는 자세. 시안의 "확인 필요" 멈춘 장면(숨 0.6)이다 */
export const POSE_REST: CrystalPose = {
  scale: 1,
  alpha: 1,
  gap: 1,
  yaw: 0,
  glow: 0.6,
  split: 0,
  sweep: null,
};
/** 가리킴·초점: 조각이 조금 벌어지고 빛을 향해 돈다 */
export const POSE_HOVER: CrystalPose = { ...POSE_REST, gap: 1.35, yaw: 0.14, glow: 0.78 };
/** 급함(시한 있는 승인): 틈이 더 열리고 더 밝다(색이 아니라 모양으로도 다르다) */
export const POSE_URGENT: CrystalPose = { ...POSE_REST, gap: 1.6, glow: 0.95 };
export const POSE_URGENT_HOVER: CrystalPose = { ...POSE_URGENT, gap: 1.9, yaw: 0.14, glow: 1 };
/** 들어오기 전: 작고, 돌아 있고, 두 조각이 떨어져 있다 */
export const POSE_ENTER_FROM: CrystalPose = {
  scale: 0.5,
  alpha: 0,
  gap: 1,
  yaw: 0.6,
  glow: 0.2,
  split: 0.35,
  sweep: null,
};
/** 나간 뒤: 두 조각이 틈을 따라 갈라지며 사라진다 */
export const POSE_EXIT_TO: CrystalPose = {
  scale: 0.8,
  alpha: 0,
  gap: 2.2,
  yaw: -0.25,
  glow: 0.2,
  split: 0.3,
  sweep: null,
};

/** 상황(신호). 부품이 값의 바뀜과 손의 움직임에서 고른다 */
export type CrystalCue =
  | "enter"
  | "exit"
  | "hover"
  | "unhover"
  | "press"
  | "countUp"
  | "countDown"
  | "urgent"
  | "calm";

type Overlay = "sweepUp" | "sweepDown" | "press" | "bump" | "dip" | "shiver";

interface CueSpec {
  /** 이음 시간(ms). 0이면 자세를 잇지 않는다 */
  readonly ms: number;
  readonly ease: Bezier;
  /** 한 번 얹는 겹과 그 시간 */
  readonly overlays: readonly (readonly [Overlay, number])[];
}

/** 상황별 시간과 겹. 보고 표(lcMk)와 스펙 DP-223이 이 표를 옮긴다 */
export const CRYSTAL_CUES: Readonly<Record<CrystalCue, CueSpec>> = {
  enter: { ms: 320, ease: EASE.enter, overlays: [["sweepUp", 360]] },
  exit: { ms: 200, ease: EASE.exit, overlays: [] },
  hover: { ms: 200, ease: EASE.standard, overlays: [["sweepUp", 320]] },
  unhover: { ms: 160, ease: EASE.standard, overlays: [] },
  press: { ms: 0, ease: EASE.standard, overlays: [["press", 150]] },
  countUp: {
    ms: 0,
    ease: EASE.standard,
    overlays: [
      ["bump", 260],
      ["sweepUp", 260],
    ],
  },
  countDown: {
    ms: 0,
    ease: EASE.standard,
    overlays: [
      ["dip", 220],
      ["sweepDown", 220],
    ],
  },
  urgent: { ms: 420, ease: EASE.standard, overlays: [["shiver", 420]] },
  calm: { ms: 200, ease: EASE.standard, overlays: [] },
};

interface Running {
  readonly kind: Overlay;
  readonly start: number;
  readonly ms: number;
}

/** 움직임 상태. 이음(from → to)과 돌고 있는 겹들 */
export interface CrystalMotion {
  readonly from: CrystalPose;
  readonly to: CrystalPose;
  readonly start: number;
  readonly ms: number;
  readonly ease: Bezier;
  readonly overlays: readonly Running[];
}

/** 움직임 없이 한 자세에 선 상태 */
export function stillAt(pose: CrystalPose): CrystalMotion {
  return { from: pose, to: pose, start: 0, ms: 0, ease: EASE.standard, overlays: [] };
}

/** 쉬는 자세(목표). 나간 표시는 나간 자세다 */
export function targetPoseOf(input: {
  readonly present: boolean;
  readonly hovered: boolean;
  readonly urgent: boolean;
}): CrystalPose {
  if (!input.present) return POSE_EXIT_TO;
  if (input.urgent) return input.hovered ? POSE_URGENT_HOVER : POSE_URGENT;
  return input.hovered ? POSE_HOVER : POSE_REST;
}

/** 베지어 한 축의 값(끝점 0과 1) */
function axis(t: number, a: number, b: number): number {
  return 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
}

/** 3차 베지어 곡선의 x → y(이분법, 넘치지 않는 곡선만 쓴다) */
export function bezierAt(curve: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = curve;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (axis(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return axis((lo + hi) / 2, y1, y2);
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

function lerpPose(a: CrystalPose, b: CrystalPose, k: number): CrystalPose {
  return {
    scale: lerp(a.scale, b.scale, k),
    alpha: lerp(a.alpha, b.alpha, k),
    gap: lerp(a.gap, b.gap, k),
    yaw: lerp(a.yaw, b.yaw, k),
    glow: lerp(a.glow, b.glow, k),
    split: lerp(a.split, b.split, k),
    sweep: null,
  };
}

const progress = (now: number, start: number, ms: number): number =>
  ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - start) / ms));

/** 겹 하나를 자세에 얹는다. 끝(p = 1)에서는 아무것도 바꾸지 않는다 */
function applyOverlay(pose: CrystalPose, kind: Overlay, p: number): CrystalPose {
  if (p >= 1) return pose;
  const hump = Math.sin(Math.PI * p);
  switch (kind) {
    case "sweepUp":
      return { ...pose, sweep: lerp(-1.7, 1.7, bezierAt(EASE.standard, p)) };
    case "sweepDown":
      return { ...pose, sweep: lerp(1.7, -1.7, bezierAt(EASE.standard, p)) };
    case "press":
      // 두 조각이 한 번 맞물린다(틈이 닫혔다 열림)
      return { ...pose, scale: pose.scale * (1 - 0.1 * hump), gap: pose.gap * (1 - 0.6 * hump) };
    case "bump":
      return { ...pose, scale: pose.scale * (1 + 0.08 * hump) };
    case "dip":
      return { ...pose, scale: pose.scale * (1 - 0.05 * hump) };
    case "shiver":
      return { ...pose, yaw: pose.yaw + 0.12 * Math.sin(6 * Math.PI * p) * (1 - p) };
    default:
      return assertNever(kind, "crystal overlay");
  }
}

/** 시각 `now`(ms)의 자세 */
export function poseAt(motion: CrystalMotion, now: number): CrystalPose {
  const k = bezierAt(motion.ease, progress(now, motion.start, motion.ms));
  let pose = lerpPose(motion.from, motion.to, k);
  for (const overlay of motion.overlays) {
    pose = applyOverlay(pose, overlay.kind, progress(now, overlay.start, overlay.ms));
  }
  return pose;
}

/** 이 시각 뒤로 자세가 바뀌지 않는 때(ms). 이때가 지나면 시계가 이 표시를 그리지 않는다 */
export function settlesAt(motion: CrystalMotion): number {
  return Math.max(motion.start + motion.ms, ...motion.overlays.map((o) => o.start + o.ms));
}

/**
 * 상황 하나를 건다. 목표 자세가 바뀌면 지금 자세에서 이어 가고(중간에 바뀌어도 튀지 않는다), 겹은 새로 얹는다.
 * 끝난 겹은 버린다
 */
export function cueMotion(
  motion: CrystalMotion,
  cue: CrystalCue,
  now: number,
  target: CrystalPose,
): CrystalMotion {
  const spec = CRYSTAL_CUES[cue];
  const alive = motion.overlays.filter((o) => now < o.start + o.ms);
  const added = spec.overlays.map(([kind, ms]) => ({ kind, start: now, ms }));
  const kept = alive.filter((o) => !added.some((a) => a.kind === o.kind));
  // 들어옴은 목표가 같아도(막 붙은 캔버스는 쉬는 자세에 서 있다) 늘 들어오기 전 자세부터 잇는다
  const retarget = spec.ms > 0 && (cue === "enter" || target !== motion.to);
  if (!retarget) return { ...motion, overlays: [...kept, ...added] };
  // 들어옴은 늘 들어오기 전 자세에서 시작한다(나가던 중이어도 투명에 가까워 튀어 보이지 않는다)
  const current = cue === "enter" ? POSE_ENTER_FROM : poseAt({ ...motion, overlays: [] }, now);
  return {
    from: current,
    to: target,
    start: now,
    ms: spec.ms,
    ease: spec.ease,
    overlays: [...kept, ...added],
  };
}

/** 겹치지 않는 값의 바뀜에서 상황을 고른다. 처음 그릴 때(prev null)는 움직이지 않는다 */
export function cuesOf(
  prev: { readonly present: boolean; readonly count: number; readonly urgent: boolean } | null,
  next: { readonly present: boolean; readonly count: number; readonly urgent: boolean },
): readonly CrystalCue[] {
  if (prev === null) return [];
  if (prev.present !== next.present) return [next.present ? "enter" : "exit"];
  if (!next.present) return [];
  const cues: CrystalCue[] = [];
  if (next.count > prev.count) cues.push("countUp");
  else if (next.count < prev.count) cues.push("countDown");
  if (next.urgent !== prev.urgent) cues.push(next.urgent ? "urgent" : "calm");
  return cues;
}
