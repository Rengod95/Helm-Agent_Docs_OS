// 배경과 행성 캔버스의 성능 규칙(SPEC: 해상도, 프레임 상한, 멈춤, 한 장 그리기). DOM 없이 판정한다.

/** idle: 가만히 있을 때 상한 30fps. active: 끌거나 움직일 때 60fps */
export type ActivityMode = "idle" | "active";
/** shader: 매 프레임. still: 한 장만. css-fallback: WebGL 없이 CSS 그라디언트 */
export type RenderMode = "shader" | "still" | "css-fallback";
/** background: 배경 셰이더. core: 진주빛 구체 */
export type Layer = "background" | "core";

export interface FrameInput {
  readonly now: number;
  readonly last: number;
  readonly mode: ActivityMode;
  readonly hidden: boolean;
  readonly reducedMotion: boolean;
  readonly contextLost: boolean;
  readonly drawnOnce: boolean;
}

export interface CoreCanvasSize {
  /** 캔버스 한 변(기기 px) */
  readonly px: number;
  /** CSS px 하나당 그리는 기기 px 배율 */
  readonly ratio: number;
}

const BACKGROUND_DPR_MAX = 1.25;
const CORE_DPR_FACTOR = 1.3;
const CORE_SIDE_MAX = 1024;
/** vsync 흔들림 때문에 한 프레임 놓쳐 절반 fps로 떨어지는 것을 막는 여유(ms) */
const FRAME_SLACK_MS = 2;

/** 모드별 프레임 간격(ms) */
export function frameInterval(mode: ActivityMode): number {
  return mode === "idle" ? 1000 / 30 : 1000 / 60;
}

/** 이번 rAF에서 그릴지. 숨김과 컨텍스트 상실은 항상 멈춤, 움직임 줄이기는 첫 한 장만 */
export function shouldRender(frame: FrameInput): boolean {
  if (frame.hidden || frame.contextLost) return false;
  if (frame.reducedMotion) return !frame.drawnOnce;
  if (!frame.drawnOnce) return true;
  return frame.now - frame.last >= frameInterval(frame.mode) - FRAME_SLACK_MS;
}

/** 요청한 기기 DPR 배율. 배경은 1.25배까지, 구체는 기기 DPR의 1.3배 */
export function dprFor(devicePixelRatio: number, layer: Layer): number {
  return layer === "background"
    ? Math.min(devicePixelRatio, BACKGROUND_DPR_MAX)
    : devicePixelRatio * CORE_DPR_FACTOR;
}

/** 구체 캔버스 크기. 한 변이 1024 기기 px을 넘지 않게 배율을 낮춘다 */
export function coreCanvasSize(cssPx: number, dpr: number): CoreCanvasSize {
  const want = dprFor(dpr, "core");
  // cssPx가 0이면 나눗셈이 없어야 한다
  const ratio = cssPx > 0 ? Math.min(want, CORE_SIDE_MAX / cssPx) : want;
  return { px: Math.round(cssPx * ratio), ratio };
}

/** 그리기 방식. WebGL이 없거나 컨텍스트를 잃으면 CSS, 움직임 줄이기는 한 장 */
export function renderMode(
  webglAvailable: boolean,
  contextLost: boolean,
  reducedMotion: boolean,
): RenderMode {
  if (!webglAvailable || contextLost) return "css-fallback";
  return reducedMotion ? "still" : "shader";
}
