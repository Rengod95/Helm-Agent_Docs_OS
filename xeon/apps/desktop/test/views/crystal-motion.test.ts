import { describe, expect, test } from "bun:test";
import { EASE } from "../../src/lib/motion.ts";
import { crystalShards, CRYSTAL_RADIUS } from "../../src/views/effects/crystal-geometry.ts";
import {
  bezierAt,
  CRYSTAL_CUES,
  cueMotion,
  cuesOf,
  POSE_ENTER_FROM,
  POSE_EXIT_TO,
  POSE_HOVER,
  POSE_REST,
  POSE_URGENT,
  POSE_URGENT_HOVER,
  poseAt,
  settlesAt,
  stillAt,
  targetPoseOf,
  type CrystalCue,
  type CrystalPose,
} from "../../src/views/effects/crystal-motion.ts";

// 크리스탈 표시의 상황별 모션(DP-223). 한 번 돌고 멈추며, 끝에서는 쉬는 자세와 같은 값이다

const ALL_CUES: readonly CrystalCue[] = [
  "enter",
  "exit",
  "hover",
  "unhover",
  "press",
  "countUp",
  "countDown",
  "urgent",
  "calm",
];

const round = (pose: CrystalPose): CrystalPose => ({
  scale: Math.round(pose.scale * 1000) / 1000,
  alpha: Math.round(pose.alpha * 1000) / 1000,
  gap: Math.round(pose.gap * 1000) / 1000,
  yaw: Math.round(pose.yaw * 1000) / 1000,
  glow: Math.round(pose.glow * 1000) / 1000,
  split: Math.round(pose.split * 1000) / 1000,
  sweep: pose.sweep === null ? null : Math.round(pose.sweep * 1000) / 1000,
});

const at = (present: boolean, count: number, urgent: boolean) => ({ present, count, urgent });

const longest = (cue: CrystalCue): number =>
  Math.max(CRYSTAL_CUES[cue].ms, ...CRYSTAL_CUES[cue].overlays.map(([, ms]) => ms));

describe("cues from value changes", () => {
  test("the first paint never moves", () => {
    expect(cuesOf(null, at(true, 3, true))).toEqual([]);
  });

  test("becoming needed enters, resolving exits, and nothing else rides along", () => {
    expect([
      cuesOf(at(false, 0, false), at(true, 2, true)),
      cuesOf(at(true, 2, true), at(false, 0, false)),
      cuesOf(at(false, 0, false), at(false, 0, true)),
    ]).toEqual([["enter"], ["exit"], []]);
  });

  test("count and urgency changes while waiting", () => {
    expect([
      cuesOf(at(true, 1, false), at(true, 2, false)),
      cuesOf(at(true, 3, false), at(true, 2, false)),
      cuesOf(at(true, 1, false), at(true, 2, true)),
      cuesOf(at(true, 2, true), at(true, 2, false)),
      cuesOf(at(true, 2, false), at(true, 2, false)),
    ]).toEqual([["countUp"], ["countDown"], ["countUp", "urgent"], ["calm"], []]);
  });
});

describe("target poses", () => {
  test("hover and urgency pick the resting pose, and an absent mark rests at the exit pose", () => {
    expect([
      targetPoseOf({ present: true, hovered: false, urgent: false }),
      targetPoseOf({ present: true, hovered: true, urgent: false }),
      targetPoseOf({ present: true, hovered: false, urgent: true }),
      targetPoseOf({ present: true, hovered: true, urgent: true }),
      targetPoseOf({ present: false, hovered: true, urgent: true }),
    ]).toEqual([POSE_REST, POSE_HOVER, POSE_URGENT, POSE_URGENT_HOVER, POSE_EXIT_TO]);
  });

  test("urgent differs by shape (a wider gap), not only by light", () => {
    expect([POSE_URGENT.gap > POSE_REST.gap, POSE_URGENT.scale === POSE_REST.scale]).toEqual([
      true,
      true,
    ]);
  });
});

describe("timing", () => {
  test("every cue is short, and exits are faster than enters", () => {
    const table = Object.fromEntries(ALL_CUES.map((cue) => [cue, longest(cue)]));
    expect(table).toEqual({
      enter: 360,
      exit: 200,
      hover: 320,
      unhover: 160,
      press: 150,
      countUp: 260,
      countDown: 220,
      urgent: 420,
      calm: 200,
    });
    expect(CRYSTAL_CUES.exit.ms < CRYSTAL_CUES.enter.ms).toBe(true);
  });

  test("the ease curves start at 0, end at 1 and never overshoot", () => {
    for (const curve of Object.values(EASE)) {
      const samples = Array.from({ length: 21 }, (_, i) => bezierAt(curve, i / 20));
      expect([samples[0], samples[20]]).toEqual([0, 1]);
      expect(samples.every((y) => y >= 0 && y <= 1)).toBe(true);
      expect(samples.every((y, i) => i === 0 || y >= (samples[i - 1] ?? 0))).toBe(true);
    }
  });
});

describe("one-shot motions settle exactly on the resting pose", () => {
  const cases: readonly (readonly [CrystalCue, CrystalPose, CrystalPose])[] = [
    ["enter", POSE_EXIT_TO, POSE_REST],
    ["exit", POSE_REST, POSE_EXIT_TO],
    ["hover", POSE_REST, POSE_HOVER],
    ["unhover", POSE_HOVER, POSE_REST],
    ["press", POSE_HOVER, POSE_HOVER],
    ["countUp", POSE_REST, POSE_REST],
    ["countDown", POSE_REST, POSE_REST],
    ["urgent", POSE_REST, POSE_URGENT],
    ["calm", POSE_URGENT, POSE_REST],
  ];
  for (const [cue, from, to] of cases) {
    test(cue, () => {
      const motion = cueMotion(stillAt(from), cue, 1000, to);
      const end = settlesAt(motion);
      expect(end - 1000).toBe(
        Math.max(CRYSTAL_CUES[cue].ms, ...CRYSTAL_CUES[cue].overlays.map(([, ms]) => ms)),
      );
      expect(poseAt(motion, end)).toEqual(to);
      expect(poseAt(motion, end + 5000)).toEqual(to);
    });
  }

  test("enter plays even when the freshly mounted mark already rests at the target", () => {
    const motion = cueMotion(stillAt(POSE_REST), "enter", 0, POSE_REST);
    expect([round(poseAt(motion, 0)).alpha, poseAt(motion, 360)]).toEqual([0, POSE_REST]);
  });

  test("enter starts small, turned and split, then the light runs through", () => {
    const motion = cueMotion(stillAt(POSE_EXIT_TO), "enter", 0, POSE_REST);
    expect(round(poseAt(motion, 0))).toEqual({ ...POSE_ENTER_FROM, sweep: -1.7 });
    const mid = poseAt(motion, 160);
    expect([mid.scale > 0.5 && mid.scale < 1, mid.sweep !== null]).toEqual([true, true]);
  });

  test("press closes the gap once and opens it again", () => {
    const motion = cueMotion(stillAt(POSE_REST), "press", 0, POSE_REST);
    expect(round(poseAt(motion, 75))).toEqual({ ...POSE_REST, scale: 0.9, gap: 0.4 });
  });

  test("a new target mid-way continues from where the pose is (no jump)", () => {
    const hovering = cueMotion(stillAt(POSE_REST), "hover", 0, POSE_HOVER);
    const before = poseAt({ ...hovering, overlays: [] }, 100);
    const leaving = cueMotion(hovering, "unhover", 100, POSE_REST);
    // 가리킴의 빛 줄기는 제 시간대로 끝까지 흐르고, 자세만 지금 자리에서 이어 간다
    expect(round({ ...poseAt(leaving, 100), sweep: null })).toEqual(round(before));
    expect(poseAt(leaving, 100).sweep).toBe(poseAt(hovering, 100).sweep);
  });
});

describe("shape", () => {
  test("two shards, each with one cut face, and the gap widens with the half width", () => {
    const [a, b] = crystalShards(0.03);
    expect([a.length, b.length]).toEqual([9, 9]);
    expect([a.filter((f) => f.cut).length, b.filter((f) => f.cut).length]).toEqual([1, 1]);
    expect(Math.round(CRYSTAL_RADIUS * 1000) / 1000).toBe(1.186);
    expect(crystalShards(0.03)).toBe(crystalShards(0.03));
  });
});
