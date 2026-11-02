// 지도 뒤의 배경: 점 밭과 가운데 코어의 옅은 빛. 고른 점 둘레는 조금 밝아지고, 밭은 아주 천천히 흐른다.
// 날 WebGL 조각 셰이더 하나(의존 없음). WebGL이 없으면 CSS 점 종이로 돌아가고(.wb5-paper), 탭이 숨겨지면 멈춘다.
import { useEffect, useRef, type RefObject } from "react";
import { reducedMotion, type View } from "./viewport";

export interface LitPoint {
  /** 세계 좌표 */
  x: number;
  y: number;
  s: number;
}
interface Props {
  view: RefObject<View>;
  /** 코어(세계 좌표)와 바깥 고리 반지름 */
  core: { x: number; y: number; r: number };
  lit: readonly LitPoint[];
  onUnavailable: () => void;
}

const MAX_LIT = 8;
const DPR_CAP = 1.5;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform vec2 uPan;
uniform vec2 uCore; uniform float uRadius; uniform float uMotion;
uniform vec3 uBg; uniform vec3 uDot; uniform vec3 uGlow;
uniform vec3 uNodes[${MAX_LIT}]; uniform float uCount;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float sp = 22.0;
  // 끌면 점 밭은 지도의 0.3배만 따라온다: 한 층 뒤에 있는 듯한 깊이
  vec2 q = p - uPan * 0.3;
  vec2 id = floor(q / sp);
  float d = length(fract(q / sp) - 0.5) * sp;
  float r = 0.8 + 0.35 * hash(id);
  float dotv = smoothstep(r + 0.6, r - 0.1, d);
  float t = uTime * uMotion;
  float n = vnoise(q * 0.006 + vec2(t * 0.02, -t * 0.013));
  float dc = length(p - uCore);
  float cr = dc / (uRadius * 0.85);
  float core = exp(-cr * cr);
  float lit = 0.0;
  for (int i = 0; i < ${MAX_LIT}; i++) {
    if (float(i) >= uCount) break;
    vec3 nd = uNodes[i];
    vec2 dn = (p - nd.xy) / 84.0;
    lit += nd.z * exp(-dot(dn, dn));
  }
  lit = min(lit, 1.4);
  float vr = dc / (uRadius * 1.6);
  float vign = 0.4 + 0.6 * exp(-vr * vr);
  float a = dotv * (0.26 + 0.2 * n) * vign + dotv * lit * 0.45;
  vec3 col = mix(uBg, uGlow, core * 0.11 + lit * 0.045);
  col = mix(col, uDot, clamp(a, 0.0, 1.0));
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

export function Field({ view, core, lit, onUnavailable }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 그릴 때마다 읽는 값은 ref로 둔다: 렌더가 다시 돌아도 루프를 새로 시작하지 않는다.
  const live = useRef({ core, lit });
  live.current = { core, lit };

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
      core: u("uCore"),
      radius: u("uRadius"),
      motion: u("uMotion"),
      bg: u("uBg"),
      dot: u("uDot"),
      glow: u("uGlow"),
      nodes: u("uNodes[0]"),
      count: u("uCount"),
    };

    let colors: { bg: Rgb; dot: Rgb; glow: Rgb } = {
      bg: [1, 1, 1],
      dot: [0.6, 0.6, 0.6],
      glow: [0.3, 0.4, 0.9],
    };
    const host = canvas.parentElement ?? document.body;
    const refreshColors = (): void => {
      colors = {
        bg: readColor(host, "--cs-color-surface-base", colors.bg),
        dot: readColor(host, "--cs-color-text-tertiary", colors.dot),
        glow: readColor(host, "--cs-color-info-graphic", colors.glow),
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

    const nodes = new Float32Array(MAX_LIT * 3);
    let last = "";
    let raf = 0;
    let lastDraw = 0;
    let lastMove = 0;
    const t0 = performance.now();

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const v = view.current;
      const { core: c, lit: points } = live.current;
      const motion = reducedMotion() ? 0 : 1;
      const sig = `${v.k.toFixed(4)}|${v.x.toFixed(1)}|${v.y.toFixed(1)}|${points.map((p) => `${p.x},${p.y},${p.s}`).join(";")}`;
      if (sig !== last) {
        last = sig;
        dirty = true;
        lastMove = now;
      }
      // 만지는 중에는 매 프레임, 가만히 있을 때는 아주 천천히 흐르므로 초당 10번이면 충분하다. 움직임을 줄이면 바뀔 때만 그린다.
      const idle = now - lastMove > 1500;
      if (!dirty && (motion === 0 || (idle && now - lastDraw < 100))) return;
      dirty = false;
      lastDraw = now;
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform1f(U.time, (now - t0) / 1000);
      gl.uniform2f(U.pan, v.x, v.y);
      gl.uniform2f(U.core, v.x + c.x * v.k, v.y + c.y * v.k);
      gl.uniform1f(U.radius, c.r * v.k);
      gl.uniform1f(U.motion, motion);
      gl.uniform3f(U.bg, ...colors.bg);
      gl.uniform3f(U.dot, ...colors.dot);
      gl.uniform3f(U.glow, ...colors.glow);
      const n = Math.min(points.length, MAX_LIT);
      nodes.fill(0);
      for (let i = 0; i < n; i++) {
        const p = points[i];
        if (p === undefined) continue;
        nodes[i * 3] = v.x + p.x * v.k;
        nodes[i * 3 + 1] = v.y + p.y * v.k;
        nodes[i * 3 + 2] = p.s;
      }
      gl.uniform3fv(U.nodes, nodes);
      gl.uniform1f(U.count, n);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
