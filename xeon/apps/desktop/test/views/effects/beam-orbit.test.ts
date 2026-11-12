import { describe, expect, test } from "bun:test";
import {
  cornerExponentOf,
  orbitKeyframesOf,
  orbitPointsOf,
  periodMsOf,
  pointAt,
  trailLagMsOf,
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
    // 고정점은 알갱이 가운데다
    expect(frames[0]?.transform).toBe("translate(-4.00px, -10.00px) rotate(0.00deg)");
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

describe("모서리 모양(dzE 시안 §1)", () => {
  test("corner-shape 계산값을 곡선 지수로 읽는다", () => {
    expect(
      [
        "round",
        "",
        "squircle",
        "superellipse(2)",
        "superellipse(3)",
        "bevel",
        "squircle round",
      ].map(cornerExponentOf),
    ).toEqual([2, 2, 4, 4, 8, 1, 4]);
  });

  test("squircle 궤도의 모서리 점은 |x|⁴+|y|⁴=r⁴ 위에 있다", () => {
    const r = 24;
    const points = orbitPointsOf({ width: 300, height: 80, radius: r, exponent: 4 });
    // 오른쪽 위 모서리(중심 (276, 24))의 점들
    const corner = points.filter((p) => p.x > 276 + 0.01 && p.y < 24 - 0.01);
    expect(corner.length).toBeGreaterThan(10);
    const worst = Math.max(
      ...corner.map((p) => Math.abs(((p.x - 276) / r) ** 4 + ((24 - p.y) / r) ** 4 - 1)),
    );
    expect(worst).toBeLessThan(1e-9);
  });

  test("squircle 모서리는 원보다 바깥으로 차 있다: 대각선 점이 테두리 쪽으로 2.5px 넘게 나간다", () => {
    const r = 25.2;
    const diagonal = (exponent: number): number => {
      const points = orbitPointsOf({ width: 400, height: 80, radius: r, exponent });
      // 오른쪽 위 모서리에서 중심으로부터 45° 방향에 가장 가까운 점까지의 거리
      const cx = 400 - r;
      const best = points
        .filter((p) => p.x > cx && p.y < r)
        .reduce((a, b) =>
          Math.abs(b.x - cx - (r - b.y)) < Math.abs(a.x - cx - (r - a.y)) ? b : a,
        );
      return Math.hypot(best.x - cx, best.y - r);
    };
    expect(diagonal(4) - diagonal(2)).toBeGreaterThan(2.5);
  });

  test("각도는 squircle에서도 0에서 360까지 줄지 않고 끝은 360이다", () => {
    const angles = orbitPointsOf({ width: 200, height: 60, radius: 20, exponent: 4 }).map(
      (p) => p.angle,
    );
    expect(angles.every((angle, i) => i === 0 || angle >= (angles[i - 1] ?? 0))).toBe(true);
    expect(angles.at(-1)).toBe(360);
  });
});

describe("꼬리", () => {
  test("간격(px)을 둘레 비율로 바꿔 늦춘다", () => {
    expect([trailLagMsOf(0, 14, 700, 3600), trailLagMsOf(2, 14, 700, 3600)]).toEqual([0, 144]);
    expect(trailLagMsOf(3, 14, 0, 3600)).toBe(0);
  });

  test("pointAt은 둘레 길이로 점을 읽고 둘레를 넘으면 감는다", () => {
    const points = orbitPointsOf({ width: 100, height: 40, radius: 0 });
    expect(pointAt(points, 50)).toEqual({ x: 50, y: 0 });
    expect(pointAt(points, 280 + 120)).toEqual({ x: 100, y: 20 });
  });
});
