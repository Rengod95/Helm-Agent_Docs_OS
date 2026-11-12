// S-04 토스트 자리(U-14, §6.4, DP-146). 오른쪽 well이 열려 있으면 well 왼쪽 끝으로 옮겨 well 내용을 가리지 않는다.
// 토스트는 대화 열(본문과 입력창)을 덮지 않는다: 열 오른쪽에 토스트가 들어갈 틈이 있으면 그 틈의 아래(상태 표시줄 위)에,
// 없으면 머리 줄 바로 아래 오른쪽에 선다. 오른쪽 떠 있는 막대(무대 세로 가운데, DP-135)는 `endPx`가 이미 비켜 둔다.
import type { Layout } from "../../state/shell/index.ts";

/** well 기본 폭 352 + 막대와 well 사이 간격 6 + 막대 폭과 창 여백 56 + 여유 12 */
export const WELL_DEFAULT_WIDTH = 352;
const BAR_AND_GAPS_PX = 6 + 56 + 12;

export type ToastPlace =
  /** 가로 가운데. compact는 well이 무대 위에 뜨는 면이라 well과 겹치지 않는다 */
  | { readonly kind: "center" }
  /** 창 오른쪽 끝에서 `endPx`만큼 안쪽 */
  | { readonly kind: "end"; readonly endPx: number };

/** 토스트가 서는 가로 자리. `wellWidth`는 열린 well의 폭(px)이다 */
export function toastPlace(layout: Layout, wellOpen: boolean, wellWidth: number): ToastPlace {
  if (layout === "compact") return { kind: "center" };
  return { kind: "end", endPx: wellOpen ? wellWidth + BAR_AND_GAPS_PX : 56 };
}

/** 기본 아래 간격(시안 `s04-toast`의 `bottom-10` = 2.5rem = 40px): 상태 표시줄 위 */
export const TOAST_BOTTOM_DEFAULT_PX = 40;
/** caustic 토스트 폭(`--cs-size-toast-w`) */
const TOAST_WIDTH_PX = 360;
/** 토스트와 대화 열 사이 최소 틈 */
const TOAST_GAP_PX = 12;
/** 대화 열: 가운데 정렬, 최대 736(`max-w-184`), 좌우 안쪽 여백 12(`px-3`). 입력창과 대화 줄이 같은 열이다 */
const COLUMN_MAX_PX = 736;
const COLUMN_PAD_PX = 12;

/** 입력창 묶음(`data-toast-avoid`)의 가로 상자. 묶음은 무대 폭을 다 쓰고 그 안에 대화 열이 가운데 선다 */
export interface ToastAvoidBox {
  readonly left: number;
  readonly width: number;
}

/** 토스트의 세로 자리 */
export type ToastEdge =
  /** 창 아래에서 `px` 위(상태 표시줄 위) */
  | { readonly kind: "bottom"; readonly px: number }
  /** 화면 머리 줄 바로 아래 */
  | { readonly kind: "top" };

/** 묶음 상자 안 대화 열 내용의 오른쪽 끝(창 왼쪽에서 잰 px) */
export function columnRightOf(box: ToastAvoidBox): number {
  const column = Math.min(box.width, COLUMN_MAX_PX);
  return box.left + (box.width + column) / 2 - COLUMN_PAD_PX;
}

/**
 * 토스트의 세로 자리. 대화 열이 없는 화면(`box`가 null)은 시안 자리(아래)다. 대화 화면에서는 열 오른쪽 틈이 토스트 폭과 간격보다
 * 넓으면 그 틈의 아래에 서고(열과 입력창을 덮지 않는다), 좁거나 가운데 자리(compact)면 머리 줄 아래로 올린다.
 * 마지막 답 줄과 입력창은 화면 아래에 있으므로 좁은 창에서 토스트가 위로 가야 새로 온 내용을 가리지 않는다
 */
export function toastEdgeOf(
  place: ToastPlace,
  box: ToastAvoidBox | null,
  viewportWidth: number,
): ToastEdge {
  if (box === null || box.width === 0) return { kind: "bottom", px: TOAST_BOTTOM_DEFAULT_PX };
  if (place.kind === "center") return { kind: "top" };
  const free = viewportWidth - place.endPx - columnRightOf(box);
  return free >= TOAST_WIDTH_PX + TOAST_GAP_PX
    ? { kind: "bottom", px: TOAST_BOTTOM_DEFAULT_PX }
    : { kind: "top" };
}
