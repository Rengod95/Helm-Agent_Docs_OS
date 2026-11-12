import { describe, expect, test } from "bun:test";
import {
  orbitKeyframesOf,
  orbitPointsOf,
  periodMsOf,
} from "../../../src/views/effects/beam-orbit.ts";

// beam 궤도 키프레임(dzM2 시안 §11, DP-120)

const box = { width: 400, height: 120, radius: 16 };

describe("궤도 점", () => {
  test("위 변 왼쪽에서 시작해 같은 자리로 돌아오고, 각도는 0에서 360까지 줄지 않는다", () => {
    const points = orbitPointsOf(box);
    const first = points[0];
    const last = points.at(-1);
    expect(first === undefined ? null : [first.x, first.y, first.angle, first.at]).toEqual([
      16, 0, 0, 0,
    ]);
    expect(
      last === undefined ? null : [Math.round(last.x), Math.round(last.y), last.angle],
    ).toEqual([16, 0, 360]);
    const angles = points.map((point) => point.angle);
    expect(angles.every((angle, i) => i === 0 || angle >= (angles[i - 1] ?? 0))).toBe(true);
  });

  test("누적 길이는 둥근 사각형 둘레와 거의 같다", () => {
    const points = orbitPointsOf(box);
    const exact = 2 * (400 - 32) + 2 * (120 - 32) + 2 * Math.PI * 16;
    expect(Math.abs((points.at(-1)?.at ?? 0) - exact)).toBeLessThan(0.5);
  });

  test("반지름은 상자 반을 넘지 않는다", () => {
    const first = orbitPointsOf({ width: 20, height: 10, radius: 99 })[0];
    expect(first?.x).toBe(5);
  });
});

describe("키프레임", () => {
  test("offset이 0에서 1까지 줄지 않고, 첫 프레임은 고정점을 둘레 첫 점에 둔다", () => {
    const frames = orbitKeyframesOf(box, { width: 40, height: 20 });
    const offsets = frames.map((frame) => frame.offset ?? -1);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
    expect(offsets.every((value, i) => i === 0 || value >= (offsets[i - 1] ?? 0))).toBe(true);
    expect(frames[0]?.transform).toBe("translate(-20.00px, -10.00px) rotate(0.00deg)");
  });

  test("빈 상자는 offset 0만 낸다", () => {
    const frames = orbitKeyframesOf({ width: 0, height: 0, radius: 0 }, { width: 10, height: 10 });
    expect(new Set(frames.map((frame) => frame.offset))).toEqual(new Set([0]));
  });
});

describe("주기 글", () => {
  test("s·ms를 읽고, 못 읽으면 3600", () => {
    expect([periodMsOf("3.6s"), periodMsOf(" 2400ms "), periodMsOf("var(--x)")]).toEqual([
      3600, 2400, 3600,
    ]);
  });
});
