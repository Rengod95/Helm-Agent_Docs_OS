// cvC 캔버스 배경: 무채색의 은은한 글로 선 격자와 아주 연한 프레넬 테두리·커스틱 결(셰이더 한 장).
// 쉬는 동안 그리지 않는다: 시점(이동·확대), 크기, 테마, 초점(고른 장·끄는 장)이 바뀔 때만 다음 프레임 하나를 그린다(루프 없음).
// 초점 둘레의 격자가 조금 밝아진다(고르기·끌기의 반응). WebGL이 없으면 같은 격자를 CSS 그라디언트로 그린다. 장식이라 보조 기술에서 숨긴다.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cssZoomOf } from "../../../../lib/zoom.ts";
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

/** 격자 한 칸(세계 px). 굵은 선은 네 칸마다 */
const CELL = 24;

// 셰이더 안: 커스틱 결(시점을 반만 따라오는 느린 사인 겹, 시간 없음), 프레넬 테두리(가장자리로 빛이 모이고 아주 옅게 세 빛으로 갈림)
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform vec2 u_off;
uniform float u_cell;
uniform float u_dpr;
uniform float u_dark;
uniform vec3 u_focus;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 p = frag - u_off;
  vec2 dm = abs(mod(p + 0.5 * u_cell, u_cell) - 0.5 * u_cell);
  float dMinor = min(dm.x, dm.y);
  float major = u_cell * 4.0;
  vec2 dM = abs(mod(p + 0.5 * major, major) - 0.5 * major);
  float dMajor = min(dM.x, dM.y);
  float hw = 0.5 * u_dpr;
  float core = 1.0 - smoothstep(hw * 0.3, hw * 1.7, dMinor);
  float coreM = 1.0 - smoothstep(hw * 0.3, hw * 1.9, dMajor);
  float glowM = exp(-dMajor / (6.0 * u_dpr));
  float minorVis = smoothstep(7.0 * u_dpr, 16.0 * u_dpr, u_cell);
  vec2 uv = frag / u_res;
  float vig = smoothstep(1.2, 0.2, length((uv - 0.5) * vec2(1.2, 1.0)));
  float fd = length(frag - u_focus.xy) / (240.0 * u_dpr);
  float focus = u_focus.z * exp(-fd * fd);
  float strength = mix(0.72, 1.0, u_dark);
  float a = (core * 0.026 * minorVis + coreM * 0.04 + glowM * 0.022) * (0.45 + 0.55 * vig) * (1.0 + 1.1 * focus) * strength;
  // caustic filaments: slow sine layers, half parallax, no time (static)
  vec2 q = (frag - u_off * 0.35) / u_res.y * 2.6;
  vec2 w = q + 0.4 * vec2(sin(q.y * 1.7 + 1.3), sin(q.x * 1.3 + 0.7));
  float c = abs(sin(w.x * 2.1 + sin(w.y * 1.6)) * sin(w.y * 1.9 + sin(w.x * 1.2)));
  float fil = pow(1.0 - c, 16.0);
  // fresnel rim: light gathers toward the edge with a faint three-way spectral split
  float r = length((uv - 0.5) * 2.0);
  float rim = pow(clamp(r * 0.72, 0.0, 1.0), 3.2);
  float ang = atan(uv.y - 0.5, uv.x - 0.5);
  vec3 spec = 0.5 + 0.5 * cos(ang + vec3(3.6, 2.2, 0.9));
  vec3 ink = vec3(u_dark);
  float aField = (fil * 0.02 * (0.35 + 0.65 * vig) + rim * 0.028) * strength;
  vec3 tint = mix(ink, spec, mix(0.5, 0.3, u_dark));
  gl_FragColor = vec4(ink * a + tint * aField, a + aField);
}
`;

/** CSS 대체: 같은 격자를 그라디언트 둘로(가는 선 24px, 굵은 선 96px). 테마 토큰의 경계 색을 쓴다 */
function fallbackStyle(view: View): CSSProperties {
  const minor = CELL * view.k;
  const major = minor * 4;
  const line = "color-mix(in oklab, var(--cs-color-border-subtle) 55%, transparent)";
  const strong = "color-mix(in oklab, var(--cs-color-border-default) 60%, transparent)";
  return {
    backgroundImage: [
      `linear-gradient(to right, ${strong} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${strong} 1px, transparent 1px)`,
      `linear-gradient(to right, ${line} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    ].join(","),
    backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
}

export interface GlowGridProps {
  readonly view: View;
  readonly dark: boolean;
  /** 캔버스 안 CSS px 자리. 없으면 초점 빛이 없다 */
  readonly focus: { readonly x: number; readonly y: number; readonly strength: number } | null;
}

export function GlowGrid(props: GlowGridProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progRef = useRef<QuadProgram | null>(null);
  const drawsRef = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [gl, setGl] = useState<"pending" | "ok" | "none">("pending");

  // 문맥과 프로그램: 한 번 세운다. 잃으면 CSS 대체로 간다
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const ctx = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    const prog = ctx === null ? null : buildQuadProgram(ctx, FRAG);
    progRef.current = prog;
    setGl(prog === null ? "none" : "ok");
    const onLost = (e: Event): void => {
      e.preventDefault();
      progRef.current = null;
      setGl("none");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      if (prog !== null) releaseQuadProgram(prog);
      progRef.current = null;
    };
  }, []);

  // 크기: 부모를 따른다(CSS px)
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (parent === null || parent === undefined) return undefined;
    const ro = new ResizeObserver(() => {
      setSize({ w: parent.clientWidth, h: parent.clientHeight });
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const { view, dark, focus } = props;
  const fx = focus?.x ?? -1e4;
  const fy = focus?.y ?? -1e4;
  const fs = focus?.strength ?? 0;

  // 입력이 바뀔 때만 다음 프레임 하나를 그린다(그 사이에 또 바뀌면 앞의 것을 거두고 새로 건다)
  const { w: cw, h: ch } = size;
  const { x: vx, y: vy, k: vk } = view;
  useEffect(() => {
    if (gl !== "ok") return undefined;
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      const prog = progRef.current;
      if (canvas === null || prog === null || cw === 0) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1) * cssZoomOf(canvas);
      const w = Math.round(cw * ratio);
      const h = Math.round(ch * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = prog.gl;
      ctx.viewport(0, 0, w, h);
      ctx.clearColor(0, 0, 0, 0);
      ctx.clear(ctx.COLOR_BUFFER_BIT);
      drawQuad(prog, (loc) => {
        ctx.uniform2f(loc("u_res"), w, h);
        ctx.uniform2f(loc("u_off"), vx * ratio, vy * ratio);
        ctx.uniform1f(loc("u_cell"), CELL * vk * ratio);
        ctx.uniform1f(loc("u_dpr"), ratio);
        ctx.uniform1f(loc("u_dark"), dark ? 1 : 0);
        ctx.uniform3f(loc("u_focus"), fx * ratio, fy * ratio, fs);
      });
      drawsRef.current += 1;
      canvas.dataset["draws"] = String(drawsRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [gl, cw, ch, vx, vy, vk, dark, fx, fy, fs]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {gl === "none" && <div className="absolute inset-0" style={fallbackStyle(view)} />}
      <canvas
        ref={canvasRef}
        data-cvc-grid=""
        className="absolute inset-0 size-full"
        style={{ display: gl === "none" ? "none" : "block" }}
      />
    </div>
  );
}
