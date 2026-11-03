// 캔버스 배경: 깊은 우주 셰이더 한 장(의존 없음). WebGL이 없거나 문맥을 잃으면 같은 바탕의 CSS 그라디언트가 남는다.
// 장식이라 보조 기술에서 숨긴다. 시점(k, x, y)은 매 프레임 ref로 읽어 React를 다시 그리지 않는다.
import { dprFor, renderMode, type View } from "@fresnel/client/workbench/canvas";
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import {
  buildQuadProgram,
  drawQuad,
  releaseQuadProgram,
  watchDevicePixelRatio,
  type GlSupport,
  type QuadProgram,
} from "./space-gl.ts";
import { BACKGROUND_FRAG, backgroundFrame, viewKey } from "./space-math.ts";
import { useFrameLoop, type FrameDraw } from "./use-frame-loop.ts";

export interface SpaceBackgroundProps {
  /** 지도 시점. 셰이더가 매 프레임 읽어 패럴랙스를 만든다 */
  readonly view: RefObject<View>;
  readonly theme: "dark" | "light";
}

// CSS 대체: 캔버스가 없을 때 같은 바탕을 캐릭터 토큰으로 그린다(색 값은 토큰 변수가 가진다).
const LIGHT_PAPER =
  "bg-bg-app bg-[radial-gradient(ellipse_62%_50%_at_22%_32%,color-mix(in_oklab,var(--cs-color-agent-stop-2)_14%,transparent),transparent_100%),radial-gradient(ellipse_54%_46%_at_82%_72%,color-mix(in_oklab,var(--cs-color-agent-stop-3)_22%,transparent),transparent_100%)]";
const DARK_PAPER =
  "bg-bg-canvas bg-[radial-gradient(ellipse_62%_50%_at_22%_32%,color-mix(in_oklab,var(--cs-color-info-graphic)_9%,transparent),transparent_100%),radial-gradient(ellipse_54%_46%_at_82%_72%,color-mix(in_oklab,var(--cs-color-agent-stop-2)_7%,transparent),transparent_100%),radial-gradient(ellipse_46%_40%_at_58%_8%,color-mix(in_oklab,var(--cs-color-agent-stop-2)_6%,transparent),transparent_100%)]";

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

export function SpaceBackground({ view, theme }: SpaceBackgroundProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const progRef = useRef<QuadProgram | null>(null);
  const ratioRef = useRef(1);
  const startRef = useRef<number | null>(null);
  const [support, setSupport] = useState<GlSupport>("pending");

  // 프로그램을 (다시) 짠다. 문맥이 되살아난 뒤에도 같은 자리에서 부른다.
  const setup = useCallback((): void => {
    const gl = glRef.current;
    const next = gl === null ? null : buildQuadProgram(gl, BACKGROUND_FRAG);
    progRef.current = next;
    setSupport(next === null ? "none" : "shader");
  }, []);

  const draw: FrameDraw = (now, still) => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const prog = progRef.current;
    if (canvas === null || gl === null || prog === null) return;
    const start = startRef.current ?? now;
    startRef.current = start;
    const f = backgroundFrame(
      view.current,
      [canvas.width, canvas.height],
      ratioRef.current,
      (now - start) / 1000,
      still,
      theme === "dark",
    );
    drawQuad(prog, (loc) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(loc("uRes"), f.res[0], f.res[1]);
      gl.uniform1f(loc("uDpr"), f.ratio);
      gl.uniform1f(loc("uTime"), f.time);
      gl.uniform2f(loc("uPan"), f.pan[0], f.pan[1]);
      gl.uniform1f(loc("uK"), f.k);
      gl.uniform1f(loc("uDark"), f.dark);
      gl.uniform2f(loc("uCore"), f.core[0], f.core[1]);
    });
  };

  // 가만히 있으면 30fps, 지도가 움직이는 동안은 틱마다(watch가 바뀌면 바로 그린다)
  const { contextLost, reducedMotion, redraw } = useFrameLoop(draw, {
    canvas: canvasRef,
    mode: "idle",
    enabled: support === "shader",
    onRestored: setup,
    watch: () => viewKey(view.current),
    paint: theme,
  });

  // 문맥과 프로그램: 마운트마다 짝을 맞춰 붙이고 뗀다(StrictMode의 두 번 마운트에도 안전하다)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    glRef.current = canvas.getContext("webgl", CONTEXT_OPTIONS);
    setup();
    return () => {
      const prog = progRef.current;
      if (prog !== null) releaseQuadProgram(prog);
      progRef.current = null;
      glRef.current = null;
    };
  }, [setup]);

  // 캔버스 픽셀 크기 = CSS 크기 × 배율(상한 1.25배). 크기나 배율이 바뀌면 다시 그린다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const fit = (): void => {
      const ratio = dprFor(window.devicePixelRatio, "background");
      ratioRef.current = ratio;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      redraw();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    const stopDpr = watchDevicePixelRatio(fit);
    return () => {
      observer.disconnect();
      stopDpr();
    };
  }, [redraw]);

  const mode = renderMode(support !== "none", contextLost, reducedMotion);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className={`absolute inset-0 ${theme === "dark" ? DARK_PAPER : LIGHT_PAPER}`} />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 size-full ${mode === "css-fallback" ? "hidden" : ""}`}
      />
    </div>
  );
}
