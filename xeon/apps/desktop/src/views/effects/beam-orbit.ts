// beam 빛 알갱이의 궤도 키프레임(dzM2 시안 §11, dzE 시안 §1, DP-125). 순수 함수라 화면 밖에서 시험한다(beam.tsx가 쓴다).
// 잰 상자의 둘레를 따라 transform(translate + rotate) 키프레임을 만들면 합성기에서만 돈다(offset-path 애니메이션은 매 프레임 스타일을 다시 계산했다).
// 모서리는 대상의 `corner-shape`를 따른다: caustic은 Chromium에서 `rounded-*`에 squircle(= superellipse(2), |x|⁴+|y|⁴=1)을 준다.
// 원형 호로만 돌면 squircle 모서리에서 빛이 상자 안쪽으로 최대 반경의 13%쯤 파고든다(dzE 시안 §1).
// 길이에 비례한 offset과 linear 보간이라 긴 변에서도 속도가 같다.

export type OrbitBox = {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** 모서리 곡선의 지수 n(|x|ⁿ+|y|ⁿ=1). 원은 2, squircle은 4. 없으면 2 */
  readonly exponent?: number;
};

/** 빛 알갱이 크기. 고정점은 가운데다(`transform-origin: 50% 50%`) */
export type Spark = {
  readonly width: number;
  readonly height: number;
};

const CORNER_STEPS = 24;

type Point = { readonly x: number; readonly y: number };
export type OrbitPoint = Point & { readonly angle: number; readonly at: number };

/** `corner-shape` 계산값을 곡선 지수로. round(또는 빈 값)는 2, squircle은 4, superellipse(K)는 2^K, bevel은 1 */
export function cornerExponentOf(shape: string): number {
  const text = shape.trim().split(/\s+/)[0] ?? "";
  if (text === "squircle") return 4;
  if (text === "bevel") return 1;
  const k = /^superellipse\(\s*(-?[\d.]+)\s*\)$/.exec(text);
  if (k?.[1] !== undefined) {
    const value = 2 ** Number(k[1]);
    return Number.isFinite(value) && value >= 1 ? value : 2;
  }
  return 2;
}

/** 모서리 한 곳의 점(시작 각 `from`에서 90° 돎, 끝점 제외·시작점 제외 없이 중간과 끝을 낸다) */
function cornerPoints(cx: number, cy: number, r: number, from: number, n: number): Point[] {
  const out: Point[] = [];
  const e = 2 / n;
  for (let i = 1; i <= CORNER_STEPS; i += 1) {
    const phi = ((from + (90 * i) / CORNER_STEPS) * Math.PI) / 180;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    out.push({
      x: cx + r * Math.sign(c) * Math.abs(c) ** e,
      y: cy + r * Math.sign(s) * Math.abs(s) ** e,
    });
  }
  return out;
}

/**
 * 둘레를 따라 시계 방향으로 고른 점(위 변 왼쪽 끝에서 시작해 같은 자리로 돌아온다), 진행 방향 각도(0에서 360까지 줄지 않음)와 그때까지의 길이
 */
export function orbitPointsOf(box: OrbitBox): readonly OrbitPoint[] {
  const w = Math.max(0, box.width);
  const h = Math.max(0, box.height);
  const r = Math.max(0, Math.min(box.radius, w / 2, h / 2));
  const n = box.exponent ?? 2;
  const points: Point[] = [
    { x: r, y: 0 },
    { x: w - r, y: 0 },
    ...cornerPoints(w - r, r, r, -90, n),
    { x: w, y: h - r },
    ...cornerPoints(w - r, h - r, r, 0, n),
    { x: r, y: h },
    ...cornerPoints(r, h - r, r, 90, n),
    { x: 0, y: r },
    ...cornerPoints(r, r, r, 180, n),
  ];
  const out: OrbitPoint[] = [];
  let at = 0;
  let angle = 0;
  let prev: Point | undefined;
  for (const [i, point] of points.entries()) {
    if (prev !== undefined) {
      const step = Math.hypot(point.x - prev.x, point.y - prev.y);
      at += step;
      if (step > 1e-6) {
        // 진행 방향 각도. 앞 각보다 작아지면(한 바퀴 넘김) 360을 더해 줄지 않게 한다
        let next = (Math.atan2(point.y - prev.y, point.x - prev.x) * 180) / Math.PI;
        while (next < angle - 180) next += 360;
        angle = Math.max(angle, next);
      }
    }
    // 마지막 점(시작점으로 돌아옴)은 한 바퀴를 마친 각도다
    out.push({ x: point.x, y: point.y, angle: i === points.length - 1 ? 360 : angle, at });
    prev = point;
  }
  return out;
}

/** 길이 `at`(둘레 위 거리)에 있는 점. 둘레 밖이면 감아서 읽는다 */
export function pointAt(points: readonly OrbitPoint[], at: number): Point {
  const total = points.at(-1)?.at ?? 0;
  if (total === 0) return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
  const d = ((at % total) + total) % total;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined || b.at < d) continue;
    const t = b.at === a.at ? 0 : (d - a.at) / (b.at - a.at);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
}

/** WAAPI 키프레임. 알갱이 가운데가 둘레 위 점에 오고 진행 방향으로 돈다 */
export function orbitKeyframesOf(box: OrbitBox, spark: Spark): Keyframe[] {
  const points = orbitPointsOf(box);
  const total = points.at(-1)?.at ?? 0;
  const ax = spark.width / 2;
  const ay = spark.height / 2;
  return points.map((point) => ({
    offset: total === 0 ? 0 : point.at / total,
    transform: `translate(${(point.x - ax).toFixed(2)}px, ${(point.y - ay).toFixed(2)}px) rotate(${point.angle.toFixed(2)}deg)`,
  }));
}

/** 꼬리 알갱이 `index`가 머리보다 뒤처지는 시간(ms). 둘레가 짧아도 간격은 같은 px다 */
export function trailLagMsOf(
  index: number,
  gapPx: number,
  perimeter: number,
  period: number,
): number {
  if (perimeter <= 0) return 0;
  return ((index * gapPx) / perimeter) * period;
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
