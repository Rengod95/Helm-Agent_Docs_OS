// 지도 시점(세계 좌표 → 화면)의 순수 계산. DOM과 React는 hooks.ts가 맡는다.
// 세계 좌표는 1000×1000이고 가운데는 500,500이다. 시점은 배율 k와 이동 x, y다.

const WORLD = 1000;
export const CENTER: number = WORLD / 2;
/** 가장 바깥 호의 반지름(세계 좌표) */
const OUTER = 460;
export const MIN_K = 0.3;
export const MAX_K = 3.2;
/** 맞춤이 넘지 않는 배율: 큰 화면에서도 지도가 과하게 커지지 않는다 */
const FIT_MAX_K = 1.4;
/** 단계 확대 한 번의 배율 */
const ZOOM_STEP = 1.25;
/** 애니메이션 길이(ms) */
const GLIDE_MS = 420;

/** 맞춤의 세로 여백(화면 px) */
const FIT_PAD_Y = 24;
/** 이름표 글자 배율의 위쪽 한계 */
const LABEL_MAX = 1.3;
/** 휠 감도. ctrl+휠(두 손가락 모으기)은 더 민감하다 */
const WHEEL_RATE = 0.0016;
const WHEEL_RATE_PINCH = 0.012;

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Size {
  readonly w: number;
  readonly h: number;
}
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
export interface View {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 배율을 허용 범위 안으로 맞춘다. 이동은 그대로다 */
export function clampView(view: View): View {
  return { k: clamp(view.k, MIN_K, MAX_K), x: view.x, y: view.y };
}

/** 이름표 글자 배율: 확대하면 조금 커지고 축소해도 작아지지 않는다 */
export function labelScale(k: number): number {
  return clamp(Math.sqrt(k), 1, LABEL_MAX);
}

/** 화면에 보이는 배율(%) */
export function percent(k: number): number {
  return Math.round(k * 100);
}

/** 맞춤: 지도가 내용 영역에 들어가는 배율과 이동. 가로는 이름표 폭(labelPad)을 뺀 칸에 맞춘다 */
export function fitView(size: Size, insets: Insets, labelPad: number): View {
  const w = size.w - insets.left - insets.right;
  const h = size.h - insets.top - insets.bottom;
  const fitK = Math.min((w - 2 * labelPad) / (2 * OUTER), (h - FIT_PAD_Y) / (2 * OUTER));
  const k = clamp(fitK, MIN_K, FIT_MAX_K);
  return { k, x: insets.left + w / 2 - CENTER * k, y: insets.top + h / 2 - CENTER * k };
}

/** 내용 영역(여백을 뺀 칸)의 가운데 */
function contentCenter(size: Size, insets: Insets): Point {
  return {
    x: insets.left + (size.w - insets.left - insets.right) / 2,
    y: insets.top + (size.h - insets.top - insets.bottom) / 2,
  };
}

/** 배율을 factor만큼 바꾼다. anchor 아래의 세계 점은 화면에서 제자리에 남는다 */
export function zoomAt(view: View, factor: number, anchor: Point): View {
  const next = clampView({ k: view.k * factor, x: view.x, y: view.y });
  const f = next.k / view.k;
  return {
    k: next.k,
    x: anchor.x - (anchor.x - view.x) * f,
    y: anchor.y - (anchor.y - view.y) * f,
  };
}

/** 단계 확대·축소(확대 막대 버튼). 내용 영역의 가운데를 기준으로 한 단계 바꾼다 */
export function zoomSteps(view: View, direction: "in" | "out", size: Size, insets: Insets): View {
  const factor = direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAt(view, factor, contentCenter(size, insets));
}

/** 휠 한 번의 배율 */
export function wheelFactor(deltaY: number, ctrlKey: boolean): number {
  return Math.exp(-deltaY * (ctrlKey ? WHEEL_RATE_PINCH : WHEEL_RATE));
}

/** 두 손가락 거리의 비율. 이전 거리가 없으면 1이다(배율을 바꾸지 않는다) */
export function pinchDelta(prev: number, next: number): number {
  return prev > 0 ? next / prev : 1;
}

/** 끌기: 누르기 시작한 시점(start)에서 포인터가 움직인 만큼 옮긴다. 배율은 그대로다 */
export function panBy(start: View, dx: number, dy: number): View {
  return { k: start.k, x: start.x + dx, y: start.y + dy };
}

/** 애니메이션 한 프레임. 세제곱 감속으로 from에서 to까지 가고, 시간이 다 되면 to다 */
export function glideAt(from: View, to: View, elapsedMs: number): View {
  const t = clamp(elapsedMs / GLIDE_MS, 0, 1);
  if (t >= 1) return { k: to.k, x: to.x, y: to.y };
  const e = 1 - (1 - t) ** 3;
  return {
    k: from.k + (to.k - from.k) * e,
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
  };
}
