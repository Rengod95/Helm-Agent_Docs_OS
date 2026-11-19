// 크리스탈 표시를 굽는 유리 광선 추적기(DP-223 [결정: 2026-11-18 사용자 "앱 아이콘처럼 3d rendering 이 된 느낌", lcMk3, Linear AGE-53]).
// 앱 아이콘(`apps/desktop/public/brand/render/`)은 유리 결정을 실제로 렌더링한 그림이다. 표시도 같은 방식으로 만든다: 갈라진 두 조각
// (crystal-geometry.ts의 볼록 다면체)에 광선을 쏘아 들어갈 때의 굴절과 프레넬 반사, 안에서의 전반사와 여러 번의 튐, 빛깔마다 다른 굴절률(분산),
// 모서리를 둥글게 깎은 날(베벨)의 반짝임을 계산한다. 새 외부 의존 없이 CPU에서 돈다(그림이 작아 몇 초면 끝난다).
// 배경 처리: 유리를 곧장 지나 화면 뒤(앱 바탕)로 가는 빛은 색이 아니라 투명도(알파)가 된다. 그래서 구운 그림은 어느 바탕에 놓여도
// 그 바탕이 비친다. 빛깔이 든 투과분만은 알파 하나로 나타낼 수 없어 테마의 바탕색(다크·라이트)에 맞춰 색에 접어 넣는다.
// 순수 함수뿐이다. 굽기와 파일 쓰기는 crystal-bake.ts가 한다.

import { deflateSync } from "node:zlib";

/** 3차원 점·벡터(모형 단위. y 위, z 화면 밖으로) */
export type V3 = readonly [number, number, number];

/** 볼록 다면체의 면 하나: 바깥 법선 n, 안쪽은 dot(n, p) <= d */
export interface Plane {
  readonly n: V3;
  readonly d: number;
}

/** 볼록 다면체(유리 조각 하나) */
export type Solid = readonly Plane[];

/** 환경이 돌려주는 값: 그 방향에서 오는 빛(한 빛깔)과, 그 방향이 앱 바탕(투명)으로 가는 몫 */
export interface Sample {
  readonly c: number;
  readonly bg: number;
}

/** 환경: 방향 `d`(그 빛이 떠난 점 `p`)에서 빛깔 `ch`(0 빨강, 1 초록, 2 파랑)로 받는 빛 */
export type Env = (d: V3, ch: number, p: V3) => Sample;

/** 유리의 성질 */
export interface Glass {
  /** 빛깔별 굴절률(분산). 차이가 클수록 무지개가 짙다 */
  readonly ior: V3;
  /** 빛깔별 흡수(모형 단위 길이당). 아주 옅은 빛깔을 낸다 */
  readonly absorb: V3;
  /** 모서리 베벨의 너비(모형 단위) */
  readonly bevel: number;
  /** 안에서 튀는 최대 횟수 */
  readonly bounces: number;
}

const EPS = 1e-6;

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const at = (o: V3, d: V3, t: number): V3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];

export function unit(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l === 0 ? a : [a[0] / l, a[1] / l, a[2] / l];
}

/** 0 → 1로 부드럽게(e0 > e1이면 거꾸로) */
export function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface Hit {
  readonly t: number;
  /** 맞은 면 */
  readonly plane: Plane;
}

/** 바깥에서 들어오는 광선이 조각에 처음 닿는 곳. 닿지 않으면 null */
export function enterSolid(solid: Solid, o: V3, d: V3): Hit | null {
  let near = -Infinity;
  let far = Infinity;
  let first: Plane | null = null;
  for (const plane of solid) {
    const den = dot(plane.n, d);
    const dist = plane.d - dot(plane.n, o);
    if (Math.abs(den) < 1e-12) {
      if (dist < 0) return null;
      continue;
    }
    const t = dist / den;
    if (den < 0) {
      if (t > near) {
        near = t;
        first = plane;
      }
    } else if (t < far) far = t;
  }
  if (first === null || near > far || near < EPS) return null;
  return { t: near, plane: first };
}

/** 안에서 나아가는 광선이 조각을 떠나는 곳 */
export function exitSolid(solid: Solid, o: V3, d: V3): Hit | null {
  let far = Infinity;
  let last: Plane | null = null;
  for (const plane of solid) {
    const den = dot(plane.n, d);
    if (den <= 1e-12) continue;
    const t = (plane.d - dot(plane.n, o)) / den;
    if (t < far) {
      far = t;
      last = plane;
    }
  }
  return last === null ? null : { t: Math.max(0, far), plane: last };
}

/** 모서리 가까이에서는 법선이 이웃 면 쪽으로 기운다(둥글게 깎은 날). 모서리 위에서 두 면의 가운데다 */
export function bevelNormal(solid: Solid, face: Plane, p: V3, width: number): V3 {
  let best = Infinity;
  let near: Plane | null = null;
  for (const plane of solid) {
    if (plane === face) continue;
    const e = plane.d - dot(plane.n, p);
    if (e < best) {
      best = e;
      near = plane;
    }
  }
  if (near === null || best >= width) return face.n;
  const w = (1 - Math.max(0, best) / width) ** 2;
  return unit(add(face.n, mul(near.n, w)));
}

/** 유전체의 프레넬 반사율(편광 평균). n1에서 n2로, 전반사면 1 */
export function fresnel(cosi: number, n1: number, n2: number): number {
  const eta = n1 / n2;
  const sin2 = eta * eta * (1 - cosi * cosi);
  if (sin2 >= 1) return 1;
  const cost = Math.sqrt(1 - sin2);
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
  const rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost);
  return (rs * rs + rp * rp) / 2;
}

/** 굴절(법선은 광선과 마주 본다). 전반사면 null */
export function refract(d: V3, n: V3, eta: number): V3 | null {
  const cosi = -dot(n, d);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  return unit(add(mul(d, eta), mul(n, eta * cosi - Math.sqrt(k))));
}

export const reflect = (d: V3, n: V3): V3 => add(d, mul(n, -2 * dot(n, d)));

/** 광선 하나(빛깔 하나)를 따라간다. 처음 맞은 조각의 번호도 돌려준다(-1이면 맞지 않음) */
function trace(
  solids: readonly Solid[],
  o: V3,
  d: V3,
  ch: number,
  glass: Glass,
  env: Env,
  depth: number,
  skip: Solid | null,
): Sample & { readonly solid: number } {
  let hit: Hit | null = null;
  let index = -1;
  for (const [k, candidate] of solids.entries()) {
    if (candidate === skip) continue;
    const h = enterSolid(candidate, o, d);
    if (h !== null && (hit === null || h.t < hit.t)) {
      hit = h;
      index = k;
    }
  }
  const solid = solids[index];
  // 첫 광선이 비껴가면 바탕 그대로(투명). 유리에서 나온 광선은 환경을 본다
  if (hit === null || solid === undefined) {
    return depth === 0 ? { c: 0, bg: 1, solid: -1 } : { ...env(d, ch, o), solid: -1 };
  }
  const first: Hit = hit;
  const ior = glass.ior[ch] ?? 1.5;
  let p = at(o, d, first.t);
  const n = bevelNormal(solid, first.plane, p, glass.bevel);
  const outside = fresnel(Math.max(0, -dot(n, d)), 1, ior);
  const mirror = env(reflect(d, n), ch, p);
  let c = outside * mirror.c;
  let bg = outside * mirror.bg;
  let w = 1 - outside;
  let dir = refract(d, n, 1 / ior) ?? reflect(d, n);
  const absorb = glass.absorb[ch] ?? 0;
  for (let bounce = 0; bounce < glass.bounces && w > 0.002; bounce++) {
    const exit = exitSolid(solid, p, dir);
    if (exit === null) break;
    p = at(p, dir, exit.t);
    w *= Math.exp(-absorb * exit.t);
    const inward = mul(bevelNormal(solid, exit.plane, p, glass.bevel), -1);
    const inner = fresnel(Math.max(0, -dot(inward, dir)), ior, 1);
    if (inner < 1) {
      const out = refract(dir, inward, ior);
      if (out !== null) {
        const beyond =
          depth < 2
            ? trace(solids, at(p, out, 1e-4), out, ch, glass, env, depth + 1, solid)
            : env(out, ch, p);
        c += w * (1 - inner) * beyond.c;
        bg += w * (1 - inner) * beyond.bg;
      }
    }
    w *= inner;
    dir = reflect(dir, inward);
    p = at(p, dir, 1e-5);
  }
  // 튐 횟수를 다 쓰고 남은 빛은 지금 방향으로 빠져나간다고 본다(버리면 안쪽에 검은 줄이 생긴다)
  if (w > 0.002) {
    const rest = env(dir, ch, p);
    c += w * rest.c;
    bg += w * rest.bg;
  }
  return { c, bg, solid: index };
}

/** 굽기 한 장의 설정 */
export interface Shot {
  /** 그림 한 변(기기 px) */
  readonly size: number;
  /** 그림 반 변이 덮는 모형 거리 */
  readonly halfExtent: number;
  /** 한 px을 ss × ss로 나눠 쏜다 */
  readonly ss: number;
  readonly glass: Glass;
  readonly env: Env;
  /** 테마 바탕색(0~1 sRGB). 빛깔이 든 투과분을 색에 접을 때만 쓴다 */
  readonly backdrop: V3;
  /** 노출(빛 → 0~1 사이로 부드럽게 접는 세기) */
  readonly exposure: number;
}

/** 조각마다 한 장: 미리 곱한(premultiplied) RGBA, 0~1 */
export interface Layer {
  readonly size: number;
  readonly px: Float32Array;
}

/**
 * 센 빛의 넘침(lcMk5): 한 빛깔이 1을 넘는 만큼의 이 몫을 세 빛깔 모두에 더한다. 분산으로 갈라진 작은 반짝임 하나가 빨강·노랑 점으로 남지 않고
 * 사진의 강한 반사처럼 흰빛으로 탄다(빛깔은 반짝임 둘레의 옅은 무지개로만 남는다)
 */
export const HIGHLIGHT_SPILL = 0.6;

/** 카메라: 화면 앞 9 모형 단위(약한 원근) */
const CAMERA: V3 = [0, 0, 9];

/**
 * 조각들을 그린다. 한 px의 표본은 처음 맞은 조각의 층에 들어간다(두 조각을 따로 옮길 수 있게). 조각 사이의 굴절·비침은 그대로 계산한다
 */
export function renderLayers(solids: readonly Solid[], shot: Shot): Layer[] {
  const { size, ss } = shot;
  const layers = solids.map(() => new Float32Array(size * size * 4));
  const count = ss * ss;
  const sums = solids.map(() => ({ c: [0, 0, 0], bg: [0, 0, 0] }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const s of sums) {
        s.c.fill(0);
        s.bg.fill(0);
      }
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = 1 - ((y + (sy + 0.5) / ss) / size) * 2;
          const target: V3 = [u * shot.halfExtent, v * shot.halfExtent, 0];
          const d = unit(add(target, mul(CAMERA, -1)));
          for (let ch = 0; ch < 3; ch++) {
            const r = trace(solids, CAMERA, d, ch, shot.glass, shot.env, 0, null);
            sums.forEach((s, k) => {
              if (r.solid === k) {
                s.c[ch] = (s.c[ch] ?? 0) + r.c;
                s.bg[ch] = (s.bg[ch] ?? 0) + r.bg;
              } else s.bg[ch] = (s.bg[ch] ?? 0) + 1;
            });
          }
        }
      }
      const i = (y * size + x) * 4;
      sums.forEach((s, k) => {
        const layer = layers[k];
        if (layer === undefined) return;
        const through = ((s.bg[0] ?? 0) + (s.bg[1] ?? 0) + (s.bg[2] ?? 0)) / 3 / count;
        // 빛깔이 든 투과(평균과의 차)는 테마 바탕색에 실어 색에 접는다
        const lights = [0, 1, 2].map((ch) => {
          const tinted = ((s.bg[ch] ?? 0) / count - through) * (shot.backdrop[ch] ?? 0);
          return Math.max(0, (s.c[ch] ?? 0) / count + tinted);
        });
        const spill = Math.max(0, Math.max(...lights) - 1) * HIGHLIGHT_SPILL;
        for (let ch = 0; ch < 3; ch++) {
          layer[i + ch] = 1 - Math.exp(-((lights[ch] ?? 0) + spill) * shot.exposure);
        }
        layer[i + 3] = Math.min(1, Math.max(0, 1 - through));
      });
    }
  }
  return layers.map((px) => ({ size, px }));
}

/**
 * 미리 곱한 0~1 값을 PNG가 담는 곧은(straight) 8비트로. 빛이 알파보다 밝은 곳(유리 위의 반짝임)은 알파를 그 빛까지 올린다
 * (그 아래 바탕이 조금 덜 비치지만, 반짝임이 잘리지 않는다)
 */
export function toStraight8(px: Float32Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] ?? 0;
    const g = px[i + 1] ?? 0;
    const b = px[i + 2] ?? 0;
    const a = Math.min(1, Math.max(px[i + 3] ?? 0, r, g, b));
    out[i] = a > 0 ? Math.round((255 * r) / a) : 0;
    out[i + 1] = a > 0 ? Math.round((255 * g) / a) : 0;
    out[i + 2] = a > 0 ? Math.round((255 * b) / a) : 0;
    out[i + 3] = Math.round(255 * a);
  }
  return out;
}

// ---------- PNG(RGBA 8비트) ----------

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 곧은 RGBA 8비트 → PNG. 줄마다 Paeth 필터(투명한 넓은 자리가 잘 줄어든다) */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  const px = (x: number, y: number): number => (x < 0 || y < 0 ? 0 : (rgba[y * stride + x] ?? 0));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 4;
    for (let x = 0; x < stride; x++) {
      const a = px(x - 4, y);
      const b = px(x, y - 1);
      const c = px(x - 4, y - 1);
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[y * (stride + 1) + 1 + x] = (px(x, y) - pred) & 255;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------- 스튜디오(빛) ----------

/** 열쇠 빛(왼쪽 위 앞), 오른쪽 띠 빛, 아래 반사판 */
const KEY = unit([-0.55, 0.7, 0.55]);
const STRIP = unit([0.85, 0.1, 0.35]);
const LOW = unit([0.1, -0.6, 0.6]);
/** 둘째 반짝임(오른쪽 위 앞): 열쇠 빛이 닿지 않는 면의 날에도 작은 빛점이 선다 */
const SIDE_KEY = unit([0.6, 0.75, 0.3]);
/**
 * 작고 센 점 빛들(lcMk5): 화면 평면 가까이 사방에 흩어 두어 둥근 날(베벨)의 법선이 그중 하나와 맞는 자리마다 날 위에 작은 정반사 점이 선다.
 * 면 전체가 아니라 날과 꼭짓점만 반짝이게 아주 좁고, 앞면을 지나 꺾여 보이는 자리(넓은 빛깔 얼룩)가 생기지 않게 화면 쪽으로 서지 않는다
 */
const GLINTS: readonly V3[] = [
  unit([-0.3, 0.9, 0.3]),
  unit([0.9, 0.35, 0.25]),
  unit([-0.85, -0.25, 0.45]),
  unit([0.25, -0.85, 0.45]),
];
/**
 * 가는 띠 빛(lcMk5): 길고 좁은 소프트박스 두 개. 안에서 전반사로 튄 광선이 이 띠를 보면 유리 안쪽에 밝은 줄이 선다.
 * 축(띠 평면의 법선)과 띠가 놓인 반구 방향
 */
const BANDS: readonly { readonly axis: V3; readonly side: V3 }[] = [
  { axis: unit([1, 0.3, 0]), side: unit([0, 0.3, 1]) },
  { axis: unit([0.25, 1, -0.1]), side: unit([0.4, -0.1, 1]) },
];
/** 앱 아이콘 바탕의 빛깔(lcMk4): 위 왼쪽 하늘빛, 아래 오른쪽 보랏빛. 유리 너머로 비치는 면이 이 두 빛을 띤다 */
const SKY: V3 = [0.5, 0.8, 1];
const LAVENDER: V3 = [0.68, 0.54, 1];

/** 스튜디오 하나의 세기 */
export interface Studio {
  readonly dark: boolean;
  /** 유리를 곧장 지나는 빛 가운데 뒤판의 빛을 띠는 몫(나머지는 투명). 작을수록 유리 너머 앱 바탕이 비친다 */
  readonly veil: number;
  /** 하늘빛·보랏빛의 세기(0이면 흰 뒤판) */
  readonly aurora: number;
  /** 뒤판의 밝기 배율 */
  readonly lift: number;
  /** 앞쪽 방(넓은 면광)의 밝기 배율 */
  readonly room: number;
  /**
   * 앞쪽 방 가운데 앱 바탕(투명)인 몫. 유리 안에서 꺾여 옆·앞으로 나간 빛도 그 몫만큼 화면 바탕을 비춘다:
   * 빛(열쇠·띠·점)을 받지 않는 면이 뿌옇게 차지 않고 맑게 비친다
   */
  readonly open: number;
  /** 뒤에서 비스듬히 오는 가장자리 빛의 세기 */
  readonly rim: number;
  /** 넓은 빛(열쇠 빛의 넓은 자락, 위쪽 하늘, 띠 빛, 아래 반사판)의 세기. 작을수록 면이 맑고 빛은 날에 모인다 */
  readonly soft: number;
  /** 날과 꼭짓점의 작은 정반사 점(열쇠 빛 심, 둘째 반짝임, 흩어 둔 점 빛)의 세기 */
  readonly spark: number;
  /** 가는 띠 빛(안쪽의 밝은 줄)의 세기 */
  readonly lines: number;
}

/** 얼음빛(빛깔이 빠진 유리의 아주 옅은 푸른 기). 라이트는 어두운 데일수록 이 빛으로 간다(검정 대신 옅은 청회 날) */
const ICE_DARK: V3 = [0.9, 0.95, 1];
const ICE_LIGHT: V3 = [0.34, 0.5, 0.94];

/**
 * 스튜디오 환경(lcMk5: 앱 아이콘처럼 맑고 반짝이는 유리). 화면 앞쪽(카메라 쪽)은 넓은 면광(`room`)과 작은 열쇠 빛, 띠 빛, 흩어 둔 작은 점 빛,
 * 가는 띠 빛 둘이고, 화면 뒤로 곧장 가는 방향은 앱 바탕(투명)이되 그중 `veil`만큼은 밝은 뒤판(하늘빛 → 흰 → 보랏빛)을 띤다.
 * 뒤로 비스듬히 빠지는 방향은 가장자리 빛(`rim`)을 받아 날이 빛난다. 면은 맑게 비우고 빛은 날·꼭짓점·안쪽 줄에 모은다
 */
export function studio(spec: Studio): Env {
  const { dark } = spec;
  const ice = dark ? ICE_DARK : ICE_LIGHT;
  const tone = (value: number, ch: number): number => {
    const tint = ice[ch] ?? 1;
    return dark ? value * tint : value * (tint + (1 - tint) * Math.min(1, value));
  };
  const backdrop = (d: V3, ch: number, p: V3): number => {
    const t = (-2.4 - p[2]) / Math.min(-0.05, d[2]);
    const qx = p[0] + d[0] * t;
    const qy = p[1] + d[1] * t;
    const glow = Math.exp(-((qx + 0.6) ** 2 + (qy - 0.8) ** 2) / 1.6);
    const diag = (qx - qy) * 0.6;
    const sky = smooth(0.2, -1.1, diag) * spec.aurora;
    const lav = smooth(-0.2, 1.1, diag) * spec.aurora;
    const hue = 1 + ((SKY[ch] ?? 1) - 1) * sky + ((LAVENDER[ch] ?? 1) - 1) * lav;
    // 아래로 갈수록 조금 가라앉는다(면마다 밝기가 달라 깎인 모양이 읽힌다)
    const deep = smooth(0, -1.3, qy);
    const sink = (1 - 0.5 * deep) * (1 + ((LAVENDER[ch] ?? 1) - 1) * 0.6 * deep * spec.aurora);
    const level = dark ? 0.5 + 0.75 * glow : 0.66 + 0.34 * glow;
    return spec.lift * level * sink * hue;
  };
  return (d, ch, p) => {
    const behind = smooth(0.35, 0.8, -d[2]);
    // 넓은 면광 위에 작고 센 열쇠 빛(날과 꼭짓점의 반짝임)
    const align = dot(d, KEY);
    const key = smooth(0.55, 0.9, align) * (dark ? 1.5 : 0.9);
    const peak = smooth(0.95, 0.99, align) * (dark ? 7 : 4.5);
    const crown = smooth(0.5, 0.95, d[1]) * (dark ? 1.2 : 0.45);
    const strip = smooth(0.9, 0.985, dot(d, STRIP)) * (dark ? 2 : 1);
    const low = smooth(0.88, 0.98, dot(d, LOW)) * (dark ? 0.8 : 0.25);
    let glint = smooth(0.965, 0.995, dot(d, SIDE_KEY)) * (dark ? 5 : 3);
    for (const g of GLINTS) glint += smooth(0.955, 0.99, dot(d, g)) * (dark ? 6 : 3.5);
    let lines = 0;
    for (const band of BANDS) {
      lines +=
        smooth(0.06, 0.015, Math.abs(dot(d, band.axis))) * smooth(0.1, 0.5, dot(d, band.side));
    }
    // 뒤로 비스듬히 빠지는 빛(가장자리): 화면 평면에 가까울수록 세다. 하늘빛이 조금 든다
    const graze = smooth(0.5, 0.95, Math.hypot(d[0], d[1])) * smooth(-0.1, 0.45, -d[2]);
    const rim = graze * spec.rim * (dark ? 1.8 : 0.9) * (SKY[ch] ?? 1);
    const room = dark
      ? 0.4 + 0.6 * smooth(-0.4, 0.9, d[1])
      : (0.55 + 0.4 * smooth(-0.3, 0.9, d[1])) * (1 - 0.4 * smooth(0.45, 0.95, Math.abs(d[0]))) -
        0.12 * smooth(0, -0.5, d[1]);
    const front =
      (1 - spec.open) * spec.room * tone(room, ch) +
      (key + crown + strip + low) * spec.soft +
      peak * spec.spark +
      glint * spec.spark +
      lines * spec.lines * (dark ? 2.4 : 1.2);
    return {
      c: front * (1 - behind) + behind * spec.veil * backdrop(d, ch, p) + rim,
      bg: behind * (1 - spec.veil) + (1 - behind) * spec.open,
    };
  };
}
