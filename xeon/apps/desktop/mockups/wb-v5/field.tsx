// 캔버스 전체 배경: 아주 큰 원 네 개가 겹치고, 가장자리마다 안쪽으로 번지는 빛이 있다(테두리만 밝고 속은 깊다).
// 원은 느린 파도처럼 흔들린다. 날 WebGL 조각 셰이더 하나(의존 없음). 밝은 판은 따로 짠 연한 색, 어두운 판은 깊은 색이다.
// WebGL이 없으면 CSS 그라디언트(.wb5-paper)로 돌아가고, 탭이 숨겨지면 멈추며, 움직임 줄이기를 켜면 한 장만 그린다.
import { useEffect, useRef, type RefObject } from "react";
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
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform vec2 uPan; uniform float uMotion;
uniform float uDark;
uniform vec3 uBase; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// 원 하나: 안쪽으로 번지는 가장자리 빛(rim)과 속 채움(fill)
void disc(vec2 q, vec2 c, float r, float aa, float w, out float rim, out float fill){
  float d = length(q - c) - r;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  rim = exp(d / w) * inside;
  // 바깥쪽으로 아주 얇게 새는 빛
  rim += exp(-d / (aa * 6.0)) * (1.0 - inside) * 0.22;
  fill = inside;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float S = max(uRes.x, uRes.y) / uDpr;
  float t = uTime * uMotion;
  // 끌면 배경은 지도의 0.1배만 따라온다: 한 층 뒤에 있는 듯한 깊이
  vec2 q = (p - uPan * 0.1) / S;
  // 가장자리를 천천히 흔드는 파도
  q += 0.016 * vec2(sin(q.y * 5.2 + t * 0.21), cos(q.x * 4.4 + t * 0.17));
  q += 0.008 * vec2(sin(q.y * 11.0 - t * 0.13 + 1.3), cos(q.x * 9.0 + t * 0.11));

  float aa = 1.6 / S;
  float w = 0.085;
  vec3 col = uBase;
  float fillSum = 0.0;
  vec3 glowDark = vec3(0.0);
  vec3 glowLight = vec3(0.0);
  float glowMax = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c0 = vec2(0.08, 0.02);
    float r0 = 0.58;
    vec3 hue = uA;
    if (i == 1) { c0 = vec2(0.98, 0.84); r0 = 0.74; hue = uB; }
    if (i == 2) { c0 = vec2(0.0, 0.98); r0 = 0.44; hue = uC; }
    if (i == 3) { c0 = vec2(1.04, 0.0); r0 = 0.36; hue = uB; }
    vec2 c = c0 + 0.045 * vec2(sin(t * 0.063 * (1.0 + 0.27 * fi) + fi * 1.7), cos(t * 0.052 * (1.0 + 0.19 * fi) + fi * 2.3));
    float r = r0 * (1.0 + 0.035 * sin(t * 0.083 + fi * 1.1));
    float rim; float fill;
    disc(q, c, r, aa, w * (0.8 + 0.12 * fi), rim, fill);
    fillSum += fill;
    glowDark += hue * rim;
    glowLight = mix(glowLight, mix(vec3(1.0), hue, 0.6), clamp(rim * 0.6, 0.0, 1.0));
    glowMax = max(glowMax, rim);
  }
  if (uDark > 0.5) {
    // 깊은 바탕 위에 빛이 쌓인다: 겹친 곳은 더 밝다
    col = mix(col, col * 0.6 + uA * 0.05, clamp(fillSum, 0.0, 1.0) * 0.8);
    col += glowDark * 0.4;
  } else {
    // 밝은 바탕에서는 연한 색이 가장자리에 스며든다
    col = mix(col, mix(vec3(1.0), uA, 0.35), clamp(fillSum, 0.0, 1.0) * 0.02);
    col = mix(col, glowLight, clamp(glowMax, 0.0, 1.0) * 0.34);
  }
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

type Rgb = [number, number, number];

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

/** 측정용: 마지막 1초 동안 그린 횟수. 화면에는 쓰지 않는다. */
export const fieldStats = { draws: 0, since: 0, perSec: 0 };

export function Field({ view, onUnavailable }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    const vs = gl === null ? null : compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = gl === null ? null : compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl === null ? null : gl.createProgram();
    if (gl === null || vs === null || fs === null || prog === null) {
      onUnavailable();
      return undefined;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) {
      onUnavailable();
      return undefined;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, name);
    const U = {
      res: u("uRes"),
      dpr: u("uDpr"),
      time: u("uTime"),
      pan: u("uPan"),
      motion: u("uMotion"),
      dark: u("uDark"),
      base: u("uBase"),
      a: u("uA"),
      b: u("uB"),
      c: u("uC"),
    };

    let colors: { base: Rgb; a: Rgb; b: Rgb; c: Rgb; dark: boolean } = {
      base: [1, 1, 1],
      a: [0.4, 0.5, 0.95],
      b: [0.6, 0.45, 0.95],
      c: [0.2, 0.75, 0.7],
      dark: false,
    };
    const host = canvas.parentElement ?? document.body;
    const refreshColors = (): void => {
      const base = readColor(host, "--cs-color-surface-base", colors.base);
      const dark = (base[0] + base[1] + base[2]) / 3 < 0.5;
      const a = readColor(host, "--cs-color-info-graphic", colors.a);
      colors = {
        base,
        dark,
        // 어두운 판은 info 색에서 갈라진 이웃 색 둘(보랏빛, 청록빛): 서로 멀지 않아 한 가족으로 읽힌다.
        // 밝은 판은 따로 짠 연한 색이다: 흰 바탕에 스며드는 파랑, 보라, 하늘.
        a: dark ? a : [0.5, 0.62, 1.0],
        b: dark ? mixRgb(a, [0.62, 0.4, 0.96], 0.5) : [0.74, 0.56, 1.0],
        c: dark ? mixRgb(a, [0.2, 0.78, 0.9], 0.5) : [0.42, 0.84, 0.97],
      };
      dirty = true;
    };

    let dpr = 1;
    let dirty = true;
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
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
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform1f(U.time, (now - t0) / 1000);
      gl.uniform2f(U.pan, v.x, v.y);
      gl.uniform1f(U.motion, motion);
      gl.uniform1f(U.dark, colors.dark ? 1 : 0);
      gl.uniform3f(U.base, ...colors.base);
      gl.uniform3f(U.a, ...colors.a);
      gl.uniform3f(U.b, ...colors.b);
      gl.uniform3f(U.c, ...colors.c);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      fieldStats.draws += 1;
      if (now - fieldStats.since >= 1000) {
        fieldStats.perSec = (fieldStats.draws * 1000) / (now - fieldStats.since);
        fieldStats.draws = 0;
        fieldStats.since = now;
      }
    };
    const start = (): void => {
      if (raf === 0 && !document.hidden) raf = requestAnimationFrame(frame);
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
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", refreshColors);
      mo.disconnect();
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [view, onUnavailable]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full" />;
}
