// 크래프트 배경과 구체의 순수 계산과 셰이더 소스. DOM과 WebGL 문맥 없이 시험한다.
// 셰이더 문자열 안의 색 상수만 원시 색 값을 가진다(GLSL 상수는 허용). 바깥 TS에는 색 값이 없다.
import { CENTER, type View } from "@fresnel/client/workbench/canvas";

/** 어두운 판 가장 밝은 곳의 선형 휘도 상한. 본문 글자(밝은 회색, 선형 휘도 약 0.888)와 4.5:1 이상을 지키려고 둔다(0.14에서 약 4.9:1). */
export const DARK_PEAK_LUMA = 0.14;

/** 구체 캔버스 한 변은 구체 지름의 2.4배다: 바깥 빛이 캔버스 가장자리 안에서 0이 되도록 여유를 둔다. */
export const CORE_BOX_SCALE = 2.4;

/** 에너지가 목표에 닿는 시간(ms). 5τ라서 이 안에 목표와의 차이가 스냅 값 아래로 줄어든다. */
const ENERGY_EASE_MS = 400;
const ENERGY_TAU_MS = ENERGY_EASE_MS / 5;
/** 이 차이 안으로 들어오면 목표 값으로 맞춘다. 눈에 안 띄는 긴 꼬리를 끊어 400ms에 정확히 닿게 한다. */
const ENERGY_SNAP = 0.01;

/** 말소리 신호의 칸 길이(초). 칸 경계는 드러나지 않고 짧은 덩이가 칸마다 흔들린다. */
const SLOT = 1.7;
const TAU = Math.PI * 2;
/** 프레임 간격 상한(초). 탭을 오래 가렸다 돌아와도 한꺼번에 튀지 않게 한다. */
const FRAME_DT_MAX = 0.1;
/** 움직임 줄이기에서 찍는 한 장의 시계와 띠 돌림 각 */
const STILL_TIME = 12;
const STILL_ROT: Quad = [0.3, -0.2, 0.25, -0.3];
/** 띠 넷의 시작 돌림 각(라디안)과 돌림 빠르기(라디안/초, 에너지 0 기준). 부호가 엇갈려 서로 반대로 돈다. */
const ROT_START: Quad = [0.4, 1.9, 3.1, 4.6];
const SPIN: Quad = [0.5, -0.38, 0.62, -0.8];

type Pair = readonly [number, number];
type Quad = readonly [number, number, number, number];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (p: number): number => p * p * (3 - 2 * p);
/** 정수 칸마다 0..1에 흩어진 값 */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 에너지를 목표 쪽으로 옮긴다. 시간상수로 지수 감쇠하고, 차이가 ENERGY_SNAP 아래면 목표에 맞춘다.
 * 그래서 어떤 값에서 출발해도 ENERGY_EASE_MS 안에 목표에 정확히 닿는다(갑자기 튀지 않는다).
 */
export function easeEnergy(current: number, target: number, dtMs: number): number {
  if (dtMs <= 0) return current;
  const next = current + (target - current) * (1 - Math.exp(-dtMs / ENERGY_TAU_MS));
  return Math.abs(target - next) < ENERGY_SNAP ? target : next;
}

/**
 * 말소리 같은 신호 0..1. 어긋난 사인 셋이 느린 물결을 만들고, 칸마다 짧은 덩이가 그 위에 얹힌다.
 * 덩이는 칸마다 있거나 없고 세기와 자리가 흩어져 있어 규칙적인 박자가 되지 않는다.
 */
export function speechSignal(t: number): number {
  const wave =
    0.52 * Math.sin((TAU * t) / 4.3) +
    0.3 * Math.sin((TAU * t) / 2.7 + 1.3) +
    0.18 * Math.sin((TAU * t) / 1.9 + 2.6);
  const base = clamp01(0.5 + 0.5 * wave) ** 2.6 * 0.42;
  let burst = 0;
  const n = Math.floor(t / SLOT);
  for (let i = n - 2; i <= n + 1; i++) {
    if (hash(i + 0.37) < 0.4) continue;
    const tau = t - (i * SLOT + (hash(i) - 0.5) * 0.9);
    if (tau <= 0) continue;
    // 덩이: 0.3초 안팎에 부드럽게 올라 0.8초쯤 천천히 가라앉는다
    const tp = 0.28 + 0.22 * hash(i + 0.13);
    const amp = 0.45 + 0.55 * hash(i + 0.71);
    const rise = smooth(clamp01(tau / tp));
    const fall = tau < tp ? 1 : Math.exp(-(tau - tp) / 0.8);
    burst = Math.max(burst, amp * rise * fall);
  }
  return clamp01(base + 0.8 * burst);
}

/** 목표 에너지를 말소리 신호로 흔든다. 신호가 0이어도 목표의 0.6배 아래로 내려가지 않아 말할 때 끊기지 않는다. */
export function shapedEnergy(e: number, t: number): number {
  return clamp01(clamp01(e) * (0.6 + 0.4 * speechSignal(t)));
}

/** 구체의 움직임 상태. 한 걸음마다 새 값을 만든다(시험하기 쉽게 불변으로 둔다). */
export interface CoreMotion {
  /** 실제 흐른 시간(초): 신호와 숨쉬기의 시계 */
  readonly real: number;
  /** 느린 시계(초): 띠의 자리와 빛의 방향이 흐른다. 에너지에 따라 빨라진다 */
  readonly tm: number;
  /** 천의 흐름 시계 */
  readonly fl: number;
  /** 띠 넷의 돌림 각(라디안) */
  readonly rot: Quad;
  /** 에너지 0..1(목표 쪽으로 easeEnergy가 옮긴 값) */
  readonly e: number;
}

/** 처음 상태. 에너지는 목표에서 출발해 마운트 때 튀는 전환이 없다. */
export function initialCoreMotion(energy: number): CoreMotion {
  return { real: 0, tm: 0, fl: 0, rot: ROT_START, e: clamp01(energy) };
}

/** 프레임 간격(초). 처음 한 장은 0이고, 음수와 긴 공백은 잘린다. */
export function frameDtSeconds(prevMs: number | null, nowMs: number): number {
  if (prevMs === null) return 0;
  return Math.min(Math.max((nowMs - prevMs) / 1000, 0), FRAME_DT_MAX);
}

/** 한 걸음(dtS초). 에너지는 목표 쪽으로 옮기고, 돌림과 흐름 시계는 에너지에 따라 빨라진다. */
export function stepCore(m: CoreMotion, dtS: number, target: number): CoreMotion {
  const dt = Math.max(0, dtS);
  const e = easeEnergy(m.e, clamp01(target), dt * 1000);
  const sp = dt * (0.7 + 2.0 * e);
  const rot: Quad = [
    m.rot[0] + SPIN[0] * sp,
    m.rot[1] + SPIN[1] * sp,
    m.rot[2] + SPIN[2] * sp,
    m.rot[3] + SPIN[3] * sp,
  ];
  return {
    real: m.real + dt,
    tm: m.tm + dt * (0.6 + 1.4 * e),
    fl: m.fl + dt * (0.5 + 1.0 * e),
    rot,
    e,
  };
}

/** 숨쉬기: 에너지에 따라 구체가 3~4% 오르내리고 가로세로가 1% 남짓 엇갈린다. 쉴 때도 천천히 숨 쉰다. */
export function breathScale(real: number, e: number): Pair {
  const b = Math.min(1, Math.max(-0.35, (e - 0.2) / 0.55));
  const s = 1 + 0.035 * b + 0.008 * Math.sin((TAU * real) / 5.6);
  const q =
    0.012 *
    (0.4 + e) *
    (0.7 * Math.sin((TAU * real) / 7.3 + 0.7) + 0.3 * Math.sin((TAU * real) / 3.1 + 2.0));
  return [s * (1 + q), s * (1 - q)];
}

/** 셰이더에 넘길 구체의 값 한 벌 */
export interface CoreFrame {
  readonly time: number;
  readonly flow: number;
  readonly rot: Quad;
  readonly energy: number;
  readonly scale: Pair;
}

/** 움직임 줄이기면 시계와 돌림을 고정하고 에너지는 목표 그대로 보인다(움직임이 없으니 옮길 것도 없다). */
export function coreFrame(m: CoreMotion, target: number, still: boolean): CoreFrame {
  if (still) {
    return {
      time: STILL_TIME,
      flow: STILL_TIME,
      rot: STILL_ROT,
      energy: clamp01(target),
      scale: [1, 1],
    };
  }
  const energy = shapedEnergy(m.e, m.real);
  return { time: m.tm, flow: m.fl, rot: m.rot, energy, scale: breathScale(m.real, energy) };
}

/** 지도 시점을 한 줄로. 배경이 이 값이 바뀌었는지만 본다. */
export function viewKey(view: View): string {
  return `${view.k}|${view.x}|${view.y}`;
}

/** 배경 셰이더에 넘길 값 한 벌. 좌표는 CSS px이고 원점은 캔버스 왼쪽 위다. */
export interface BackgroundFrame {
  /** 캔버스 크기(기기 px) */
  readonly res: Pair;
  /** CSS px 하나당 기기 px 배율 */
  readonly ratio: number;
  readonly time: number;
  readonly pan: Pair;
  readonly k: number;
  /** 가운데 행성(코어)의 화면 위치: 지도의 세계 중심(CENTER)이 놓인 자리 */
  readonly core: Pair;
  readonly dark: number;
}

/** 배경 한 장의 값. 움직임 줄이기는 시간을 0에 묶어 한 장만 그린다. */
export function backgroundFrame(
  view: View,
  res: Pair,
  ratio: number,
  elapsedS: number,
  still: boolean,
  dark: boolean,
): BackgroundFrame {
  return {
    res,
    ratio,
    time: still ? 0 : elapsedS,
    pan: [view.x, view.y],
    k: view.k,
    core: [view.x + CENTER * view.k, view.y + CENTER * view.k],
    dark: dark ? 1 : 0,
  };
}

/** 전체 화면 삼각형의 버텍스 셰이더. 두 셰이더가 같이 쓴다. */
export const QUAD_VERT: string = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

/**
 * 배경 셰이더(한 장). 거의 검은 바탕의 워프된 성운, 대각선 띠의 별, 가까운 먼지, 천천히 지나는 물결.
 * 밝은 판은 같은 구조를 옅은 안개로 읽는다. 어두운 판의 가장 밝은 곳은 DARK_PEAK_LUMA에서 누른다.
 */
export const BACKGROUND_FRAG: string = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uDpr; uniform float uTime;
uniform vec2 uPan; uniform float uK; uniform float uDark;
uniform vec2 uCore;

const float TAU = 6.2831853;
const float CAP = ${DARK_PEAK_LUMA};
const vec2 BAND_N = vec2(0.4191, 0.9080);
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
const vec3 LIGHT_BASE = vec3(0.969, 0.965, 0.984);
const vec3 LIGHT_A = vec3(0.557, 0.612, 0.941);
const vec3 LIGHT_B = vec3(0.957, 0.945, 0.98);
const vec3 LIGHT_C = vec3(0.965, 0.788, 0.706);
const vec3 LIGHT_WARM = vec3(0.975, 0.905, 0.885);
const vec3 DARK_BASE = vec3(5.0, 6.0, 11.0) / 255.0;
const vec3 DARK_A = vec3(0.36, 0.50, 0.86);
const vec3 VIOLET = vec3(0.49, 0.298, 1.0);
const vec3 MAGENTA = vec3(0.757, 0.235, 0.839);
const vec3 AMBER = vec3(0.86, 0.52, 0.36);

float hash12(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 hash22(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm3(vec2 p){
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = ROT * p * 2.03 + 1.7;
    a *= 0.5;
  }
  return s / 0.875;
}
float fbm5(vec2 p){
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = ROT * p * 2.03 + 1.7;
    a *= 0.5;
  }
  return s / 0.96875;
}

vec2 layerUV(vec2 p, vec2 c, float m, float z){
  return (p - c - m * uPan) / pow(uK, z);
}

float bandShape(vec2 u, float S){
  float dl = dot(u, BAND_N) - 0.04 * S;
  float band = exp(-dl * dl / (2.0 * 0.09 * 0.09 * S * S));
  float cl = vnoise(u / (0.4 * S) + vec2(3.1, 7.7));
  return band * (0.35 + 0.65 * smoothstep(0.3, 0.75, cl));
}
float bandDensity(vec2 u, float S){
  return 0.006 + 0.62 * bandShape(u, S);
}

vec2 starCell(vec2 u, float cs, vec2 id, vec2 seed, float sig, float S, float t){
  vec2 c = (id + 0.1 + 0.8 * hash22(id + seed)) * cs;
  float keep = step(hash12(id + seed + 19.7), bandDensity(c, S));
  float h = max(hash12(id + seed + 7.3), 0.0003);
  float b = min(0.045 * pow(h, -0.667), 1.0);
  float tw = step(0.982, hash12(id + seed + 31.1));
  float rate = 0.2 + 0.4 * hash12(id + seed + 5.5);
  float ph = TAU * hash12(id + seed + 2.9);
  float amp = mix(1.0, 0.15 + 0.85 * (0.5 + 0.5 * sin(t * rate + ph)), tw);
  float sg = sig * (0.9 + 0.5 * b);
  vec2 d = u - c;
  float v = keep * b * amp * exp(-dot(d, d) / (2.0 * sg * sg));
  return vec2(v, v * hash12(id + seed + 13.3));
}

vec2 starLayer(vec2 u, float cs, vec2 seed, float sig, float S, float t){
  vec2 i0 = floor(u / cs - 0.5);
  vec2 acc = vec2(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      acc += starCell(u, cs, i0 + vec2(float(i), float(j)), seed, sig, S, t);
    }
  }
  return acc;
}

float dustCell(vec2 u, float cs, vec2 id, float t){
  vec2 hp = hash22(id + 3.3);
  float on = step(hash12(id + 9.1), 0.08);
  vec2 c = (id + 0.2 + 0.6 * hp) * cs + 6.0 * vec2(sin(0.08 * t + TAU * hp.x), cos(0.065 * t + TAU * hp.y));
  float r = 5.0 + 6.0 * hash12(id + 4.4);
  vec2 d = u - c;
  return on * (0.35 + 0.65 * hash12(id + 11.2)) * exp(-dot(d, d) / (2.0 * r * r));
}
float dustLayer(vec2 u, float cs, float t){
  vec2 i0 = floor(u / cs - 0.5);
  float acc = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      acc += dustCell(u, cs, i0 + vec2(float(i), float(j)), t);
    }
  }
  return acc;
}

vec3 toLin(vec3 c){
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 l){
  l = clamp(l, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l));
}

vec3 capPeak(vec3 c, float cap){
  vec3 lin = toLin(c);
  float y = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  float knee = 0.6 * cap;
  float yo = y;
  if (y > knee) yo = knee + (cap - knee) * (1.0 - exp(-(y - knee) / (cap - knee)));
  return toSrgb(lin * (yo / max(y, 1e-6)));
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 C = 0.5 * uRes / uDpr;
  float S = max(uRes.x, uRes.y) / uDpr;
  float t = uTime;
  bool dark = uDark > 0.5;
  vec3 pBase = dark ? DARK_BASE : LIGHT_BASE;
  vec3 pA = dark ? DARK_A : LIGHT_A;
  vec3 pB = dark ? mix(DARK_A, VIOLET, 0.55) : LIGHT_B;
  vec3 pC = dark ? mix(DARK_A, MAGENTA, 0.7) : LIGHT_C;
  vec3 pWarm = dark ? AMBER : LIGHT_WARM;

  vec2 n = layerUV(p, C, 0.04, 0.10) / (0.35 * S);

  vec2 d1 = vec2(0.87, -0.49);
  vec2 d2 = vec2(0.30, 0.954);
  float ph1 = dot(n, d1) / 2.9 - t / 46.0 + 0.15 * (vnoise(n * 0.6 + vec2(0.0, 0.02 * t)) - 0.5);
  float x1 = fract(ph1) - 0.5;
  float a1 = smoothstep(0.4, 0.7, fbm3(n * 0.6 + vec2(1.3, 0.0) + 0.006 * t));
  float b1 = exp(-x1 * x1 / 0.0592) * a1;
  float ph2 = dot(n, d2) / 3.7 + t / 58.0 + 0.15 * (vnoise(n * 0.5 + vec2(4.0, 1.0) - vec2(0.0, 0.015 * t)) - 0.5);
  float x2 = fract(ph2) - 0.5;
  float a2 = smoothstep(0.4, 0.75, fbm3(n * 0.5 + vec2(7.0, 3.0) - 0.005 * t));
  float b2 = 0.7 * exp(-x2 * x2 / 0.0365) * a2;
  float G = clamp(b1 + b2, 0.0, 1.0);
  vec2 nw = n + 0.10 * (d1 * b1 + d2 * b2);

  vec2 base = nw + vec2(0.012, -0.008) * t;
  vec2 q = vec2(fbm3(base), fbm3(base + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fbm3(base + 2.2 * q + vec2(1.7, 9.2) + vec2(0.0, 0.010 * t)),
    fbm3(base + 2.2 * q + vec2(8.3, 2.8) - vec2(0.008 * t, 0.0))
  );
  float f = fbm5(base + 2.4 * r);
  float reg = smoothstep(0.42, 0.74, fbm3(n * 0.75 + vec2(2.7, 5.1)));
  float dn = clamp((f - 0.46) / 0.36, 0.0, 1.0);
  float cloud = dn * dn * (3.0 - 2.0 * dn) * (0.03 + 0.97 * reg);
  float warm = smoothstep(0.7, 0.92, f) * smoothstep(0.5, 0.72, fbm3(vec2(n.x * 1.3, n.y * 3.7) + 9.0 + 0.004 * t));
  vec3 hue = mix(pA, pB, smoothstep(0.30, 0.75, r.x));
  hue = mix(hue, pC, 0.8 * smoothstep(0.55, 0.8, fbm3(n * 0.6 + vec2(9.0, 1.0))));

  float R = 300.0 * sqrt(uK);
  vec2 dO = p - uCore;
  float glow = exp(-dot(dO, dO) / (2.0 * R * R));

  vec2 uFar = layerUV(p, C, 0.08, 0.18);
  vec2 uNear = layerUV(p, C, 0.14, 0.30);
  vec2 st = starLayer(uFar, 11.0, vec2(0.0), 0.42, S, t)
          + starLayer(uFar, 23.0, vec2(17.3, 4.1), 0.45, S, t)
          + starLayer(uNear, 53.0, vec2(41.0, 8.0), 0.6, S, t);
  float tint = clamp(st.y / max(st.x, 1e-4), 0.0, 1.0);

  float dust = dustLayer(layerUV(p, C, 0.25, 0.45), 60.0, t);

  vec3 col;
  if (dark) {
    col = pBase;
    col += hue * cloud * 0.3;
    col += mix(pA, pB, 0.5) * G * G * 0.08;
    col += pWarm * warm * 0.05;
    col += mix(hue, pWarm, 0.5) * glow * (0.06 + 0.05 * cloud);
    col += mix(pA, vec3(0.9), 0.2) * dust * 0.025;
    col += vec3(0.55, 0.62, 0.95) * bandShape(uFar, S) * 0.065;
    vec3 starC = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.88, 0.74), tint);
    col += starC * st.x;
    col = capPeak(col + (hash12(gl_FragCoord.xy) - 0.5) / 255.0, CAP);
  } else {
    col = pBase;
    float haze = clamp(0.8 * smoothstep(0.4, 0.95, f) * (0.35 + 0.65 * reg) + 0.2 * cloud, 0.0, 1.0);
    col = mix(col, pA, haze * 0.32);
    col = mix(col, pC, warm * cloud * 0.12);
    col = mix(col, pWarm, glow * 0.2);
    col = mix(col, pA, G * 0.08);
    col = mix(col, vec3(0.14, 0.16, 0.26), min(st.x * 0.8, 0.5));
    col = mix(col, pA * 0.8, dust * 0.10);
    col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * 구체 셰이더(한 장). 해석적 구-광선 교차로 법선을 얻고, 프레넬 림, 작은 반사점, 도는 띠 넷,
 * 바깥 호와 빛을 그린다. 색은 진주·페리윙클·보라·복숭아 안에서만 옮긴다.
 */
export const CORE_FRAG: string = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uCenter;
uniform float uR;
uniform float uEdge;
uniform float uDark;
uniform float uTime;
uniform float uFlow;
uniform vec4 uRot;
uniform float uEnergy;
uniform vec2 uScale;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i), f);
  float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float flow(vec2 p) {
  return gnoise(p) * 0.66 + gnoise(p * 2.03 + vec2(11.7, 5.3)) * 0.34;
}

vec3 pearl(float u) {
  float w = 0.5 + 0.5 * sin(6.2831853 * u);
  vec3 peri = mix(vec3(0.55, 0.62, 0.98), vec3(0.36, 0.42, 0.74), uDark);
  vec3 peach = mix(vec3(1.0, 0.80, 0.66), vec3(0.80, 0.60, 0.52), uDark);
  vec3 p0 = mix(vec3(0.97, 0.97, 1.0), vec3(0.52, 0.56, 0.68), uDark);
  return w < 0.5 ? mix(peri, p0, 2.0 * w) : mix(p0, peach, 2.0 * w - 1.0);
}

vec3 chroma(vec3 c, float k) {
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  return clamp(mix(vec3(l), c, k), 0.0, 1.0);
}

void params(int k, float T, out float ang, out float c, out float w, out float A, out float fq) {
  if (k == 0) {
    ang = 5.50 + 0.08 * sin(0.06 * T);
    c = -0.04;
    w = 0.36;
    A = 0.42;
    fq = 1.00;
  } else if (k == 1) {
    ang = 1.95 + 0.08 * sin(0.05 * T + 1.0);
    c = -0.46;
    w = 0.26;
    A = 0.50;
    fq = 1.20;
  } else if (k == 2) {
    ang = 0.95 + 0.08 * sin(0.07 * T + 2.0);
    c = 0.44;
    w = 0.22;
    A = 0.42;
    fq = 1.40;
  } else {
    ang = 3.55 + 0.07 * sin(0.08 * T + 0.3);
    c = -0.12;
    w = 0.13;
    A = 0.36;
    fq = 1.80;
  }
}

vec3 axisOf(int k) {
  if (k == 0) return normalize(vec3(0.36, 0.84, 0.40));
  if (k == 1) return normalize(vec3(-0.82, 0.31, 0.48));
  if (k == 2) return normalize(vec3(0.64, -0.52, 0.57));
  return normalize(vec3(-0.18, -0.70, 0.69));
}

vec3 spinVec(vec3 v, vec3 a, float th) {
  return v * cos(th) + cross(a, v) * sin(th) + a * dot(a, v) * (1.0 - cos(th));
}

vec3 unspin(vec3 p, vec3 a, float th) {
  return spinVec(p, a, -th);
}

void ribbonK(int k, vec2 s, float nz, float T, float F, float E, float th, out vec4 layer, out float zh) {
  float ang;
  float c;
  float w;
  float A;
  float fq;
  params(k, T, ang, c, w, A, fq);
  vec2 d = vec2(cos(ang), sin(ang));
  vec3 ax = axisOf(k);
  vec3 pr = unspin(vec3(s, nz), ax, th);
  zh = pr.z;
  w *= 1.0 + 0.22 * E;
  A *= 1.0 + 0.25 * E;
  float fk = float(k);
  float G0 = dot(pr.xy, d) - c;
  float fade = smoothstep(1.0, 0.70, length(s));
  if (fade <= 0.0 || abs(G0) > 1.6 * w + 0.8 * A) {
    layer = vec4(0.0);
    return;
  }
  vec2 q = pr.xy * fq + vec2(fk * 3.7 + 1.3, fk * 1.9 - 2.1) + vec2(cos(fk * 2.1), sin(fk * 2.1)) * 0.02 * F;
  float W0 = flow(q);
  float G = G0 + A * W0;
  vec3 m = spinVec(vec3(d, 0.0), ax, th);
  vec2 gG = m.xy - m.z * s / max(nz, 0.1);
  float gl = max(length(gG), 0.2);
  float u = G / w;
  float au = abs(u);
  float body = 1.0 - smoothstep(0.25, 1.0, au);
  float delta = (abs(G) - w) / gl;
  float sigL = 1.2 / uR;
  float turn = smoothstep(0.9, 1.5, gl);
  float lineA = exp(-(delta * delta) / (sigL * sigL)) * turn;
  float face = mix(0.6, 1.0, smoothstep(-0.2, 0.35, pr.z));
  vec3 rc = chroma(pearl(nz * 0.9 + pr.z * 0.45 + fk * 0.21 + W0 * 0.5), 1.0 + 0.3 * E);
  vec3 vio = mix(vec3(0.70, 0.58, 0.98), vec3(0.46, 0.34, 0.78), uDark);
  rc = mix(rc, vio, 0.22 * E * smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(F * 0.35 + fk * 1.7)));
  vec3 Ls = normalize(vec3(-0.5, 0.65, 0.58));
  float lam = 0.86 + 0.14 * dot(vec3(s, nz), Ls);
  float gain = 0.85 + 0.8 * E;
  float aBody = body * fade * mix(0.36, 0.20, uDark) * gain * face;
  vec3 lineC = mix(vec3(1.0, 0.99, 1.0), rc, 0.35);
  float lineAf = lineA * fade * mix(0.7, 0.42, uDark) * (0.8 + 0.9 * E) * face;
  vec3 emit = rc * lam * body * fade * uDark * 0.40 * gain * face;
  layer = vec4(rc * lam * aBody * (1.0 - uDark) + emit + lineC * lineAf, aBody + lineAf * (1.0 - aBody));
}

vec4 outerSheet(vec2 s, float T, float F, float E) {
  float fadeO = 1.0 - smoothstep(1.55, 2.05, length(s));
  if (fadeO <= 0.0) return vec4(0.0);
  vec2 v = s - vec2(0.10, -0.10);
  float th = 0.55 + 0.05 * sin(0.05 * T);
  vec2 p = vec2(cos(th) * v.x + sin(th) * v.y, -sin(th) * v.x + cos(th) * v.y);
  float er = length(vec2(p.x / 1.62, p.y / 0.50));
  float wob = 0.05 * flow(s * 1.3 + vec2(3.0, 7.0) + vec2(0.01, 0.006) * F);
  float dd = er - 1.0 + wob;
  float band = 1.0 - smoothstep(0.02, 0.40 * (1.0 + 0.2 * E), abs(dd));
  float side = mix(0.40, 1.0, smoothstep(-1.2, 1.0, p.x));
  float a = band * fadeO * side * mix(0.16, 0.08, uDark) * (0.8 + 0.5 * E);
  float xe = (abs(dd) - 0.10) / 0.03;
  float edgeL = exp(-xe * xe) * fadeO * side * mix(0.14, 0.06, uDark);
  vec3 oc = mix(vec3(0.70, 0.75, 1.0), vec3(1.0, 0.84, 0.74), smoothstep(-0.2, 1.2, p.x));
  oc = mix(oc, vec3(0.30, 0.36, 0.66), uDark);
  vec3 lineO = mix(vec3(1.0), oc, 0.3);
  return vec4(oc * a + lineO * edgeL, a + edgeL * (1.0 - a));
}

void cswap(inout float za, inout float zb, inout vec4 la, inout vec4 lb) {
  if (za > zb) {
    float tz = za;
    za = zb;
    zb = tz;
    vec4 tl = la;
    la = lb;
    lb = tl;
  }
}

void main() {
  vec2 dpx = gl_FragCoord.xy - uCenter;
  float rpx = length(dpx);
  vec2 s = dpx / (uR * uScale);
  float dN = length(s);
  float T = uTime;
  float F = uFlow;
  float E = uEnergy;
  vec3 L = normalize(vec3(-0.45 + 0.04 * sin(0.07 * T), 0.60 + 0.03 * cos(0.06 * T), 0.66));
  vec3 Hs = normalize(L + vec3(0.0, 0.0, 1.0));

  float g = exp(-max(dN - 1.0, 0.0) * 3.0);
  float fadeOut = 1.0 - smoothstep(uEdge * 0.72, uEdge, rpx / uR);
  vec2 dir = dpx / max(rpx, 0.001);
  vec3 hPeri = mix(vec3(0.60, 0.66, 1.0), vec3(0.26, 0.33, 0.80), uDark);
  vec3 hPeach = mix(vec3(1.0, 0.82, 0.70), vec3(0.50, 0.34, 0.78), uDark);
  vec3 haloC = mix(hPeri, hPeach, smoothstep(0.1, -0.8, dir.y));
  float haloA = g * fadeOut * mix(0.26, 0.40, uDark) * (0.8 + 0.45 * E);

  vec4 outer = outerSheet(s, T, F, E);

  float cov = clamp((1.0 - dN) * uR + 0.5, 0.0, 1.0);
  vec3 col = vec3(0.0);
  if (cov > 0.0) {
    vec3 N = vec3(s, sqrt(max(1.0 - dot(s, s), 0.0)));
    vec3 base = vec3(0.955, 0.962, 0.99);
    float shL = smoothstep(0.35, -0.85, dot(N.xy, normalize(vec2(-0.7, -0.75))));
    base = mix(base, vec3(0.62, 0.69, 0.92), shL * 0.62 * (1.0 - uDark));
    float glR = smoothstep(0.10, 0.95, dot(N.xy, normalize(vec2(0.8, 0.35))));
    base = mix(base, vec3(1.0, 0.82, 0.70), glR * 0.38 * (1.0 - uDark));
    vec3 bd = vec3(0.020, 0.026, 0.060) + vec3(0.05, 0.07, 0.16) * pow(1.0 - N.z, 2.0);
    col = mix(base, bd, uDark);
    col = mix(col, pearl(N.z * 1.3 + N.x * 0.4 - N.y * 0.3), 0.12 * (1.0 - uDark) + 0.05 * uDark);
    col = outer.rgb + col * (1.0 - outer.a);

    vec4 la;
    vec4 lb;
    vec4 lc;
    vec4 ld;
    float za;
    float zb;
    float zc;
    float zd;
    ribbonK(0, s, N.z, T, F, E, uRot.x, la, za);
    ribbonK(1, s, N.z, T, F, E, uRot.y, lb, zb);
    ribbonK(2, s, N.z, T, F, E, uRot.z, lc, zc);
    ribbonK(3, s, N.z, T, F, E, uRot.w, ld, zd);
    cswap(za, zb, la, lb);
    cswap(zc, zd, lc, ld);
    cswap(za, zc, la, lc);
    cswap(zb, zd, lb, ld);
    cswap(zb, zc, lb, lc);
    col = la.rgb + col * (1.0 - la.a);
    col = lb.rgb + col * (1.0 - lb.a);
    col = lc.rgb + col * (1.0 - lc.a);
    col = ld.rgb + col * (1.0 - ld.a);

    float fres = pow(1.0 - N.z, 3.0);
    vec3 rimC = mix(pearl(N.z * 0.9 + 0.1 + N.x * 0.2), vec3(0.50, 0.56, 0.93), 0.4 * (1.0 - uDark));
    col = mix(col, rimC, fres * 0.55 * (1.0 - uDark)) + rimC * fres * 0.55 * uDark;
    float ndh = max(dot(N, Hs), 0.0);
    col += vec3(1.0) * (pow(ndh, 260.0) * mix(1.5, 0.9, uDark) + pow(ndh, 18.0) * 0.05 * mix(1.0, 0.4, uDark));
  }
  col = min(col, vec3(1.0));
  vec3 rgbO = outer.rgb + haloC * haloA * (1.0 - outer.a);
  float aO = outer.a + haloA * (1.0 - outer.a);
  vec3 rgb = col * cov + rgbO * (1.0 - cov);
  float a = cov + aO * (1.0 - cov);
  gl_FragColor = vec4(rgb, a);
}
`;
