// 캔버스 전체 배경: 큰 유기체 블롭 네 개가 느린 리사주 궤도로 떠다니며 붙었다 떨어진다.
// 안쪽은 깊고, 빛은 가장자리에서 안쪽으로만 번진다. 빛의 색은 둘레를 따라 파랑 → 보라 → 자홍으로 흐른다.
// 밝은 판은 진주빛 몸통에 periwinkle → 진주 → 복숭아 가장자리를 둔다. 날 WebGL 조각 셰이더 하나(의존 없음).
// WebGL이 없거나 셰이더가 실패하면 onUnavailable로 CSS 그라디언트(.wb5-paper)로 돌아간다.
// 문맥을 잃으면 그 위에 같은 CSS 바탕을 덮어 빈 화면을 막고, 되살아나면 프로그램을 다시 짠다.
// 탭이 숨겨지면 멈추고, 움직임 줄이기를 켜면 한 장만 그린다.
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
/** 블롭 칸 수(셰이더가 읽는 상한). 블롭이 이보다 적으면 나머지 칸은 0으로 둔다. */
const N = 5;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform vec2 uPan;
uniform float uDark;
uniform vec3 uBase; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
// 블롭: (중심 x, 중심 y, 반지름 x, 반지름 y) / (회전, 색 위상, 0, 0). 단위는 캔버스 긴 변, 가운데가 0.
uniform vec4 uBlobA[5];
uniform vec4 uBlobB[5];

const float TAU = 6.2831853;
// 안쪽 빛의 폭, 가장자리 실선의 두께, 바깥 번짐(긴 변 단위)
const float RIM_W = 0.032;
const float LINE_W = 0.0018;
const float SPILL_W = 0.02;
// 두 윤곽이 붙기 시작하는 거리
const float SMIN_K = 0.1;
// 어두운 판: 빛 피크의 상한(선형 휘도). 위의 글자(#f2f2f2)와 4.5:1 이상을 지킨다.
const float CAP = 0.14;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// 타원까지의 거리(경계는 정확하고 바깥은 근사)
float sdEllipse(vec2 p, vec2 r){
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

// 다항 smooth-min: 두 거리장을 k 폭으로 잇는다
float smin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// 둘레 색환: 첫째 색 → 둘째 → 셋째 → 둘째 → 첫째. 셋째와 첫째를 바로 섞지 않아 회색이 생기지 않는다.
vec3 rimPal(float x){
  float f = fract(x) * 4.0;
  float s = fract(f);
  s = s * s * (3.0 - 2.0 * s);
  vec3 c = uA;
  vec3 e = uB;
  if (f >= 1.0) { c = uB; e = uC; }
  if (f >= 2.0) { c = uC; e = uB; }
  if (f >= 3.0) { c = uB; e = uA; }
  return mix(c, e, s);
}

// 두 겹 사인으로 샘플 점을 민다: 윤곽이 유기체처럼 흔들린다(느린 주기, 25초 이상)
vec2 warp(vec2 q, float t){
  return 0.040 * vec2(sin(q.y * 3.1 + 0.21 * t), cos(q.x * 2.7 - 0.17 * t))
       + 0.013 * vec2(sin(q.y * 7.3 - 0.23 * t + 1.2), cos(q.x * 6.1 + 0.19 * t + 0.5));
}

// 피크 휘도를 cap 아래로 부드럽게 누른다. 색의 비율은 그대로다.
vec3 capPeak(vec3 c, float cap){
  vec3 lin = pow(c, vec3(2.2));
  float y = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  float knee = 0.6 * cap;
  float yo = y;
  if (y > knee) yo = knee + (cap - knee) * (1.0 - exp(-(y - knee) / (cap - knee)));
  return c * pow(yo / max(y, 1e-6), 1.0 / 2.2);
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float S = max(uRes.x, uRes.y) / uDpr;
  float t = uTime;
  // 끌면 배경은 지도의 0.1배만 따라온다: 한 층 뒤에 있는 듯한 깊이
  vec2 q = (p - 0.5 * uRes / uDpr - 0.1 * uPan) / S;
  vec2 w = q + warp(q, t);

  float d = 1e3;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 ba = uBlobA[i];
    vec4 bb = uBlobB[i];
    // 반지름이 0인 빈 칸이면 그만둔다(블롭이 다섯보다 적을 때)
    if (ba.z <= 0.0) break;
    vec2 v = w - ba.xy;
    float cs = cos(bb.x);
    float sn = sin(bb.x);
    vec2 lp = vec2(cs * v.x + sn * v.y, cs * v.y - sn * v.x);
    float di = sdEllipse(lp, ba.zw);
    d = smin(d, di, SMIN_K);
    // 이 블롭 둘레의 각도로 색을 고르고, 시간에 따라 둘레를 따라 흐른다
    float ci = atan(lp.y, lp.x) / TAU + 0.02 * t + bb.y;
    // 가중치는 이 블롭 윤곽에 가까울수록 크다(안팎 모두)
    float ri = exp(-abs(di) / RIM_W);
    float wi = ri * ri;
    acc += rimPal(ci) * wi;
    wsum += wi;
  }

  float aa = 1.5 / S;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  // 안쪽으로만 번지는 빛: 바깥은 마스크로 0이 된다. 밝은 판은 빛이 더 깊이 번진다.
  float rw = mix(0.046, RIM_W, uDark);
  float rim = inside * exp(min(d, 0.0) / rw);
  float hair = exp(-abs(d) / LINE_W);
  // 바깥으로 아주 약하게 새는 빛(안에서는 0)
  float spill = (1.0 - inside) * exp(-max(d, 0.0) / SPILL_W);
  vec3 rc = (acc + uA * 1e-4) / (wsum + 1e-4);

  vec3 col = uBase;
  if (uDark > 0.5) {
    // 깊은 바탕: 속은 거의 검정, 빛은 가장자리에서만 안쪽으로 번진다
    col += inside * 0.006 * rc;
    col += rc * (0.7 * rim + 1.2 * hair + 0.08 * spill);
    col = capPeak(col, CAP);
  } else {
    // 밝은 바탕: 진주빛 몸통, 가장자리에 색이 스민다
    vec3 body = mix(uBase, vec3(1.0), 0.6);
    col = mix(uBase, body, inside * 0.85);
    col = mix(col, rc, rim * 0.7);
    col = mix(col, rc, hair * 0.8);
    col = mix(col, rc, spill * 0.2);
  }
  // 필름 결: 1/255 수준의 떨림(띠가 지지 않게)
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

type Rgb = [number, number, number];

interface Palette {
  dark: boolean;
  base: Rgb;
  a: Rgb;
  b: Rgb;
  c: Rgb;
}

/** 밝은 판(고정): 바탕, periwinkle, 진주, 복숭아 */
const LIGHT: Palette = {
  dark: false,
  base: [0.969, 0.965, 0.984],
  a: [0.557, 0.612, 0.941],
  b: [0.957, 0.945, 0.98],
  c: [0.965, 0.788, 0.706],
};
/** 어두운 판의 고정 점: 보라, 자홍. info 색을 이쪽으로 섞어 셋을 만든다. */
const VIOLET: Rgb = [0.49, 0.298, 1.0];
const MAGENTA: Rgb = [0.757, 0.235, 0.839];
/** 어두운 바탕: 거의 검정에 info 색을 조금 섞는다 */
const DARK_INK: Rgb = [0.008, 0.009, 0.02];

/** 블롭 하나. 위치와 반지름은 캔버스 긴 변 단위이고 가운데가 0이다. */
interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  ax: number;
  ay: number;
  wx: number;
  wy: number;
  px: number;
  py: number;
  hue: number;
}

/** 네 블롭. 각속도는 0.16~0.24rad/s라 한 바퀴가 26~39초다(짧은 것도 25초를 넘는다). 작은 것은 반지름 0.1 이상. */
const BLOBS: readonly Blob[] = [
  {
    x: 0.14,
    y: -0.06,
    rx: 0.25,
    ry: 0.2,
    rot: 0.5,
    ax: 0.12,
    ay: 0.09,
    wx: 0.21,
    wy: 0.17,
    px: 0,
    py: 1.3,
    hue: 0.1,
  },
  {
    x: -0.27,
    y: 0.0,
    rx: 0.18,
    ry: 0.23,
    rot: -0.3,
    ax: 0.09,
    ay: 0.11,
    wx: 0.19,
    wy: 0.23,
    px: 2.1,
    py: 0.4,
    hue: 0.4,
  },
  {
    x: 0.26,
    y: 0.23,
    rx: 0.2,
    ry: 0.13,
    rot: 0.6,
    ax: 0.12,
    ay: 0.07,
    wx: 0.16,
    wy: 0.24,
    px: 4.0,
    py: 2.2,
    hue: 0.7,
  },
  {
    x: -0.1,
    y: -0.24,
    rx: 0.12,
    ry: 0.11,
    rot: 0,
    ax: 0.1,
    ay: 0.07,
    wx: 0.24,
    wy: 0.2,
    px: 1.0,
    py: 5.0,
    hue: 0.2,
  },
];

/** t초의 블롭 상태를 uniform 배열 두 개에 채운다 */
function blobState(t: number, pos: Float32Array, shape: Float32Array): void {
  BLOBS.forEach((b, i) => {
    const br = 1 + 0.05 * Math.sin(0.19 * t + b.px);
    pos.set(
      [
        b.x + b.ax * Math.sin(b.wx * t + b.px),
        b.y + b.ay * Math.cos(b.wy * t + b.py),
        b.rx * br,
        b.ry * br,
      ],
      i * 4,
    );
    shape.set([b.rot + 0.3 * Math.sin(0.12 * t + b.py), b.hue, 0, 0], i * 4);
  });
}

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
    base: mixRgb(DARK_INK, info, 0.035),
    a: info,
    b: mixRgb(info, VIOLET, 0.55),
    c: mixRgb(info, MAGENTA, 0.7),
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
  dark: WebGLUniformLocation | null;
  base: WebGLUniformLocation | null;
  a: WebGLUniformLocation | null;
  b: WebGLUniformLocation | null;
  c: WebGLUniformLocation | null;
  blobA: WebGLUniformLocation | null;
  blobB: WebGLUniformLocation | null;
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
      dark: u("uDark"),
      base: u("uBase"),
      a: u("uA"),
      b: u("uB"),
      c: u("uC"),
      blobA: u("uBlobA"),
      blobB: u("uBlobB"),
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

    const blobA = new Float32Array(N * 4);
    const blobB = new Float32Array(N * 4);
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
      const sig = `${v.x.toFixed(1)}|${v.y.toFixed(1)}`;
      if (sig !== last) {
        last = sig;
        dirty = true;
      }
      // 만지는 중에는 매 프레임, 가만히 있을 때는 아주 천천히 흐르므로 초당 30번이면 충분하다. 움직임을 줄이면 바뀔 때만 그린다.
      if (!dirty && (motion === 0 || now - lastDraw < 1000 / IDLE_FPS - 2)) return;
      dirty = false;
      lastDraw = now;
      const t = ((now - t0) / 1000) * motion;
      blobState(t, blobA, blobB);
      gl.useProgram(g.prog);
      gl.uniform2f(g.u.res, canvas.width, canvas.height);
      gl.uniform1f(g.u.dpr, dpr);
      gl.uniform1f(g.u.time, t);
      gl.uniform2f(g.u.pan, v.x, v.y);
      gl.uniform1f(g.u.dark, pal.dark ? 1 : 0);
      gl.uniform3f(g.u.base, ...pal.base);
      gl.uniform3f(g.u.a, ...pal.a);
      gl.uniform3f(g.u.b, ...pal.b);
      gl.uniform3f(g.u.c, ...pal.c);
      gl.uniform4fv(g.u.blobA, blobA);
      gl.uniform4fv(g.u.blobB, blobB);
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
