// beam 빛 덩어리의 궤도 키프레임(dzM2 시안 §11, DP-120). 순수 함수라 화면 밖에서 시험한다(beam.tsx가 쓴다).
// dzM의 `offset-path` + `offset-distance` 애니메이션은 매 프레임 스타일을 다시 계산했다(초당 약 60회, dzM 시안 §8.3).
// 잰 상자로 둥근 사각형 둘레를 따라 transform(translate + rotate) 키프레임을 만들면 합성기에서만 돈다.
// 길이에 비례한 offset과 linear 보간이라 긴 변에서도 속도가 같고, 모서리는 6 표본(15°)으로 잇는다.

export type OrbitBox = {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
};

/** 빛 띠의 크기와 고정점(진행 방향 머리 쪽 90%, 높이 가운데) */
export type Spark = {
  readonly width: number;
  readonly height: number;
};

const CORNER_STEPS = 6;

type Point = { readonly x: number; readonly y: number; readonly angle: number };

/** 둘레를 따라 시계 방향으로 고른 점(위 변 왼쪽 끝에서 시작해 같은 자리로 돌아온다)과 그때까지의 길이 */
export function orbitPointsOf(box: OrbitBox): readonly (Point & { readonly at: number })[] {
  const w = Math.max(0, box.width);
  const h = Math.max(0, box.height);
  const r = Math.max(0, Math.min(box.radius, w / 2, h / 2));
  const points: Point[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 1; i <= CORNER_STEPS; i += 1) {
      const phi = ((from + (90 * i) / CORNER_STEPS) * Math.PI) / 180;
      points.push({
        x: cx + r * Math.cos(phi),
        y: cy + r * Math.sin(phi),
        angle: from + 90 + (90 * i) / CORNER_STEPS,
      });
    }
  };
  points.push({ x: r, y: 0, angle: 0 });
  points.push({ x: w - r, y: 0, angle: 0 });
  corner(w - r, r, -90);
  points.push({ x: w, y: h - r, angle: 90 });
  corner(w - r, h - r, 0);
  points.push({ x: r, y: h, angle: 180 });
  corner(r, h - r, 90);
  points.push({ x: 0, y: r, angle: 270 });
  corner(r, r, 180);
  const out: (Point & { readonly at: number })[] = [];
  let at = 0;
  let prev: Point | undefined;
  for (const point of points) {
    if (prev !== undefined) at += Math.hypot(point.x - prev.x, point.y - prev.y);
    out.push({ x: point.x, y: point.y, angle: point.angle, at });
    prev = point;
  }
  return out;
}

/** WAAPI 키프레임. 빛 띠의 고정점이 둘레 위 점에 오고 진행 방향으로 돈다(`transform-origin: 90% 50%`가 고정점이다) */
export function orbitKeyframesOf(box: OrbitBox, spark: Spark): Keyframe[] {
  const points = orbitPointsOf(box);
  const total = points.at(-1)?.at ?? 0;
  const ax = spark.width * 0.9;
  const ay = spark.height / 2;
  return points.map((point) => ({
    offset: total === 0 ? 0 : point.at / total,
    transform: `translate(${(point.x - ax).toFixed(2)}px, ${(point.y - ay).toFixed(2)}px) rotate(${point.angle.toFixed(2)}deg)`,
  }));
}

/** `--fx-beam-period` 글(예: "3.6s", "3600ms")을 ms로. 읽지 못하면 3600 */
export function periodMsOf(value: string): number {
  const text = value.trim();
  const ms = /^([\d.]+)ms$/.exec(text);
  if (ms?.[1] !== undefined) return Number(ms[1]);
  const s = /^([\d.]+)s$/.exec(text);
  if (s?.[1] !== undefined) return Number(s[1]) * 1000;
  return 3600;
}
