// S-04 토스트 자리(U-14, §6.4, DP-152, DP-157, DP-170). 창 전체 기준 오른쪽 아래, 상태 표시줄 위. 오른쪽 well이 열려 있으면 well 왼쪽 끝으로 옮겨
// well 내용을 가리지 않는다. 입력창 묶음 같은 피할 곳(`data-toast-avoid`)의 조작부와 겹치면 폭을 줄여 그 오른쪽 틈에 넣고,
// 틈이 최소 폭보다 좁으면 입력창 묶음 위쪽 끝 위로 올린다(AGE-75 질문 2 가, `toastFit`). 넓은 창(틈이 넉넉한 1440·1920)은 아래 자리 그대로다.
import { cssPxOf } from "../../lib/zoom.ts";
import type { Layout } from "../../state/shell/index.ts";

/** well 기본 폭 352 + 막대와 well 사이 간격 6 + 막대 폭과 창 여백 56 + 여유 12 */
export const WELL_DEFAULT_WIDTH = 352;
const BAR_AND_GAPS_PX = 6 + 56 + 12;
/** well이 닫혀 있을 때 창 오른쪽 끝에서의 거리. 막대는 세로 가운데라 아래 모서리와 만나지 않는다 */
const TOAST_END_PX = 16;

export type ToastPlace =
  /** 가운데 아래, 상태 표시줄 위. compact는 well이 무대 위에 뜨는 면이라 well과 겹치지 않는다 */
  | { readonly kind: "center-bottom" }
  /** 창 오른쪽 끝에서 `endPx`만큼 안쪽, 상태 표시줄 위 */
  | { readonly kind: "end"; readonly endPx: number };

/** 토스트가 서는 자리. `wellWidth`는 열린 well의 폭(px)이다 */
export function toastPlace(layout: Layout, wellOpen: boolean, wellWidth: number): ToastPlace {
  if (layout === "compact") return { kind: "center-bottom" };
  return { kind: "end", endPx: wellOpen ? wellWidth + BAR_AND_GAPS_PX : TOAST_END_PX };
}

/** 아래 간격(시안 `s04-toast`의 `bottom-10` = 40px): 상태 표시줄(28) 위 12px. 창 폭과 관계없이 늘 이 자리다(DP-170) */
export const TOAST_BOTTOM_DEFAULT_PX = 40;
/** 토스트가 아직 없을 때 겹침을 잴 높이: 한 줄 md 토스트(48). 첫 토스트가 들어오기 전에 폭이 정해져 있게 한다 */
const TOAST_PROBE_HEIGHT_PX = 48;

/** 창 위·왼쪽에서 잰 상자(px) */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 화면 px로 잰 상자를 앱 확대 `zoom` 아래의 CSS px로 옮긴다. 토스트 폭은 CSS px이라 잰 상자와 창 높이를 이것으로 맞춘다(DP-173) */
export function cssBoxOf(box: Box, zoom: number): Box {
  return {
    left: cssPxOf(box.left, zoom),
    top: cssPxOf(box.top, zoom),
    right: cssPxOf(box.right, zoom),
    bottom: cssPxOf(box.bottom, zoom),
  };
}

/** 두 상자가 넓이를 갖고 겹치는지. 맞닿기만 하면 겹치지 않는다 */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 기본 자리(아래 40px)에 선 토스트 묶음의 상자. 가로는 지금 영역의 좌우, 높이는 쌓인 토스트(없으면 한 줄 높이)다 */
export function defaultToastBox(
  left: number,
  right: number,
  height: number,
  viewportHeight: number,
): Box {
  const bottom = viewportHeight - TOAST_BOTTOM_DEFAULT_PX;
  return { left, right, bottom, top: bottom - Math.max(height, TOAST_PROBE_HEIGHT_PX) };
}

/** caustic 토스트 기본 폭(`size.toast-w`) */
export const TOAST_DEFAULT_WIDTH_PX = 360;
/**
 * 줄인 토스트의 최소 폭(DP-157). 1440×900 창에서 대화 열(입력창 오른쪽 끝 1212)과 토스트 오른쪽 끝(1424) 사이 틈 − 12가 200이다.
 * 200이면 글 칸이 열 자 남짓(13px)이라 "복사했어요" 같은 확인은 한 줄, 오류 한 문장은 두세 줄에 든다. 틈이 이보다 좁으면(1280 창은 120)
 * 더 줄이지 않고 이 폭으로 기본 자리에 둔다. 입력창 오른쪽 끝을 조금 덮어도 올리지 않는다(DP-170)
 */
export const TOAST_MIN_WIDTH_PX = 200;
/** 동작 단추(되돌리기 등)가 있는 토스트의 최소 폭. 단추(xs, 글 두세 자 ≈ 56)가 글 칸을 더 먹는다 */
export const TOAST_MIN_WIDTH_ACTION_PX = 280;
/** 줄인 토스트와 그 왼쪽 조작부 사이 */
const TOAST_SIDE_GAP_PX = 12;

/**
 * 토스트의 폭(DP-157, DP-170). 기본 자리(폭 360, 상태 표시줄 위)에서 피할 곳의 조작부(`controls`)와 겹치지 않으면 360이다.
 * 겹치면 겹친 조작부의 오른쪽 끝 + 12부터 토스트 오른쪽 끝까지를 폭으로 쓰되(1440 폭에서 대화 열 오른쪽 틈) `minWidth`보다 좁히지 않는다.
 * 아래 간격은 늘 {@link TOAST_BOTTOM_DEFAULT_PX}라 토스트는 위로 올라가지 않는다.
 * `right`는 토스트 영역의 오른쪽 끝, `height`는 쌓인 토스트의 높이다. `minWidth`는 줄일 수 있는 하한이다
 * (동작 단추가 있는 토스트가 떠 있으면 {@link TOAST_MIN_WIDTH_ACTION_PX})
 */
export function toastWidth(
  controls: readonly Box[],
  right: number,
  height: number,
  viewportHeight: number,
  minWidth: number,
): number {
  const full = defaultToastBox(right - TOAST_DEFAULT_WIDTH_PX, right, height, viewportHeight);
  const blocking = controls.filter((c) => boxesOverlap(c, full));
  if (blocking.length === 0) return TOAST_DEFAULT_WIDTH_PX;
  const edge = Math.max(...blocking.map((c) => c.right));
  const room = Math.floor(right - edge - TOAST_SIDE_GAP_PX);
  return Math.min(TOAST_DEFAULT_WIDTH_PX, Math.max(minWidth, room));
}

/** 올린 토스트의 아래 끝과 입력창 묶음 위쪽 끝 사이(묶음 안 카드 사이와 같은 8) */
export const TOAST_LIFT_GAP_PX = 8;

/** 토스트 영역의 폭과 아래 간격 */
export interface ToastFit {
  /** 오른쪽 자리의 폭. 가운데 아래 자리(`shrink` 거짓)는 쓰지 않는다 */
  readonly width: number;
  /** 창 아래에서 잰 아래 간격 */
  readonly bottom: number;
  /** 기본 자리의 오른쪽 끝에서 더 안쪽으로 옮긴 양. 올린 토스트가 오른쪽 떠 있는 막대와 겹치면 막대 왼쪽 12px 앞으로 옮긴다 */
  readonly shift: number;
}

/**
 * 토스트의 폭과 자리(DP-157, DP-170, AGE-75). 기본은 오른쪽 아래(아래 40, 폭 360)다. 그 자리가 피할 곳의 조작부(`controls`)와 겹치면
 * 오른쪽 자리(`shrink`)는 먼저 폭을 오른쪽 틈까지 줄인다(`toastWidth`). 틈이 `minWidth`보다 좁거나 가운데 아래 자리(compact)면 줄이지 않고
 * 겹치는 피할 곳(`regions`: 입력창 묶음, 재시작 막대) 가운데 가장 높은 것의 위쪽 끝 위 8px로 올린다. 그래서 입력창, 칩, 승인 카드를 덮지 않는다.
 * 올린 자리가 창 위로 넘치면 창 안에 들게 낮춘다. 올린 토스트가 오른쪽 떠 있는 막대(`rails`, 본문 세로 가운데)와 겹치면 막대 왼쪽 12px 앞에서 끝나게
 * 옮긴다(`shift`). `left`·`right`는 옮기기 전 기본 자리의 좌우(오른쪽 자리는 `right`만 쓴다), `height`는 쌓인 토스트의 높이다
 */
export function toastFit(input: {
  readonly controls: readonly Box[];
  readonly regions: readonly Box[];
  readonly rails: readonly Box[];
  readonly left: number;
  readonly right: number;
  readonly height: number;
  readonly viewportHeight: number;
  readonly minWidth: number;
  readonly shrink: boolean;
}): ToastFit {
  const { controls, regions, right, height, viewportHeight, minWidth, shrink } = input;
  const left = shrink ? right - TOAST_DEFAULT_WIDTH_PX : input.left;
  const full = defaultToastBox(left, right, height, viewportHeight);
  const blocking = controls.filter((c) => boxesOverlap(c, full));
  const stay = { width: TOAST_DEFAULT_WIDTH_PX, bottom: TOAST_BOTTOM_DEFAULT_PX, shift: 0 };
  if (blocking.length === 0) return stay;
  if (shrink) {
    const edge = Math.max(...blocking.map((c) => c.right));
    if (Math.floor(right - edge - TOAST_SIDE_GAP_PX) >= minWidth) {
      return { ...stay, width: toastWidth(controls, right, height, viewportHeight, minWidth) };
    }
  }
  // 토스트 세로줄과 가로로 겹치고 기본 자리까지 내려오는 피할 곳의 위쪽 끝
  const tops = regions
    .filter((r) => r.left < full.right && full.left < r.right && r.bottom > full.top)
    .map((r) => r.top);
  if (tops.length === 0) return stay;
  const lifted = viewportHeight - Math.min(...tops) + TOAST_LIFT_GAP_PX;
  const ceiling = viewportHeight - Math.max(height, TOAST_PROBE_HEIGHT_PX) - TOAST_LIFT_GAP_PX;
  const bottom = Math.max(TOAST_BOTTOM_DEFAULT_PX, Math.min(lifted, ceiling));
  const drop = bottom - TOAST_BOTTOM_DEFAULT_PX;
  const raised = { ...full, top: full.top - drop, bottom: full.bottom - drop };
  const rails = input.rails.filter((r) => boxesOverlap(r, raised));
  const shift =
    rails.length === 0
      ? 0
      : Math.max(0, Math.ceil(right - Math.min(...rails.map((r) => r.left)) + TOAST_SIDE_GAP_PX));
  return { width: TOAST_DEFAULT_WIDTH_PX, bottom, shift };
}
