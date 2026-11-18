// cvA 배경: 무채색 글로 라인 격자(잔 칸 24, 굵은 칸 120, 굵은 교차점의 + 눈금)와 아주 옅은 프레넬 테두리·커스틱 실선.
// 셰이더 한 장이지만 루프가 없다: 시점이 바뀔 때(끌기·확대), 크기·배율·테마가 바뀔 때만 한 장을 그린다. 멈춘 화면에서는 프레임을 그리지 않는다.
// 색은 caustic 토큰(바탕, 1차 글자, 에이전트 스펙트럼 둘)을 계산된 값으로 읽어 넣는다. WebGL이 없으면 같은 격자를 CSS로 그린다.
import { useOnViewportChange, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  buildQuadProgram,
  drawQuad,
  releaseQuadProgram,
  watchDevicePixelRatio,
  type QuadProgram,
} from "../../space-gl.ts";

// 셰이더 안 주석은 영어로 둔다(문자열 안의 한글은 화면 문구 검사에 걸린다)
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uDpr; uniform vec3 uView;
uniform vec3 uBg; uniform vec3 uInk; uniform vec3 uTintA; uniform vec3 uTintB; uniform float uDark;

float lineMask(float dist, float width) { return 1.0 - smoothstep(width * 0.5, width * 0.5 + 0.9, dist); }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 size = uRes / uDpr;
  float k = uView.z;
  vec2 flow = (frag - uView.xy) / k;
  // grid: width from screen px distance (1px at any zoom)
  vec2 dMin = abs(fract(flow / 24.0 + 0.5) - 0.5) * 24.0 * k;
  vec2 dMaj = abs(fract(flow / 120.0 + 0.5) - 0.5) * 120.0 * k;
  float minor = lineMask(min(dMin.x, dMin.y), 1.0) * smoothstep(0.45, 0.85, k);
  float dm = min(dMaj.x, dMaj.y);
  float major = lineMask(dm, 1.0);
  float glow = exp(-dm / 6.0);
  float cross = step(max(dMaj.x, dMaj.y), 5.0) * lineMask(dm, 1.2);
  // fresnel rim: a lens that brightens slightly toward the edge
  vec2 c = (frag / size - 0.5) * vec2(size.x / size.y, 1.0);
  float rim = smoothstep(0.42, 1.05, length(c));
  // caustic filaments: contour of two loose waves; follows 1/4 of the view for depth
  vec2 q = (frag - uView.xy * 0.25) / 300.0;
  float w = sin(q.x * 1.7 + sin(q.y * 1.3) * 1.7) + sin(q.y * 1.9 + sin(q.x * 1.1) * 1.5) + 0.6 * sin((q.x + q.y) * 2.3);
  float fil = pow(1.0 - abs(sin(w * 1.55)), 18.0);
  float s = uDark > 0.5 ? 1.0 : 0.8;
  vec3 col = uBg;
  col = mix(col, uInk, s * (minor * 0.016 + major * 0.04 + glow * 0.018 + cross * 0.09));
  vec3 tint = mix(uTintA, uTintB, clamp(frag.x / size.x * 0.8 + frag.y / size.y * 0.2, 0.0, 1.0));
  col = mix(col, tint, fil * 0.045 + rim * 0.035);
  col = mix(col, uInk, rim * 0.018 * s);
  gl_FragColor = vec4(col, 1.0);
}
`;

type Rgb = readonly [number, number, number];

/** 토큰 값(oklch 등 무엇이든)을 2D 캔버스로 sRGB 0..1로 바꾼다 */
function readColors(el: Element): { bg: Rgb; ink: Rgb; a: Rgb; b: Rgb } | null {
  const style = getComputedStyle(el);
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return null;
  const rgb = (name: string, fallback: string): Rgb => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    const value = style.getPropertyValue(name).trim();
    if (value !== "") ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [(d[0] ?? 0) / 255, (d[1] ?? 0) / 255, (d[2] ?? 0) / 255];
  };
  return {
    bg: rgb("--cs-color-bg-canvas", "#0b0b0c"),
    ink: rgb("--cs-color-text-primary", "#f2f2f2"),
    a: rgb("--cs-color-agent-stop-1", "#4fb3c9"),
    b: rgb("--cs-color-agent-stop-2", "#7fd1a8"),
  };
}

const CONTEXT: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

/** 그린 장 수(측정용). 창 전역에 둔다: 멈춘 화면에서 늘지 않음을 시험·측정이 본다 */
function countFrame(el: HTMLCanvasElement): void {
  const n = Number(el.dataset["frames"] ?? "0") + 1;
  el.dataset["frames"] = String(n);
}

export function Backdrop(props: { readonly theme: "dark" | "light" }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progRef = useRef<QuadProgram | null>(null);
  const colorsRef = useRef<ReturnType<typeof readColors>>(null);
  const pending = useRef(0);
  const rf = useReactFlow();
  const [gl, setGl] = useState<"pending" | "on" | "off">("pending");

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    const prog = progRef.current;
    const colors = colorsRef.current;
    if (canvas === null || prog === null || colors === null) return;
    const { x, y, zoom: k } = rf.getViewport();
    const ratio = Math.min(window.devicePixelRatio, 1.5);
    drawQuad(prog, (loc) => {
      const g = prog.gl;
      g.viewport(0, 0, canvas.width, canvas.height);
      g.uniform2f(loc("uRes"), canvas.width, canvas.height);
      g.uniform1f(loc("uDpr"), ratio);
      g.uniform3f(loc("uView"), x, y, k);
      g.uniform3f(loc("uBg"), ...colors.bg);
      g.uniform3f(loc("uInk"), ...colors.ink);
      g.uniform3f(loc("uTintA"), ...colors.a);
      g.uniform3f(loc("uTintB"), ...colors.b);
      g.uniform1f(loc("uDark"), props.theme === "dark" ? 1 : 0);
    });
    countFrame(canvas);
  }, [rf, props.theme]);

  /** 한 프레임에 한 번만 그린다(끄는 동안 여러 번 바뀌어도) */
  const request = useCallback((): void => {
    if (pending.current !== 0) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = 0;
      draw();
    });
  }, [draw]);

  useOnViewportChange({ onChange: request });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const context = canvas.getContext("webgl", CONTEXT);
    const prog = context === null ? null : buildQuadProgram(context, FRAG);
    progRef.current = prog;
    setGl(prog === null ? "off" : "on");
    return () => {
      if (prog !== null) releaseQuadProgram(prog);
      progRef.current = null;
      cancelAnimationFrame(pending.current);
      pending.current = 0;
    };
  }, []);

  // 테마가 바뀌면(`draw`·`request`가 테마를 따라 바뀐다) 색을 다시 읽고, 크기·배율이 바뀌면 캔버스 픽셀을 맞춘 뒤 한 장 그린다
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || gl !== "on") return undefined;
    colorsRef.current = readColors(canvas);
    const fit = (): void => {
      const ratio = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      request();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    const stop = watchDevicePixelRatio(fit);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [gl, request]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-bg-canvas">
      {gl === "off" ? (
        <div className="absolute inset-0 bg-[linear-gradient(color-mix(in_oklab,var(--cs-color-text-primary)_6%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklab,var(--cs-color-text-primary)_6%,transparent)_1px,transparent_1px)] bg-size-[120px_120px]" />
      ) : null}
      <canvas ref={canvasRef} data-cva-backdrop className="absolute inset-0 size-full" />
    </div>
  );
}
