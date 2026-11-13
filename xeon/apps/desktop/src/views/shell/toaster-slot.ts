// S-04 토스트 자리(U-14, §6.4, DP-152, DP-157, DP-170). 창 전체 기준 오른쪽 아래, 상태 표시줄 위. 오른쪽 well이 열려 있으면 well 왼쪽 끝으로 옮겨
// well 내용을 가리지 않는다. 입력창 묶음 같은 피할 곳(`data-toast-avoid`)의 조작부와 겹치면 폭을 줄여 그 오른쪽 틈에 넣고,
// 틈이 최소 폭보다 좁으면 최소 폭으로 같은 자리에 둔다. 토스트는 어느 창 폭에서도 위로 올라가지 않는다(`toastWidth`).
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
