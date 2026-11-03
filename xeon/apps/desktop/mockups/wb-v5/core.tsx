// 코어(기본 에이전트): 가운데 유리 구체. 조각 셰이더 하나가 구체, 안쪽의 기울어진 리본 층, 바깥 빛을 그린다.
// 캔버스는 구체보다 2.4배 넓어 빛이 잘리지 않는다. 단추는 그 위의 지름 92px 원이고 고르기·호버·초점을 맡는다.
// WebGL을 못 쓰거나 컨텍스트를 잃으면 CSS 행성(.wb5-planet)을 대신 보인다. 움직임을 줄이면 한 장만 그린다.
import { useLayoutEffect, useRef, useState } from "react";
import { T } from "../_shell/terms";
import { reducedMotion } from "./viewport";

/** 캔버스 한 변은 구체 지름의 2.4배: 바깥 빛이 캔버스 가장자리 안에서 0이 되도록 여유를 둔다 */
const BOX_SCALE = 2.4;
/** 라벨 글자 배율 상한(viewport.ts labelScale). 이만큼 커져도 선명하도록 장치 해상도에 곱한다 */
const ZOOM_MAX = 1.5;
/** 긴 변 상한(성능) */
const MAX_PX = 1536;
/** 가만히 있을 때 초당 그리는 횟수 상한 */
const IDLE_FPS = 30;
/** 움직임을 줄일 때 찍는 한 장의 시각(초): 리본이 고르게 펼쳐 있는 때 */
const STILL_T = 12;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uCenter; // 구체 중심(장치 px)
uniform float uR; // 구체 반지름(장치 px)
uniform float uEdge; // 캔버스 가장자리까지 거리(구체 반지름 단위)
uniform float uTime; // 초
uniform float uDark; // 1이면 어두운 판

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

// 기울기 잡음(펄린형): 격자 무늬가 없어 등고선이 매끄럽다. 값은 약 -0.7..0.7.
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

// 흐름 잡음 두 옥타브(평균 0): 천을 접는 힘
float flow(vec2 p) {
  return gnoise(p) * 0.66 + gnoise(p * 2.03 + vec2(11.7, 5.3)) * 0.34;
}

// 진주빛: 페리윙클 → 진주 → 복숭아 → 진주 → 페리윙클을 주기적으로 오간다. 어두운 판은 채도와 밝기를 낮춘다.
vec3 pearl(float u) {
  float w = 0.5 + 0.5 * sin(6.2831853 * u);
  vec3 peri = mix(vec3(0.55, 0.62, 0.98), vec3(0.36, 0.42, 0.74), uDark);
  vec3 peach = mix(vec3(1.0, 0.80, 0.66), vec3(0.80, 0.60, 0.52), uDark);
  vec3 p0 = mix(vec3(0.97, 0.97, 1.0), vec3(0.52, 0.56, 0.68), uDark);
  return w < 0.5 ? mix(peri, p0, 2.0 * w) : mix(p0, peach, 2.0 * w - 1.0);
}

// 넓은 천 k의 모양: 띠 방향 ang, 가운데 c, 반폭 w, 접힘 A, 접힘 빈도 fq, 깊이 위상 ph. 천천히 돈다.
void params(int k, float T, out float ang, out float c, out float w, out float A, out float fq, out float ph) {
  if (k == 0) {
    // 큰 천: 왼쪽 아래에서 오른쪽 위로 가로지른다
    ang = 5.50 + 0.08 * sin(0.06 * T);
    c = -0.04;
    w = 0.36;
    A = 0.42;
    fq = 1.00;
    ph = 0.4 + 0.30 * sin(0.05 * T);
  } else if (k == 1) {
    // 아래쪽 천
    ang = 1.95 + 0.08 * sin(0.05 * T + 1.0);
    c = -0.46;
    w = 0.26;
    A = 0.50;
    fq = 1.20;
    ph = 1.7 + 0.30 * sin(0.04 * T + 2.0);
  } else if (k == 2) {
    // 위쪽 호
    ang = 0.95 + 0.08 * sin(0.07 * T + 2.0);
    c = 0.44;
    w = 0.22;
    A = 0.42;
    fq = 1.40;
    ph = 3.0 + 0.30 * sin(0.06 * T + 0.5);
  } else {
    // 얇은 진주 천: 세로로 지나며 빛을 더한다
    ang = 3.55 + 0.07 * sin(0.08 * T + 0.3);
    c = -0.12;
    w = 0.13;
    A = 0.36;
    fq = 1.80;
    ph = 4.4 + 0.30 * sin(0.07 * T + 1.2);
  }
}

// 넓은 천 k: 화면 위의 부드러운 띠. 가장자리는 흐리고, 접혀 꺾이는 곳에만 가는 빛 선이 생긴다.
// 색은 구체의 N·V와 깊이에 따라 페리윙클·진주·복숭아로 바뀐다. 결과는 premultiplied 색과 깊이다.
void ribbonK(int k, vec2 s, float T, out vec4 layer, out float zh) {
  float ang;
  float c;
  float w;
  float A;
  float fq;
  float ph;
  params(k, T, ang, c, w, A, fq, ph);
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 dp = vec2(-d.y, d.x);
  float fk = float(k);
  float nz = sqrt(max(1.0 - dot(s, s), 0.0));
  // 깊이: 구체 앞면 위에서 위상에 따라 앞뒤가 바뀐다. 가까운 층일수록 카메라가 흔들릴 때 더 움직인다.
  float dep = nz * cos(ph) + sin(ph) * dot(s, dp);
  zh = dep;
  vec2 sp = s + dep * vec2(0.07 * sin(0.11 * T), 0.05 * cos(0.08 * T));
  vec2 q = sp * fq + vec2(fk * 3.7 + 1.3, fk * 1.9 - 2.1) + vec2(cos(fk * 2.1), sin(fk * 2.1)) * 0.007 * T;
  const float e = 0.015;
  float W0 = flow(q);
  float Wx = (flow(q + vec2(e, 0.0)) - W0) / e;
  float Wy = (flow(q + vec2(0.0, e)) - W0) / e;
  float G = dot(sp, d) - c + A * W0;
  vec2 gG = d + A * fq * vec2(Wx, Wy);
  float gl = max(length(gG), 0.2);
  float u = G / w;
  float au = abs(u);
  float fade = smoothstep(1.0, 0.70, length(s));
  if (fade <= 0.0 || au > 1.6) {
    layer = vec4(0.0);
    return;
  }
  // 넓고 부드러운 몸: 가운데는 평평하고 가장자리로 갈수록 옅어진다
  float body = 1.0 - smoothstep(0.25, 1.0, au);
  // 가장자리가 급하게 꺾이는 곳에만 가는 빛 선
  float delta = (abs(G) - w) / gl;
  float sigL = 1.2 / uR;
  float turn = smoothstep(0.9, 1.5, gl);
  float lineA = exp(-(delta * delta) / (sigL * sigL)) * turn;
  vec3 rc = pearl(nz * 0.9 + dep * 0.45 + fk * 0.21 + W0 * 0.5);
  vec3 Ls = normalize(vec3(-0.5, 0.65, 0.58));
  float lam = 0.86 + 0.14 * dot(vec3(s, nz), Ls);
  float aBody = body * fade * mix(0.36, 0.20, uDark);
  vec3 lineC = mix(vec3(1.0, 0.99, 1.0), rc, 0.35);
  float lineAf = lineA * fade * mix(0.7, 0.42, uDark);
  // 밝은 판: 색이 섞여 흐려지는 막. 어두운 판: 낮은 밝기로 스스로 빛나는 막.
  vec3 emit = rc * lam * body * fade * uDark * 0.40;
  layer = vec4(rc * lam * aBody * (1.0 - uDark) + emit + lineC * lineAf, aBody + lineAf * (1.0 - aBody));
}

// 바깥 큰 호: 구체를 가로질러 가장자리 밖 빛까지 뻗는 기울어진 타원 띠. 캔버스 가장자리 안에서 0이 된다.
vec4 outerSheet(vec2 s, float T) {
  float fadeO = 1.0 - smoothstep(1.55, 2.05, length(s));
  if (fadeO <= 0.0) return vec4(0.0);
  vec2 v = s - vec2(0.10, -0.10);
  float th = 0.55 + 0.05 * sin(0.05 * T);
  vec2 p = vec2(cos(th) * v.x + sin(th) * v.y, -sin(th) * v.x + cos(th) * v.y);
  float er = length(vec2(p.x / 1.62, p.y / 0.50));
  float wob = 0.05 * flow(s * 1.3 + vec2(3.0, 7.0) + vec2(0.01, 0.006) * T);
  float dd = er - 1.0 + wob;
  // 넓고 흐린 띠. 오른쪽(복숭아 쪽)이 더 진하고, 왼쪽은 거의 사라진다.
  float band = 1.0 - smoothstep(0.02, 0.40, abs(dd));
  float side = mix(0.40, 1.0, smoothstep(-1.2, 1.0, p.x));
  float a = band * fadeO * side * mix(0.16, 0.08, uDark);
  float xe = (abs(dd) - 0.10) / 0.03;
  float edgeL = exp(-xe * xe) * fadeO * side * mix(0.14, 0.06, uDark);
  vec3 oc = mix(vec3(0.70, 0.75, 1.0), vec3(1.0, 0.84, 0.74), smoothstep(-0.2, 1.2, p.x));
  oc = mix(oc, vec3(0.30, 0.36, 0.66), uDark);
  vec3 lineO = mix(vec3(1.0), oc, 0.3);
  return vec4(oc * a + lineO * edgeL, a + edgeL * (1.0 - a));
}

// 깊이 순서로 두 층을 맞바꾼다(뒤 층이 앞에)
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
  vec2 s = dpx / uR;
  float T = uTime;
  // 빛의 방향은 아주 천천히 흔들린다
  vec3 L = normalize(vec3(-0.45 + 0.04 * sin(0.07 * T), 0.60 + 0.03 * cos(0.06 * T), 0.66));
  vec3 Hs = normalize(L + vec3(0.0, 0.0, 1.0));

  // 바깥 빛: 구체 밖 거리에 따라 exp로 줄고, 캔버스 가장자리 근처에서 0이 된다
  float d = rpx / uR;
  float g = exp(-max(d - 1.0, 0.0) * 3.0);
  float fadeOut = 1.0 - smoothstep(uEdge * 0.72, uEdge, d);
  vec2 dir = dpx / max(rpx, 0.001);
  vec3 hPeri = mix(vec3(0.60, 0.66, 1.0), vec3(0.26, 0.33, 0.80), uDark);
  vec3 hPeach = mix(vec3(1.0, 0.82, 0.70), vec3(0.50, 0.34, 0.78), uDark);
  vec3 haloC = mix(hPeri, hPeach, smoothstep(0.1, -0.8, dir.y));
  float haloA = g * fadeOut * mix(0.26, 0.40, uDark);

  // 바깥 호: 구체 안에서는 가장 뒤 층, 구체 밖에서는 빛 위에 얹힌다
  vec4 outer = outerSheet(s, T);

  float cov = clamp(uR - rpx + 0.5, 0.0, 1.0);
  vec3 col = vec3(0.0);
  if (cov > 0.0) {
    vec3 N = vec3(s, sqrt(max(1.0 - dot(s, s), 0.0)));
    // 바탕: 밝은 판은 진주에 아래왼쪽 푸른 그늘과 오른쪽 복숭아빛, 어두운 판은 남색 유리
    vec3 base = vec3(0.955, 0.962, 0.99);
    float shL = smoothstep(0.35, -0.85, dot(N.xy, normalize(vec2(-0.7, -0.75))));
    base = mix(base, vec3(0.62, 0.69, 0.92), shL * 0.62 * (1.0 - uDark));
    float glR = smoothstep(0.10, 0.95, dot(N.xy, normalize(vec2(0.8, 0.35))));
    base = mix(base, vec3(1.0, 0.82, 0.70), glR * 0.38 * (1.0 - uDark));
    vec3 bd = vec3(0.020, 0.026, 0.060) + vec3(0.05, 0.07, 0.16) * pow(1.0 - N.z, 2.0);
    col = mix(base, bd, uDark);
    // 바탕에 옅은 무지개빛(진주): N·V에 따라 색이 돈다
    col = mix(col, pearl(N.z * 1.3 + N.x * 0.4 - N.y * 0.3), 0.12 * (1.0 - uDark) + 0.05 * uDark);
    // 바깥 호: 구체 안에서 가장 뒤의 얇은 막
    col = outer.rgb + col * (1.0 - outer.a);

    // 넓은 천 네 장, 뒤에서 앞으로 쌓는다
    vec4 la;
    vec4 lb;
    vec4 lc;
    vec4 ld;
    float za;
    float zb;
    float zc;
    float zd;
    ribbonK(0, s, T, la, za);
    ribbonK(1, s, T, lb, zb);
    ribbonK(2, s, T, lc, zc);
    ribbonK(3, s, T, ld, zd);
    cswap(za, zb, la, lb);
    cswap(zc, zd, lc, ld);
    cswap(za, zc, la, lc);
    cswap(zb, zd, lb, ld);
    cswap(zb, zc, lb, lc);
    col = la.rgb + col * (1.0 - la.a);
    col = lb.rgb + col * (1.0 - lb.a);
    col = lc.rgb + col * (1.0 - lc.a);
    col = ld.rgb + col * (1.0 - ld.a);

    // 유리 겉면: 진주빛 림, 작고 날카로운 하이라이트, 아주 약한 넓은 빛
    float fres = pow(1.0 - N.z, 3.0);
    vec3 rimC = mix(pearl(N.z * 0.9 + 0.1 + N.x * 0.2), vec3(0.50, 0.56, 0.93), 0.4 * (1.0 - uDark));
    col = mix(col, rimC, fres * 0.55 * (1.0 - uDark)) + rimC * fres * 0.55 * uDark;
    float ndh = max(dot(N, Hs), 0.0);
    col += vec3(1.0) * (pow(ndh, 260.0) * mix(1.5, 0.9, uDark) + pow(ndh, 18.0) * 0.05 * mix(1.0, 0.4, uDark));
  }
  col = min(col, vec3(1.0));
  // 구체 밖: 바깥 호와 빛을 합친다
  vec3 rgbO = outer.rgb + haloC * haloA * (1.0 - outer.a);
  float aO = outer.a + haloA * (1.0 - outer.a);
  vec3 rgb = col * cov + rgbO * (1.0 - cov);
  float a = cov + aO * (1.0 - cov);
  gl_FragColor = vec4(rgb, a);
}
`;

/** 구체 하나를 그리는 WebGL 자원 묶음 */
interface Gfx {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  buf: WebGLBuffer;
  attr: number;
  /** 캔버스 한 변(장치 px) */
  px: number;
  center: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
  edge: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  dark: WebGLUniformLocation | null;
}

/** 캔버스 한 변(장치 px): 장치 해상도 × 라벨 최대 배율, 긴 변은 상한 아래 */
function backingPx(size: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(MAX_PX, Math.round(size * BOX_SCALE * dpr * ZOOM_MAX));
}

/** 배경 색을 1×1 캔버스로 풀어 읽는다(field.tsx와 같은 방법). 평균이 절반 아래면 어두운 판이다. */
function readDark(host: HTMLElement): boolean {
  const probe = document.createElement("span");
  probe.style.color = "var(--cs-color-surface-base)";
  host.appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return false;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return ((px[0] ?? 0) + (px[1] ?? 0) + (px[2] ?? 0)) / 3 < 128;
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

/** 캔버스에 WebGL1 문맥과 프로그램을 세운다. 하나라도 실패하면 null(CSS 행성으로 간다). */
function createGfx(canvas: HTMLCanvasElement, size: number): Gfx | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (gl === null) return null;
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
  // 크기는 자원을 세우기 전에 정한다: 캔버스 크기를 바꾸면 그리기 상태가 바뀔 수 있다
  const px = backingPx(size);
  canvas.width = px;
  canvas.height = px;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  if (buf === null) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, px, px);
  return {
    gl,
    prog,
    buf,
    attr,
    px,
    center: gl.getUniformLocation(prog, "uCenter"),
    radius: gl.getUniformLocation(prog, "uR"),
    edge: gl.getUniformLocation(prog, "uEdge"),
    time: gl.getUniformLocation(prog, "uTime"),
    dark: gl.getUniformLocation(prog, "uDark"),
  };
}

interface CoreOrbProps {
  /** 코어 지름(화면 px, 배율 1) */
  size: number;
  selected: boolean;
  onSelect: () => void;
}

/** 가운데 구체와 그 단추. 단추는 지름 size의 원이고, 캔버스는 그 뒤에서 빛까지 그린다. */
export function CoreOrb({ size, selected, onSelect }: CoreOrbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 셰이더를 쓸 수 있나: 아니면 CSS 행성을 보인다
  const [live, setLive] = useState(true);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    // 안쪽 함수 선언은 좁혀진 타입을 물려받지 못하므로, 널이 아닌 상수로 잡아 둔다
    const el = canvas;
    const host = el.parentElement ?? document.body;
    let gfx: Gfx | null = createGfx(canvas, size);
    let dark = readDark(host);
    let raf = 0;
    let lastDraw = Number.NEGATIVE_INFINITY;
    const t0 = performance.now();
    setLive(gfx !== null);

    const motionQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    const schemeQ = window.matchMedia("(prefers-color-scheme: dark)");
    let dprQ: MediaQueryList | null = null;

    const draw = (now: number): void => {
      const g = gfx;
      if (g === null) return;
      const gl = g.gl;
      // 그릴 때마다 묶음을 다시 건다: 크기 바꿈이나 문맥 되찾기 뒤에도 같은 그림이 나온다
      gl.viewport(0, 0, g.px, g.px);
      gl.useProgram(g.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
      gl.enableVertexAttribArray(g.attr);
      gl.vertexAttribPointer(g.attr, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(g.center, g.px / 2, g.px / 2);
      gl.uniform1f(g.radius, g.px / (2 * BOX_SCALE));
      gl.uniform1f(g.edge, BOX_SCALE);
      gl.uniform1f(g.time, reducedMotion() ? STILL_T : (now - t0) / 1000);
      gl.uniform1f(g.dark, dark ? 1 : 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      lastDraw = now;
    };
    // 돌아가는 동안만 rAF를 건다: 탭이 숨겨지거나 움직임을 줄이면 멈춘다
    const loopOn = (): boolean => gfx !== null && !document.hidden && !reducedMotion();
    function sync(): void {
      if (loopOn()) {
        if (raf === 0) raf = requestAnimationFrame(frame);
      } else if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    function frame(now: number): void {
      raf = 0;
      if (now - lastDraw >= 1000 / IDLE_FPS - 2) draw(now);
      sync();
    }
    // 색·크기·움직임이 바뀌었을 때: 돌지 않으면 한 장을 다시 그린다
    function paint(): void {
      if (gfx !== null && !loopOn() && !document.hidden) draw(performance.now());
      sync();
    }
    function onScheme(): void {
      const d = readDark(host);
      if (d !== dark) {
        dark = d;
        paint();
      }
    }
    function watchDpr(): void {
      dprQ?.removeEventListener("change", onDpr);
      dprQ = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQ.addEventListener("change", onDpr);
    }
    function onDpr(): void {
      const g = gfx;
      if (g !== null) {
        const px = backingPx(size);
        if (px !== g.px) {
          g.px = px;
          el.width = px;
          el.height = px;
          g.gl.viewport(0, 0, px, px);
        }
      }
      watchDpr();
      paint();
    }
    function onLost(e: Event): void {
      e.preventDefault();
      gfx = null;
      setLive(false);
      sync();
    }
    function onRestored(): void {
      gfx = createGfx(el, size);
      setLive(gfx !== null);
      paint();
    }

    const mo = new MutationObserver(onScheme);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    motionQ.addEventListener("change", paint);
    schemeQ.addEventListener("change", onScheme);
    document.addEventListener("visibilitychange", paint);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    watchDpr();
    paint();

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      mo.disconnect();
      motionQ.removeEventListener("change", paint);
      schemeQ.removeEventListener("change", onScheme);
      dprQ?.removeEventListener("change", onDpr);
      document.removeEventListener("visibilitychange", paint);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      const g = gfx;
      gfx = null;
      if (g !== null) {
        g.gl.deleteBuffer(g.buf);
        g.gl.deleteProgram(g.prog);
      }
    };
  }, [size]);

  // 상자는 단추(확대에 따라 커지는 바깥 칸)의 비율로 잡는다: 확대해도 구체 중심이 고리 중심에서 어긋나지 않는다.
  const box = `${BOX_SCALE * 100}%`;
  const inset = `${-((BOX_SCALE - 1) / 2) * 100}%`;
  return (
    <>
      {!live && <span aria-hidden className="wb5-planet-glow absolute rounded-full" />}
      <button
        type="button"
        data-box="core"
        onClick={onSelect}
        aria-label={`${T.baseAgent} 보기`}
        aria-pressed={selected}
        className={`${live ? "wb5-core-hit" : "wb5-planet"} pointer-events-auto absolute inset-0 cursor-pointer rounded-full border-0 p-0 outline-none focus-visible:shadow-focus ${selected ? (live ? "wb5-core-on" : "wb5-planet-on") : ""}`}
      />
      <canvas
        ref={ref}
        aria-hidden
        className="wb5-core-canvas"
        style={{
          width: box,
          height: box,
          left: inset,
          top: inset,
          display: live ? undefined : "none",
        }}
      />
    </>
  );
}
