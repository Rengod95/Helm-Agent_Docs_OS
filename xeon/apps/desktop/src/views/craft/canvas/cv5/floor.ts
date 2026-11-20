// cv5 바닥의 순수 값: 점 격자의 간격(확대에 따라 두 배씩 바뀐다), 화면 점 층을 옮기는 자리, 첫 시점, 빛이 번지는 폭.
// 점 격자는 캔버스 좌표에 박혀 있다(캔버스를 옮기면 점도 함께 간다). 점 한 알은 화면에서 늘 같은 크기이고,
// 점 사이는 화면에서 DOT_MIN_SCREEN 이상 DOT_MIN_SCREEN×2 미만(10~20px)이 되게 캔버스 간격을 두 배·반으로 고른다(멀리서 점이 뭉개지지 않는다).

/** 점 사이의 바탕 값(캔버스 단위). 실제 간격은 이 값의 2^k배에서 고른다(100%에서 12, 50%에서 24) */
const DOT_GAP = 24;
/** 화면에서 점 사이의 가장 좁은 값 */
const DOT_MIN_SCREEN = 10;
/** 점 한 알의 반지름(화면 픽셀) */
const DOT_RADIUS = 0.85;
/** 고른 판의 빛이 카드 변에서 바깥으로 번지는 폭(캔버스 단위) */
export const GLOW_REACH = 96;

export interface DotGrid {
  /** 캔버스 단위의 점 사이 */
  readonly gap: number;
  /** 화면 픽셀의 점 사이 */
  readonly screen: number;
  /** 화면 픽셀의 점 반지름 */
  readonly radius: number;
}

export function dotGrid(zoom: number): DotGrid {
  if (!(zoom > 0)) return { gap: DOT_GAP, screen: DOT_GAP, radius: DOT_RADIUS };
  const k = Math.ceil(Math.log2(DOT_MIN_SCREEN / (DOT_GAP * zoom)));
  const gap = DOT_GAP * 2 ** k;
  return { gap, screen: gap * zoom, radius: DOT_RADIUS };
}

/**
 * 화면 점 층(무늬 칸 하나만큼 더 큰 면)을 옮길 자리. 캔버스의 이동 값 `t`를 칸 크기로 나눈 나머지에서 한 칸을 뺀다:
 * 그러면 점이 캔버스 좌표 gap×(n + ½)에 서고, 층은 늘 화면을 덮는다
 */
export function dotShift(t: number, screen: number): number {
  return (((t % screen) + screen) % screen) - screen;
}

/** 처음 시점의 가장 작은 배율(중간 단계에서 이름과 하는 일이 읽히는 크기)과 가장 큰 배율 */
export const OPEN_ZOOM_MIN = 0.5;
export const OPEN_ZOOM_MAX = 0.8;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface OpenView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  /** 루프의 오른쪽이 화면 밖으로 넘치는가(옆으로 옮겨 보라는 표시를 낸다) */
  readonly overflowRight: boolean;
}

/**
 * 처음 보는 시점: 루프 전체(레일 양 끝과 판들)가 들어가는 배율로 연다. 그 배율이 OPEN_ZOOM_MIN보다 작으면(좁은 화면)
 * OPEN_ZOOM_MIN으로 열고 루프가 시작하는 왼쪽 끝을 화면 왼쪽에 붙인다(나머지는 옆으로 옮겨 본다).
 * 세로는 들어가면 남는 자리의 위 ⅓에, 넘치면 위 끝을 붙인다. `avail`은 여백을 뺀 화면 상자(화면 픽셀)
 */
export function openViewOf(bounds: Box, avail: Box): OpenView {
  const fit = Math.min(avail.w / bounds.w, avail.h / bounds.h);
  const zoom = Math.min(OPEN_ZOOM_MAX, Math.max(OPEN_ZOOM_MIN, fit));
  const w = bounds.w * zoom;
  const h = bounds.h * zoom;
  const overflowRight = w > avail.w + 1;
  const x = overflowRight
    ? avail.x - bounds.x * zoom
    : avail.x + (avail.w - w) / 2 - bounds.x * zoom;
  const y =
    h <= avail.h ? avail.y + (avail.h - h) / 3 - bounds.y * zoom : avail.y - bounds.y * zoom;
  return { x, y, zoom, overflowRight };
}
