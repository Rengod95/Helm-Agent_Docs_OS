// 크리스탈 표시의 모양(DP-223 [결정: 2026-11-18 사용자 "결정(크리스탈) 버전이 좋음", lcMk]). 로고의 비스듬히 갈라진 유리 결정 두 조각을
// 면 몇 장만 남기고 줄인 입체다. 시안(`_notes/tools/orbit-mark/crystal-mark.html`)의 기하를 그대로 옮겼다: 단면이 고르지 않은 오각형 기둥의
// 두 끝을 비스듬히 자르고, 왼쪽 위 → 오른쪽 아래로 갈라 두 조각을 틈을 따라 조금 밀어 놓는다. 이 모양을 scripts/crystal-bake.ts가 광선 추적해 판으로 굽고(lcMk3), crystal-mark.tsx는 그 판을 그린다.
// 순수 값과 함수뿐이다(시험이 면 수와 틈을 본다). 틈 폭마다 껍질을 한 번 계산해 기억한다(움직임 중에도 프레임마다 다시 풀지 않는다).

/** 3차원 점·벡터 */
export type Vec3 = readonly [number, number, number];

/** 볼록 면 하나: 바깥 법선, 둘레 꼭짓점(차례), 가운데, 갈라진 면인지 */
export interface CrystalFace {
  readonly n: Vec3;
  readonly v: readonly Vec3[];
  readonly c: Vec3;
  readonly cut: boolean;
}

const EPS = 1e-6;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scaleV = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerpV = (a: Vec3, b: Vec3, k: number): Vec3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l === 0 ? a : scaleV(a, 1 / l);
}

interface Plane {
  readonly n: Vec3;
  readonly d: number;
}

/** 볼록 껍질의 면(점이 열몇 개라 모든 세 점을 본다) */
function hull(pts: readonly Vec3[]): CrystalFace[] {
  const planes: Plane[] = [];
  const count = pts.length;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      for (let k = j + 1; k < count; k++) {
        const a = pts[i];
        const b = pts[j];
        const c = pts[k];
        if (a === undefined || b === undefined || c === undefined) continue;
        const raw = cross(sub(b, a), sub(c, a));
        const len = Math.hypot(raw[0], raw[1], raw[2]);
        if (len < 1e-9) continue;
        let n = scaleV(raw, 1 / len);
        let d = dot(n, a);
        let pos = 0;
        let neg = 0;
        for (const p of pts) {
          const s = dot(n, p) - d;
          if (s > EPS) pos++;
          else if (s < -EPS) neg++;
        }
        if (pos > 0 && neg > 0) continue;
        if (pos > 0) {
          n = scaleV(n, -1);
          d = -d;
        }
        const nn = n;
        const dd = d;
        if (planes.some((q) => dot(q.n, nn) > 1 - 1e-5 && Math.abs(q.d - dd) < 1e-5)) continue;
        planes.push({ n, d });
      }
    }
  }
  const faces: CrystalFace[] = [];
  for (const plane of planes) {
    const on = pts.filter((p) => Math.abs(dot(plane.n, p) - plane.d) < 1e-5);
    const first = on[0];
    if (on.length < 3 || first === undefined) continue;
    const c = scaleV(
      on.reduce<Vec3>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]),
      1 / on.length,
    );
    const ax = normalize(sub(first, c));
    const ay = cross(plane.n, ax);
    const angle = (p: Vec3): number => Math.atan2(dot(sub(p, c), ay), dot(sub(p, c), ax));
    const v = on.toSorted((p, q) => angle(p) - angle(q));
    faces.push({ n: plane.n, v, c, cut: false });
  }
  return faces;
}

/** 볼록 덩이를 평면 하나로 자른다(`dot(n, p) <= c` 쪽을 남긴다) */
function clip(pts: readonly Vec3[], n: Vec3, c: number): Vec3[] {
  const edges: (readonly [Vec3, Vec3])[] = [];
  for (const face of hull(pts)) {
    for (let i = 0; i < face.v.length; i++) {
      const a = face.v[i];
      const b = face.v[(i + 1) % face.v.length];
      if (a === undefined || b === undefined) continue;
      if (!edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) edges.push([a, b]);
    }
  }
  const dist = (p: Vec3): number => c - dot(n, p);
  const out = pts.filter((p) => dist(p) > EPS);
  for (const [a, b] of edges) {
    const da = dist(a);
    const db = dist(b);
    if (da > EPS !== db > EPS && Math.abs(da - db) > 1e-9) out.push(lerpV(a, b, da / (da - db)));
  }
  return out;
}

/** 단면(x, z). 넓은 옆면 몇 장이라 보석처럼 잘게 깎이지 않는다 */
const SECTION: readonly (readonly [number, number])[] = [
  [-0.54, 0.08],
  [-0.16, 0.36],
  [0.44, 0.24],
  [0.54, -0.18],
  [-0.22, -0.34],
];

function solid(): Vec3[] {
  let pts: Vec3[] = [
    ...SECTION.map(([x, z]): Vec3 => [x, 0.86 + 0.3 * x - 0.1 * z, z]),
    ...SECTION.map(([x, z]): Vec3 => [x, -0.86 + 0.16 * x + 0.14 * z, z]),
  ];
  pts = clip(pts, normalize([-0.75, 0.62, 0.25]), 0.62); // 왼쪽 위 어깨
  pts = clip(pts, normalize([0.7, -0.66, 0.2]), 0.66); // 오른쪽 아래 끝
  return pts;
}

const SOLID = solid();
/** 갈라진 면의 법선. 기본 자세에서 틈이 옆으로 보이도록 z를 기울였다 */
export const CRYSTAL_CUT_N: Vec3 = normalize([1, 0.95, -0.34]);
const CUT_N = CRYSTAL_CUT_N;
const CUT_C = 0.04;

/** 원점에서 가장 먼 꼭짓점 거리. 칸 크기에 맞춰 줄일 때 쓴다 */
export const CRYSTAL_RADIUS: number = Math.max(...SOLID.map((p) => Math.hypot(p[0], p[1], p[2])));

/** 두 조각이 틈을 따라 서로 밀린 방향(조각 +1 기준) */
const CRYSTAL_SLIDE: Vec3 = normalize(cross(CUT_N, [0, 0, 1]));

function shard(sign: 1 | -1, half: number): CrystalFace[] {
  const pts = clip(SOLID, scaleV(CUT_N, -sign), -(CUT_C * sign + half));
  // 로고처럼 두 조각이 틈을 따라 조금 밀려 있다
  const slide = scaleV(CRYSTAL_SLIDE, sign * -0.06);
  const moved = pts.map((p): Vec3 => [p[0] + slide[0], p[1] + slide[1], p[2] + slide[2]]);
  return hull(moved).map((f) => ({
    n: f.n,
    v: f.v,
    c: f.c,
    cut: Math.abs(dot(f.n, CUT_N)) > 0.999,
  }));
}

const cache = new Map<string, readonly [readonly CrystalFace[], readonly CrystalFace[]]>();
const CACHE_LIMIT = 200;

/**
 * 틈의 반폭(모형 단위)에 맞는 두 조각. 반폭은 1/1000로 맞춰 기억한다(움직임 한 번이 수십 개 이하의 값을 쓴다)
 */
export function crystalShards(
  half: number,
): readonly [readonly CrystalFace[], readonly CrystalFace[]] {
  const key = half.toFixed(3);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  const quantized = Number(key);
  const pair = [shard(1, quantized), shard(-1, quantized)] as const;
  cache.set(key, pair);
  return pair;
}

/** 요(y축), 피치(x축), 롤(z축) 차례로 돌린다 */
export function rotate(p: Vec3, yaw: number, pitch: number, roll: number): Vec3 {
  let [x, y, z] = p;
  let c = Math.cos(yaw);
  let s = Math.sin(yaw);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(pitch);
  s = Math.sin(pitch);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(roll);
  s = Math.sin(roll);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
