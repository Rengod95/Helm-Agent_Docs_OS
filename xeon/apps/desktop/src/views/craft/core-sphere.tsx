// 가운데 구체: 진주빛 유리 구체 셰이더 한 장. 배경과 따로 기기 배율의 1.3배로 그린다.
// 위치는 부모가 CSS로 잡는다(지도의 --k --tx --ty를 그대로 따르므로 여기서 이동을 다시 계산하지 않는다).
// WebGL이 없거나 문맥을 잃으면 CSS 행성을 보인다. 장식이라 보조 기술에서 숨긴다.
import { coreCanvasSize, renderMode } from "@fresnel/client/workbench/canvas";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  buildQuadProgram,
  drawQuad,
  releaseQuadProgram,
  watchDevicePixelRatio,
  type GlSupport,
  type QuadProgram,
} from "./space-gl.ts";
import {
  CORE_BOX_SCALE,
  CORE_FRAG,
  coreFrame,
  frameDtSeconds,
  initialCoreMotion,
  stepCore,
  type CoreMotion,
} from "./space-math.ts";
import { useFrameLoop, type FrameDraw } from "./use-frame-loop.ts";

export interface CoreSphereProps {
  /** 목표 에너지 0..1. 바뀌면 0.4초 안에 옮겨 간다 */
  readonly energy: number;
  /** 구체 지름(CSS px). 캔버스는 이보다 2.4배 넓어 바깥 빛이 잘리지 않는다 */
  readonly size: number;
  readonly theme: "dark" | "light";
}

// CSS 행성 대체: 같은 자리에 토큰으로 그린 구체와 바깥 빛
const PLANET =
  "rounded-full shadow-[0_0_38px_color-mix(in_oklab,var(--cs-color-info-graphic)_34%,transparent)] bg-[radial-gradient(circle_at_34%_28%,color-mix(in_oklab,var(--cs-color-surface-raised)_42%,transparent),transparent_46%),linear-gradient(var(--cs-color-agent-stop-2),var(--cs-color-agent-stop-1)_30%,var(--cs-color-agent-stop-3)_62%,var(--cs-color-info-graphic))]";
const PLANET_GLOW =
  "absolute -inset-[34px] rounded-full blur-[14px] bg-[radial-gradient(circle,color-mix(in_oklab,var(--cs-color-info-graphic)_30%,transparent)_30%,color-mix(in_oklab,var(--cs-color-agent-graphic)_12%,transparent)_52%,transparent_70%)]";

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

export function CoreSphere({ energy, size, theme }: CoreSphereProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const progRef = useRef<QuadProgram | null>(null);
  const motionRef = useRef<CoreMotion | null>(null);
  const lastRef = useRef<number | null>(null);
  const [support, setSupport] = useState<GlSupport>("pending");

  const setup = useCallback((): void => {
    const gl = glRef.current;
    const next = gl === null ? null : buildQuadProgram(gl, CORE_FRAG);
    progRef.current = next;
    setSupport(next === null ? "none" : "shader");
  }, []);

  const draw: FrameDraw = (now, still) => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const prog = progRef.current;
    if (canvas === null || gl === null || prog === null) return;
    // 움직임 줄이기는 시계를 세우고(stepCore를 건너뛴다) 목표 에너지를 그대로 보인다
    const prev = motionRef.current ?? initialCoreMotion(energy);
    const dt = frameDtSeconds(lastRef.current, now);
    lastRef.current = now;
    const next = still ? prev : stepCore(prev, dt, energy);
    motionRef.current = next;
    const f = coreFrame(next, energy, still);
    const half = canvas.width / 2;
    drawQuad(prog, (loc) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(loc("uCenter"), half, half);
      gl.uniform1f(loc("uR"), canvas.width / (2 * CORE_BOX_SCALE));
      gl.uniform1f(loc("uEdge"), CORE_BOX_SCALE);
      gl.uniform1f(loc("uDark"), theme === "dark" ? 1 : 0);
      gl.uniform1f(loc("uTime"), f.time);
      gl.uniform1f(loc("uFlow"), f.flow);
      gl.uniform4f(loc("uRot"), f.rot[0], f.rot[1], f.rot[2], f.rot[3]);
      gl.uniform1f(loc("uEnergy"), f.energy);
      gl.uniform2f(loc("uScale"), f.scale[0], f.scale[1]);
    });
  };

  // 구체는 늘 살아 있으므로 active(60fps). 탭이 가려지면 멈추고, 움직임 줄이기는 한 장이다.
  const { contextLost, reducedMotion, redraw } = useFrameLoop(draw, {
    canvas: canvasRef,
    mode: "active",
    enabled: support === "shader",
    onRestored: setup,
    paint: `${energy}|${theme}`,
  });

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

  // 캔버스 한 변 = 2.4배 CSS 지름 × 기기 배율 × 1.3(상한 1024 기기 px). 크기나 배율이 바뀌면 다시 그린다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const fit = (): void => {
      const px = coreCanvasSize(size * CORE_BOX_SCALE, window.devicePixelRatio).px;
      canvas.width = px;
      canvas.height = px;
      redraw();
    };
    fit();
    return watchDevicePixelRatio(fit);
  }, [size, redraw]);

  const live = renderMode(support !== "none", contextLost, reducedMotion) !== "css-fallback";
  const box = `${CORE_BOX_SCALE * 100}%`;
  // 캔버스는 지름의 가운데에 놓인다: 바깥으로 (2.4 - 1) / 2배만큼 넘친다
  const inset = `${-((CORE_BOX_SCALE - 1) / 2) * 100}%`;
  return (
    <div aria-hidden className="pointer-events-none relative" style={{ width: size, height: size }}>
      {live ? null : (
        <>
          <span aria-hidden className={PLANET_GLOW} />
          <span aria-hidden className={`absolute inset-0 ${PLANET}`} />
        </>
      )}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`absolute ${live ? "" : "hidden"}`}
        style={{ width: box, height: box, left: inset, top: inset }}
      />
    </div>
  );
}
