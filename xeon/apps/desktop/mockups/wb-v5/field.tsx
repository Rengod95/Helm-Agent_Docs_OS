// 캔버스 전체 배경: 깊은 우주. 거의 검은 바탕 위로 가장자리 없이 흐르는 성운(워프된 잡음 세 겹), 대각선 띠에 몰린 별,
// 천천히 떠도는 먼지 입자, 넓은 띠로 지나가는 물결이 한 장의 조각 셰이더에서 그려진다. 코어 둘레만 조금 더 밝고 따뜻하다.
// 밝은 판은 같은 구조를 옅은 페리윙클·진주 안개로 읽히게 하고, 별 대신 가는 어두운 먼지 점을 쓴다.
// 층마다 이동 배수와 배율 지수가 달라 깊이가 생긴다. 날 WebGL 조각 셰이더 하나(의존 없음).
// WebGL이 없거나 셰이더가 실패하면 onUnavailable로 CSS 그라디언트(.wb5-paper)로 돌아간다.
// 문맥을 잃으면 그 위에 같은 CSS 바탕을 덮어 빈 화면을 막고, 되살아나면 프로그램을 다시 짠다.
// 탭이 숨겨지면 멈추고, 움직임 줄이기를 켜면 시간을 멈추고 바뀔 때만 한 장 그린다.
import { useEffect, useRef, useState, type RefObject } from "react";
import { reducedMotion, type View } from "./viewport";

interface Props {
  view: RefObject<View>;
  onUnavailable: () => void;
}

/** 해상도 상한: 부드러운 면이라 1.25배면 충분하다 */
const DPR_CAP = 1.25;
/** 가만히 있을 때 초당 그리는 횟수 상한 */
const IDLE_FPS = 30;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uDpr; uniform float uTime;
uniform vec2 uPan; uniform float uK; uniform float uDark;
uniform vec3 uBase; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uWarm;

const float TAU = 6.2831853;
// 어두운 판: 빛 피크의 상한(선형 휘도). 위의 글자(#f2f2f2)와 4.5:1 이상을 지킨다(8비트 반올림 여유를 두고 0.137).
const float CAP = 0.137;
// 별 띠의 법선(화면 좌표, 아래가 +y). 띠는 오른쪽 위로 기운다.
const vec2 BAND_N = vec2(0.4191, 0.9080);
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

// 해시(사인 없이): 칸 번호마다 같은 값을 준다
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

// 값 잡음: 격자 값을 부드럽게 잇는다
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

// 구름 결: 세 옥타브(워프의 안쪽 단계)
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
// 다섯 옥타브(마지막 구름 밀도)
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

// 층 좌표: 이동은 층마다 다른 배수로 따라가고(패럴랙스), 배율은 k의 지수만큼 화면 가운데를 기준으로 키운다.
vec2 layerUV(vec2 p, vec2 c, float m, float z){
  return (p - c - m * uPan) / pow(uK, z);
}

// 별 띠의 모양(0..1): 완만한 대각선 둘레에 몰리고, 띠 안은 저주파 잡음으로 덩어리가 진다. 띠 빛과 별 밀도가 같이 쓴다.
float bandShape(vec2 u, float S){
  float dl = dot(u, BAND_N) - 0.04 * S;
  float band = exp(-dl * dl / (2.0 * 0.09 * 0.09 * S * S));
  float cl = vnoise(u / (0.4 * S) + vec2(3.1, 7.7));
  return band * (0.35 + 0.65 * smoothstep(0.3, 0.75, cl));
}
// 칸 하나당 별이 있을 확률: 띠 밖은 아주 드물고, 띠 안은 촘촘하다
float bandDensity(vec2 u, float S){
  return 0.006 + 0.62 * bandShape(u, S);
}

// 별 칸 하나: 위치·밝기·반짝임·색을 해시로 정한다. 밝기는 역거듭제곱이라 거의 모두 아주 어둡고 드물게 밝다.
// 반환: (밝기, 밝기 × 색 치우침). 반짝임은 1.8%의 별만 가진다.
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

// 별 층 하나: 가까운 2×2 칸의 별을 더한다. 칸 폭의 0.9배 밖의 별은 이 픽셀에 닿지 않는다.
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

// 먼지 칸 하나: 드물고 아주 흐린 큰 얼룩. 칸 가운데에서 6px 안쪽으로만 아주 천천히 떠돈다.
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

// sRGB 곡선을 정확히 풀고 다시 감는다(측정과 같은 휘도를 쓰려고 2.2 근사를 쓰지 않는다)
vec3 toLin(vec3 c){
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 l){
  l = clamp(l, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l));
}

// 피크 휘도를 cap 아래로 부드럽게 누른다(선형 휘도 기준). 색의 비율은 그대로다.
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

  // 1) 성운: 워프 세 겹(q → r → f). 가장자리 없이 흐르고, 색은 저주파 마스크가 모인 곳에만 짙다.
  vec2 n = layerUV(p, C, 0.04, 0.10) / (0.35 * S);

  // 2) 물결: 아주 넓은 띠 두 줄이 기울어 천천히 지나간다(주기 46초·58초). 띠 간격은 화면 폭의 두세 배라
  //    한 화면에 늘 한두 띠가 걸린다. 띠 세기와 앞면의 굽음은 저주파 잡음이 흔들어 같은 간격으로 반복되지 않는다.
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
  // 띠가 지나는 자리에서 구름 좌표가 살짝 밀린다
  vec2 nw = n + 0.10 * (d1 * b1 + d2 * b2);

  // 성운 워프: 안쪽 단계마다 다른 속도로 흘러 덩어리가 천천히 끓는다
  vec2 base = nw + vec2(0.012, -0.008) * t;
  vec2 q = vec2(fbm3(base), fbm3(base + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fbm3(base + 2.2 * q + vec2(1.7, 9.2) + vec2(0.0, 0.010 * t)),
    fbm3(base + 2.2 * q + vec2(8.3, 2.8) - vec2(0.008 * t, 0.0))
  );
  float f = fbm5(base + 2.4 * r);
  // 구름 짙음: f를 넓게 펴서 기울기가 완만한 곡선(끝에서 기울기 0)으로 만든다. 경계가 선으로 읽히지 않는다.
  // 색은 저주파 마스크가 모인 곳에 짙고, 나머지는 거의 검다.
  // 색이 모이는 곳은 두세 덩어리뿐이다: 세 옥타브 잡음의 높은 쪽만 남긴다(나머지는 거의 검게).
  // f는 실제로 0.45~0.85에 몰리므로 그 범위 안에서 짙음을 잡는다.
  float reg = smoothstep(0.42, 0.74, fbm3(n * 0.75 + vec2(2.7, 5.1)));
  // 짙음의 경사를 길게 잡아 덩어리 사이의 검은 골이 실루엣처럼 끊기지 않게 한다
  float dn = clamp((f - 0.46) / 0.36, 0.0, 1.0);
  float cloud = dn * dn * (3.0 - 2.0 * dn) * (0.03 + 0.97 * reg);
  // 얇은 따뜻한 결: 구름이 짙은 곳의 가느다란 가로 방향 자리에만
  float warm = smoothstep(0.7, 0.92, f) * smoothstep(0.5, 0.72, fbm3(vec2(n.x * 1.3, n.y * 3.7) + 9.0 + 0.004 * t));
  // 색 상: 파랑 → 보라(r.x), 그리고 자홍이 짙은 덩어리(따로 잡은 저주파 마스크)
  vec3 hue = mix(uA, uB, smoothstep(0.30, 0.75, r.x));
  hue = mix(hue, uC, 0.8 * smoothstep(0.55, 0.8, fbm3(n * 0.6 + vec2(9.0, 1.0))));

  // 3) 코어: 궤도의 중심은 지도 좌표 (500, 500)이고 화면에서는 pan + 500k다. 지도와 같이 움직인다.
  vec2 O = uPan + 500.0 * uK;
  float R = 300.0 * sqrt(uK);
  vec2 dO = p - O;
  float glow = exp(-dot(dO, dO) / (2.0 * R * R));

  // 4) 별: 먼 층은 칸 둘(11px, 23px), 가까운 층은 칸 하나(53px). 층마다 이동·배율 배수가 다르다.
  vec2 uFar = layerUV(p, C, 0.08, 0.18);
  vec2 uNear = layerUV(p, C, 0.14, 0.30);
  vec2 st = starLayer(uFar, 11.0, vec2(0.0), 0.42, S, t)
          + starLayer(uFar, 23.0, vec2(17.3, 4.1), 0.45, S, t)
          + starLayer(uNear, 53.0, vec2(41.0, 8.0), 0.6, S, t);
  float tint = clamp(st.y / max(st.x, 1e-4), 0.0, 1.0);

  // 5) 먼지: 가장 가까운 층. 이동 배수가 가장 크고(0.25), 배율도 가장 많이 받는다.
  float dust = dustLayer(layerUV(p, C, 0.25, 0.45), 60.0, t);

  vec3 col;
  if (dark) {
    col = uBase;
    // 성운: 파랑 → 보라 → 자홍. 색이 모인 두세 곳이 1배율에서도 보이고, 나머지는 어둡다.
    col += hue * cloud * 0.3;
    // 오로라 같은 띠: 물결의 가운데는 제곱으로 좁혀 흐린 면이 아니라 흐르는 빛으로 읽히게 한다(최대 약 18/255)
    col += mix(uA, uB, 0.5) * G * G * 0.08;
    // 따뜻한 먼지: 얇은 곳에만 옅게
    col += uWarm * warm * 0.05;
    // 코어 둘레: 따뜻하고 조금 더 밝다(넓은 가우스, 가장자리 없음)
    col += mix(hue, uWarm, 0.5) * glow * (0.06 + 0.05 * cloud);
    // 먼지: 흐린 푸른 빛(얼룩처럼 번진 입자라 점으로 읽히지 않는다)
    col += mix(uA, vec3(0.9), 0.2) * dust * 0.025;
    // 별 띠의 흐린 빛: 너무 작아 점으로 보이지 않는 별들이 띠를 따라 내는 희뿌연 빛
    col += vec3(0.55, 0.62, 0.95) * bandShape(uFar, S) * 0.065;
    // 별: 대부분 희미하고 드물게 밝다. 색은 차갑거나 따뜻하다.
    vec3 starC = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.88, 0.74), tint);
    col += starC * st.x;
    // 계조 띠 방지: 반 단계(0.5/255)의 정적 떨림. 상한을 넘지 않도록 상한 전에 넣는다.
    col = capPeak(col + (hash12(gl_FragCoord.xy) - 0.5) / 255.0, CAP);
  } else {
    col = uBase;
    // 페리윙클 안개: 넓게 깔리고 구름이 짙은 곳에서 더 진하다. 가장자리는 없다.
    // 넓고 완만한 경사로만 올린다: 좁은 경사는 소용돌이 윤곽으로 읽힌다.
    float haze = clamp(0.8 * smoothstep(0.4, 0.95, f) * (0.35 + 0.65 * reg) + 0.2 * cloud, 0.0, 1.0);
    col = mix(col, uA, haze * 0.32);
    // 복숭아빛 결과 진주빛 코어 들림
    col = mix(col, uC, warm * cloud * 0.12);
    col = mix(col, uWarm, glow * 0.2);
    // 물결: 페리윙클 띠가 옅게 지나간다(흰색 들림은 바탕이 이미 희어 보이지 않는다)
    col = mix(col, uA, G * 0.08);
    // 먼지 점: 별 자리에 놓이는 가는 어두운 점. 가장 짙은 점도 아래 글자와 4.5:1을 지키도록 불투명도를 누른다.
    col = mix(col, vec3(0.14, 0.16, 0.26), min(st.x * 0.8, 0.5));
    // 가까운 먼지: 흐린 어두운 빛깔 입자
    col = mix(col, uA * 0.8, dust * 0.10);
    col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

type Rgb = [number, number, number];

interface Palette {
  dark: boolean;
  /** 바탕 */
  base: Rgb;
  /** 성운의 첫 색(어두운 판은 info 색이 파랑 닻이다) */
  a: Rgb;
  b: Rgb;
  c: Rgb;
  /** 코어 둘레와 따뜻한 결의 색 */
  warm: Rgb;
}

/** 밝은 판(고정): 바탕, periwinkle, 진주, 복숭아, 따뜻한 진주 */
const LIGHT: Palette = {
  dark: false,
  base: [0.969, 0.965, 0.984],
  a: [0.557, 0.612, 0.941],
  b: [0.957, 0.945, 0.98],
  c: [0.965, 0.788, 0.706],
  warm: [0.975, 0.905, 0.885],
};
/** 어두운 판의 바탕: .wb5-paper의 어두운 바탕(#05060b)과 같은 값이다. */
const GROUND_DARK: Rgb = [5 / 255, 6 / 255, 11 / 255];
/** 어두운 판의 고정 점: 보라, 자홍. info 색을 이쪽으로 섞어 셋을 만든다. */
const VIOLET: Rgb = [0.49, 0.298, 1.0];
const MAGENTA: Rgb = [0.757, 0.235, 0.839];
/** 어두운 판의 따뜻한 먼지 색(호박·장미 사이) */
const AMBER: Rgb = [0.86, 0.52, 0.36];

/** CSS 변수의 색을 0..1 RGB로. 색 공간이 무엇이든 1×1 캔버스가 풀어 준다. */
function readColor(host: HTMLElement, name: string, fallback: Rgb): Rgb {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  host.appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return fallback;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return [(px[0] ?? 0) / 255, (px[1] ?? 0) / 255, (px[2] ?? 0) / 255];
}

const mixRgb = (x: Rgb, y: Rgb, t: number): Rgb => [
  x[0] + (y[0] - x[0]) * t,
  x[1] + (y[1] - x[1]) * t,
  x[2] + (y[2] - x[2]) * t,
];

/** 어두운 판의 색: info 색이 파랑 닻, 보라와 자홍은 그쪽으로 섞어 낸다 */
function darkPalette(info: Rgb): Palette {
  return {
    dark: true,
    base: GROUND_DARK,
    a: info,
    b: mixRgb(info, VIOLET, 0.55),
    c: mixRgb(info, MAGENTA, 0.7),
    warm: AMBER,
  };
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (sh === null) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

interface Uniforms {
  res: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  pan: WebGLUniformLocation | null;
  k: WebGLUniformLocation | null;
  dark: WebGLUniformLocation | null;
  base: WebGLUniformLocation | null;
  a: WebGLUniformLocation | null;
  b: WebGLUniformLocation | null;
  c: WebGLUniformLocation | null;
  warm: WebGLUniformLocation | null;
}

interface Gpu {
  prog: WebGLProgram;
  buf: WebGLBuffer;
  u: Uniforms;
}

/** 프로그램과 버퍼를 새로 짠다. 문맥이 되살아난 뒤에도 쓴다(예전 GL 객체는 그때 무효다). */
function build(gl: WebGLRenderingContext): Gpu | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (vs === null || fs === null || prog === null) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(prog);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  if (buf === null) {
    gl.deleteProgram(prog);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name);
  return {
    prog,
    buf,
    u: {
      res: u("uRes"),
      dpr: u("uDpr"),
      time: u("uTime"),
      pan: u("uPan"),
      k: u("uK"),
      dark: u("uDark"),
      base: u("uBase"),
      a: u("uA"),
      b: u("uB"),
      c: u("uC"),
      warm: u("uWarm"),
    },
  };
}

/** 측정용: 마지막 1초 동안 그린 횟수. 화면에는 쓰지 않는다. */
export const fieldStats = { draws: 0, since: 0, perSec: 0 };

export function Field({ view, onUnavailable }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 문맥을 잃은 동안: 잃은 캔버스는 흰 칸으로 남으므로 그 위를 CSS 바탕이 덮는다
  const [lostUi, setLostUi] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (gl === null) {
      onUnavailable();
      return undefined;
    }
    let gpu = build(gl);
    if (gpu === null) {
      onUnavailable();
      return undefined;
    }

    let pal: Palette = LIGHT;
    const host = canvas.parentElement ?? document.body;
    const refreshColors = (): void => {
      // 바탕의 밝기로 판을 고른다(색 자체는 쓰지 않는다). 어두운 판의 파랑 닻은 info 색이다.
      const surface = readColor(host, "--cs-color-surface-base", [1, 1, 1]);
      const dark = (surface[0] + surface[1] + surface[2]) / 3 < 0.5;
      pal = dark
        ? darkPalette(readColor(host, "--cs-color-info-graphic", [0.36, 0.5, 0.86]))
        : LIGHT;
      dirty = true;
    };

    let dpr = 1;
    let dirty = true;
    let lost = false;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    refreshColors();
    // 테마가 바뀌면 색을 다시 읽는다(html 속성 변화).
    const mo = new MutationObserver(refreshColors);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", refreshColors);

    let last = "";
    let raf = 0;
    let lastDraw = 0;
    const t0 = performance.now();

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const g = gpu;
      if (g === null || lost) return;
      const v = view.current;
      const motion = reducedMotion() ? 0 : 1;
      // 배율도 본다: 확대·축소만 해도 층마다 다르게 움직인다
      const sig = `${v.x.toFixed(1)}|${v.y.toFixed(1)}|${v.k.toFixed(4)}`;
      if (sig !== last) {
        last = sig;
        dirty = true;
      }
      // 만지는 중에는 매 프레임, 가만히 있을 때는 아주 천천히 흐르므로 초당 30번이면 충분하다. 움직임을 줄이면 바뀔 때만 그린다.
      if (!dirty && (motion === 0 || now - lastDraw < 1000 / IDLE_FPS - 2)) return;
      dirty = false;
      lastDraw = now;
      const t = ((now - t0) / 1000) * motion;
      gl.useProgram(g.prog);
      gl.uniform2f(g.u.res, canvas.width, canvas.height);
      gl.uniform1f(g.u.dpr, dpr);
      gl.uniform1f(g.u.time, t);
      gl.uniform2f(g.u.pan, v.x, v.y);
      gl.uniform1f(g.u.k, v.k);
      gl.uniform1f(g.u.dark, pal.dark ? 1 : 0);
      gl.uniform3f(g.u.base, ...pal.base);
      gl.uniform3f(g.u.a, ...pal.a);
      gl.uniform3f(g.u.b, ...pal.b);
      gl.uniform3f(g.u.c, ...pal.c);
      gl.uniform3f(g.u.warm, ...pal.warm);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      fieldStats.draws += 1;
      if (now - fieldStats.since >= 1000) {
        fieldStats.perSec = (fieldStats.draws * 1000) / (now - fieldStats.since);
        fieldStats.draws = 0;
        fieldStats.since = now;
      }
    };
    const start = (): void => {
      if (raf === 0 && !lost && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const stop = (): void => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = (): void => {
      if (document.hidden) stop();
      else {
        dirty = true;
        start();
      }
    };
    // 문맥을 잃으면: 복구를 허용하고(preventDefault), 그리기를 멈추고, 위에 CSS 바탕을 덮어 빈 화면을 막는다.
    const onLost = (e: Event): void => {
      e.preventDefault();
      lost = true;
      stop();
      setLostUi(true);
    };
    // 문맥이 돌아오면 프로그램과 버퍼를 다시 짜고 한 장 그린다.
    const onRestored = (): void => {
      lost = false;
      const g = build(gl);
      if (g === null) {
        onUnavailable();
        return;
      }
      gpu = g;
      setLostUi(false);
      gl.viewport(0, 0, canvas.width, canvas.height);
      dirty = true;
      start();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      mq.removeEventListener("change", refreshColors);
      mo.disconnect();
      ro.disconnect();
      if (!lost && gpu !== null) {
        gl.deleteProgram(gpu.prog);
        gl.deleteBuffer(gpu.buf);
      }
    };
  }, [view, onUnavailable]);

  return (
    <>
      <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />
      {lostUi && <div aria-hidden className="wb5-paper absolute inset-0" />}
    </>
  );
}
