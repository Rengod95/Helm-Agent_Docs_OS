// cvD 배경: 무채색 글로 격자(캔버스와 함께 움직임) + 아주 옅은 크리스탈 굴절 셰이더 한 장(화면에 고정, 살짝 시차).
// 셰이더는 시간 값이 없는 정지 그림이다. 크기·판·시점이 바뀔 때만 한 장 다시 그리고, 가만히 있으면 프레임을 그리지 않는다.
// 움직임 줄이기에서는 시차도 끈다(시점이 바뀌어도 셰이더는 그대로다). WebGL이 없으면 격자만 남는다.
import { useEffect, useRef, type ReactElement } from "react";
import {
  buildQuadProgram,
  drawQuad,
  releaseQuadProgram,
  type QuadProgram,
} from "../../space-gl.ts";

export interface View {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform vec2 uOff;
uniform float uDark;
uniform float uDpr;

// one static caustic layer (no time input)
float caustic(vec2 uv) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.0065;
  for (int n = 0; n < 4; n++) {
    float t = 0.42 * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 9.0), 0.0, 1.0);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 px = gl_FragCoord.xy / uDpr;
  vec2 uv = (px + uOff) / 1100.0;
  float net = caustic(uv) * 0.75 + caustic(uv * 1.9 + 3.1) * 0.25;
  // fresnel rim: very slightly brighter toward the edges
  vec2 q = px / (uRes / uDpr);
  vec2 e = min(q, 1.0 - q);
  float rim = pow(1.0 - clamp(min(e.x, e.y) * 5.0, 0.0, 1.0), 2.4);
  // one wide diagonal reflection band from the top left
  float band = exp(-pow((q.x * 0.8 - (1.0 - q.y) * 0.55 - 0.08) * 3.2, 2.0));
  float a = net * 0.030 + rim * 0.022 + band * 0.018;
  a *= mix(0.85, 1.0, uDark);
  a += (hash(px) - 0.5) / 255.0;
  float ink = uDark;
  gl_FragColor = vec4(vec3(ink) * max(a, 0.0), max(a, 0.0));
}
`;

const OPTIONS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Painter {
  canvas: HTMLCanvasElement | null;
  prog: QuadProgram | null;
  pending: number | null;
  view: View;
  theme: "dark" | "light";
}

function paint(s: Painter): void {
  s.pending = null;
  const { canvas, prog } = s;
  if (canvas === null || prog === null) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const still = reducedMotion();
  const { gl } = prog;
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawQuad(prog, (loc) => {
    gl.uniform2f(loc("uRes"), w, h);
    gl.uniform2f(loc("uOff"), still ? 0 : -s.view.x * 0.12, still ? 0 : s.view.y * 0.12);
    gl.uniform1f(loc("uDark"), s.theme === "dark" ? 1 : 0);
    gl.uniform1f(loc("uDpr"), dpr);
  });
}

/** 다음 프레임에 한 장. 이미 걸려 있으면 더 걸지 않는다 */
function requestPaint(s: Painter): void {
  if (s.pending === null) s.pending = requestAnimationFrame(() => paint(s));
}

export function Backdrop(props: {
  readonly view: View;
  readonly theme: "dark" | "light";
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 그리는 쪽의 상태(문맥, 걸린 프레임, 마지막 시점). 렌더가 아니라 효과와 프레임 콜백만 만진다
  const painterRef = useRef<Painter>({
    canvas: null,
    prog: null,
    pending: null,
    view: props.view,
    theme: props.theme,
  });

  useEffect(() => {
    const painter = painterRef.current;
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const gl = canvas.getContext("webgl", OPTIONS);
    if (gl === null) return undefined;
    painter.canvas = canvas;
    painter.prog = buildQuadProgram(gl, FRAG);
    const ro = new ResizeObserver(() => requestPaint(painter));
    ro.observe(canvas);
    requestPaint(painter);
    return () => {
      ro.disconnect();
      if (painter.pending !== null) cancelAnimationFrame(painter.pending);
      painter.pending = null;
      if (painter.prog !== null) releaseQuadProgram(painter.prog);
      painter.prog = null;
      painter.canvas = null;
    };
  }, []);

  useEffect(() => {
    const painter = painterRef.current;
    painter.view = props.view;
    painter.theme = props.theme;
    requestPaint(painter);
  }, [props.view, props.theme]);

  const { k, x, y } = props.view;
  const minor = 16 * k;
  const major = 128 * k;
  // 밝은 판은 같은 선이 더 진하게 읽혀서 덜 섞는다
  const a = props.theme === "dark" ? 1 : 0.62;
  const ink = (pct: number): string =>
    `color-mix(in oklab, var(--cs-color-text-primary) ${String(pct * a)}%, transparent)`;
  const line = ink(2.4);
  const strong = ink(4.6);
  const glow = ink(1.8);
  const grid = {
    backgroundImage: [
      `linear-gradient(to right, ${strong} 0, ${strong} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${strong} 0, ${strong} 1px, transparent 1px)`,
      `linear-gradient(to right, ${glow} 0, transparent 4px, transparent calc(100% - 4px), ${glow} 100%)`,
      `linear-gradient(to bottom, ${glow} 0, transparent 4px, transparent calc(100% - 4px), ${glow} 100%)`,
      `linear-gradient(to right, ${line} 0, ${line} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${line} 0, ${line} 1px, transparent 1px)`,
    ].join(","),
    backgroundSize: [major, major, major, major, minor, minor]
      .map((s) => `${s}px ${s}px`)
      .join(","),
    backgroundPosition: [0, 0, 0, 0, 0, 0].map(() => `${x}px ${y}px`).join(","),
  };
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-bg-canvas"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0" style={k < 0.45 ? {} : grid} />
    </div>
  );
}
