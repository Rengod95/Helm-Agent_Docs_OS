// S-04 토스트 자리(U-14, §6.4, DP-152). 창 전체 기준 오른쪽 아래, 상태 표시줄 위. 오른쪽 well이 열려 있으면 well 왼쪽 끝으로 옮겨
// well 내용을 가리지 않는다. 입력창 묶음 같은 피할 곳(`data-toast-avoid`)은 토스트가 그 조작부와 실제로 겹칠 때만 그 위로 올라간다.
import type { Layout } from "../../state/shell/index.ts";

/** well 기본 폭 352 + 막대와 well 사이 간격 6 + 막대 폭과 창 여백 56 + 여유 12 */
export const WELL_DEFAULT_WIDTH = 352;
const BAR_AND_GAPS_PX = 6 + 56 + 12;
/** well이 닫혀 있을 때 창 오른쪽 끝에서의 거리. 막대는 세로 가운데라 아래 모서리와 만나지 않는다 */
export const TOAST_END_PX = 16;

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

/** 기본 아래 간격(시안 `s04-toast`의 `bottom-10` = 40px): 상태 표시줄(28) 위 12px */
export const TOAST_BOTTOM_DEFAULT_PX = 40;
const TOAST_GAP_PX = 12;
/** 토스트가 아직 없을 때 겹침을 잴 높이: 한 줄 md 토스트(48). 첫 토스트가 들어오기 전에 자리가 정해져 있게 한다 */
export const TOAST_PROBE_HEIGHT_PX = 48;

/** 창 위·왼쪽에서 잰 상자(px) */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 피할 곳 하나: 그 위쪽 끝과, 덮으면 안 되는 조작부(단추, 입력 칸)의 상자들 */
export interface ToastAvoid {
  readonly top: number;
  readonly controls: readonly Box[];
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

/**
 * 토스트의 아래 간격. 기본 자리의 토스트(`toast`)가 피할 곳의 조작부와 하나라도 겹치면, 겹친 피할 곳들 중 가장 높은 위쪽 끝
 * 위로 12px 띄워 올린다. 넓은 창처럼 겹치지 않으면 기본 자리(상태 표시줄 위)에 둔다. 대화의 마지막 답을 덜 가린다.
 */
export function toastBottomPx(
  avoids: readonly ToastAvoid[],
  toast: Box,
  viewportHeight: number,
): number {
  let bottom = TOAST_BOTTOM_DEFAULT_PX;
  for (const avoid of avoids) {
    if (!avoid.controls.some((c) => boxesOverlap(c, toast))) continue;
    bottom = Math.max(bottom, Math.ceil(viewportHeight - avoid.top) + TOAST_GAP_PX);
  }
  return bottom;
}
