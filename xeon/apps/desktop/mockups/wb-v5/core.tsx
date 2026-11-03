// 코어(기본 에이전트): 가운데 진주 구체. 조각 셰이더 하나가 구체 위의 얇은 시트 네 장과 바깥 초승달을 그린다.
// 시트마다 가장자리는 날카로운 가는 선이고, 안쪽 면은 그 선에서 빠르게 옅어진다. 바탕은 흰빛과 페리윙클이다.
// 캔버스는 구체보다 2.4배 넓어 빛이 잘리지 않는다. 단추는 구체와 같은 원으로 고르기·호버·초점을 맡는다.
// WebGL을 못 쓰거나 컨텍스트를 잃으면 CSS 행성(.wb5-planet)을 대신 보인다. 움직임을 줄이면 한 장만 그린다.
import { useLayoutEffect, useRef, useState } from "react";
import { T } from "../_shell/terms";
import { reducedMotion } from "./viewport";

/** 캔버스 한 변은 구체 지름의 2.4배: 바깥 빛이 캔버스 가장자리 안에서 0이 되도록 여유를 둔다 */
const BOX_SCALE = 2.4;
/** 확대 여유: 배율 1에서 이만큼 커져도 선명하도록 장치 해상도에 곱한다 */
const ZOOM_MAX = 1.5;
/** 긴 변 상한(성능) */
const MAX_PX = 1536;
/** 가만히 있을 때 초당 그리는 횟수 상한 */
const IDLE_FPS = 30;
/** 움직임을 줄일 때 찍는 한 장의 시각(초): 시트가 고르게 펼쳐 있는 때 */
const STILL_T = 6;

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

// 축을 y축 둘레로 θ만큼 돌린다: 시트가 깊이 방향으로 천천히 기운다
vec3 tilt(vec3 a, float th) {
  float c = cos(th);
  float s = sin(th);
  return vec3(c * a.x + s * a.z, a.y, c * a.z - s * a.x);
}

// 가장자리를 흔드는 낮은 주파수의 굽힘(d 단위). 천천히 흐른다.
float bend(vec3 n, float k, float T) {
  return 0.070 * sin(2.6 * n.x + 2.0 * n.y + 0.090 * T + k)
    + 0.035 * sin(1.7 * n.y - 3.4 * n.x - 0.070 * T + 2.1 * k);
}

// 빛 방향: 왼쪽 위, 앞
vec3 lightDir() {
  return normalize(vec3(-0.45, 0.60, 0.66));
}

// 시트 하나: 구면 위의 작은 원 d = dot(n, a) - c 의 한쪽 면.
// ln: 가장자리의 가는 빛 선(빛 쪽이 밝고 얇다). gw: 선 둘레로 퍼지는 빛. fl: 가장자리에서 안으로 옅어지는 면.
void sheet(vec3 n, vec3 a, float c, float k, float w, float T,
           out float ln, out float gw, out float fl) {
  float d = dot(n, a) - c + bend(n, k, T);
  float lit = smoothstep(-0.4, 0.9, dot(n, lightDir()));
  float wd = w * (0.6 + 0.7 * lit);
  ln = exp(-abs(d) / wd) * (0.35 + 0.65 * lit);
  gw = exp(-abs(d) / (wd * 6.0)) * lit;
  // 밝은 판은 면이 더 넓게 번져 가장자리에서 반지름의 3분의 1쯤까지 옅어진다
  float kf = mix(3.4, 6.0, uDark);
  fl = smoothstep(-wd, wd, d) * exp(-kf * max(d, 0.0));
}

// 밝기를 더하는 합성(스크린): 어두워지지 않고 흰색에 닿는다
vec3 screen(vec3 base, vec3 add) {
  return 1.0 - (1.0 - base) * (1.0 - clamp(add, 0.0, 1.0));
}

// 시트 하나를 얹는다. 어두운 판은 밝기를 더하고(스크린), 밝은 판은 옅은 하늘빛 막을 덮은 뒤 흰 선을 긋는다.
// f: 면, l: 가장자리 선, g: 복숭아 빛 번짐. kd, kl, kp: 어두운 판의 계수(밝은 판도 같은 세기로 쓴다).
vec3 putSheet(vec3 col, float f, float l, float g, float kd, float kl, float kp) {
  vec3 dk = screen(col, vec3(0.93, 0.95, 1.0) * f * kd + vec3(l * kl) + vec3(1.0, 0.84, 0.72) * g * kp);
  vec3 lt = mix(col, vec3(0.66, 0.73, 0.98), clamp(f * 0.6, 0.0, 0.36));
  lt = mix(lt, vec3(1.0, 0.86, 0.76), clamp(g * kp * 0.5, 0.0, 0.5));
  lt = mix(lt, vec3(1.0), clamp(l * kl, 0.0, 1.0));
  return mix(lt, dk, uDark);
}

void main() {
  vec2 dpx = gl_FragCoord.xy - uCenter;
  float rpx = length(dpx);
  vec2 s = dpx / uR;
  float r = length(s);
  float T = uTime;
  // 가장자리 선의 기본 폭: 장치 픽셀 1.6개 남짓
  float w = 1.6 / uR;
  float cov = clamp(uR - rpx + 0.5, 0.0, 1.0);
  vec3 L = lightDir();

  // 구체 밖: 큰 초승달 하나(가장자리 선이 따로 있다)와 빛 번짐
  vec2 cs = s - vec2(-0.08, 0.06);
  float dS = length(cs) - 1.05;
  float edS = exp(-abs(dS) / w);
  float inS = dS < 0.0 ? exp(dS * 6.0) : 0.0;
  float fadeS = 1.0 - smoothstep(1.13, 1.20, r);
  vec3 shC = mix(vec3(0.80, 0.84, 1.0), vec3(0.66, 0.72, 1.0), uDark);
  float shA = (edS * 0.55 + inS * 0.20) * fadeS * mix(0.7, 0.9, uDark);
  float g = exp(-max(r - 1.0, 0.0) * 2.8);
  float fadeH = 1.0 - smoothstep(uEdge * 0.72, uEdge, r);
  vec3 hC = mix(vec3(0.62, 0.68, 1.0), vec3(0.42, 0.46, 1.0), uDark);
  float hA = g * fadeH * mix(0.14, 0.34, uDark);
  vec3 rgbO = shC * shA + hC * hA * (1.0 - shA);
  float aO = shA + hA * (1.0 - shA);

  vec3 col = vec3(0.0);
  if (cov > 0.0) {
    vec3 N = vec3(s, sqrt(max(1.0 - dot(s, s), 0.0)));
    // 바탕: 위쪽은 밝은 라일락 흰색, 아래왼쪽으로 갈수록 페리윙클과 보랏빛 남색
    float bl = dot(N, normalize(vec3(-0.50, -0.62, 0.60)));
    // 어두운 판은 남색 유리 바탕. 밝은 판은 흰 진주 바탕에 아래왼쪽 가장자리의 페리윙클 웅덩이만 둔다.
    vec3 bD = mix(vec3(0.95, 0.96, 1.00), vec3(0.56, 0.61, 0.95), smoothstep(-0.15, 0.75, bl));
    bD = mix(bD, vec3(0.40, 0.44, 0.86), smoothstep(0.55, 0.98, bl) * 0.55);
    vec3 bL = mix(vec3(0.985, 0.988, 1.00), vec3(0.60, 0.66, 0.96), smoothstep(0.42, 0.98, bl) * 0.75);
    bL = mix(bL, vec3(0.46, 0.51, 0.89), smoothstep(0.75, 1.0, bl) * 0.45);
    col = mix(bL, bD, uDark);

    // 시트 네 장을 뒤에서 앞으로 빛으로 쌓는다. 축은 아주 천천히 기운다.
    float l1; float g1; float f1;
    float l2; float g2; float f2;
    float l3; float g3; float f3;
    float l4; float g4; float f4;
    sheet(N, tilt(normalize(vec3(-0.35, 0.62, 0.70)), 0.12 * sin(0.030 * T)), 0.30, 1.0, w, T, l1, g1, f1);
    sheet(N, tilt(normalize(vec3(-0.85, -0.10, 0.52)), 0.10 * sin(0.026 * T + 1.0)), 0.55, 2.0, w, T, l4, g4, f4);
    sheet(N, tilt(normalize(vec3(0.25, -0.72, 0.65)), 0.10 * sin(0.034 * T + 2.0)), 0.12, 3.0, w, T, l2, g2, f2);
    sheet(N, tilt(normalize(vec3(0.65, 0.35, 0.67)), 0.11 * sin(0.028 * T + 3.0)), 0.42, 4.0, w, T, l3, g3, f3);
    col = putSheet(col, f1, l1, 0.0, 0.42, 0.85, 0.0);
    col = putSheet(col, f4, l4, 0.0, 0.28, 0.55, 0.0);
    col = putSheet(col, f2, l2, g2, 0.46, 0.95, 0.55);
    col = putSheet(col, f3, l3, g3, 0.46, 0.95, 0.60);

    // 가장자리: 흰 림, 빛 쪽에 작고 부드러운 하이라이트, 밝은 판에서만 옅은 페리윙클 윤곽
    float fres = pow(1.0 - N.z, 2.4);
    col = mix(col, vec3(1.0), fres * 0.50);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    col += vec3(pow(max(dot(N, H), 0.0), 70.0) * 0.30);
    float rim = exp(-(1.0 - r) * uR / 1.8);
    col = mix(col, vec3(0.46, 0.52, 0.90), rim * 0.45 * (1.0 - uDark));
    col = min(col, vec3(1.0));
  }
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

/** 캔버스 한 변(장치 px): 장치 해상도 × 확대 여유, 긴 변은 상한 아래 */
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
  /** 배율 1에서의 지름(화면 px). 실제 지름은 부모가 확대에 맞춰 CSS로 정하고, 캔버스는 부모를 따른다. */
  size: number;
  selected: boolean;
  onSelect: () => void;
}

/** 가운데 구체와 그 단추. 부모 원의 지름이 구체 지름이고, 캔버스는 그 뒤에서 빛까지 그린다. */
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

  // 캔버스는 부모(구체 원)의 2.4배 정사각형이고, 가운데에 놓는다
  const canvasBox = {
    width: `${BOX_SCALE * 100}%`,
    height: `${BOX_SCALE * 100}%`,
    left: `${(-(BOX_SCALE - 1) / 2) * 100}%`,
    top: `${(-(BOX_SCALE - 1) / 2) * 100}%`,
  };
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
        style={{ ...canvasBox, display: live ? undefined : "none" }}
      />
    </>
  );
}
