// S-04 토스트 자리(U-14, §6.4). 오른쪽 well이 열려 있으면 well 왼쪽 끝으로 옮겨 well 내용을 가리지 않는다.
import type { Layout } from "../../state/shell/index.ts";

/** well 기본 폭 352 + 막대와 well 사이 간격 6 + 막대 폭과 창 여백 56 + 여유 12 */
export const WELL_DEFAULT_WIDTH = 352;
const BAR_AND_GAPS_PX = 6 + 56 + 12;

export type ToastPlace =
  /** 가운데 아래, 상태 표시줄 위. compact는 well이 무대 위에 뜨는 면이라 well과 겹치지 않는다 */
  | { readonly kind: "center-bottom" }
  /** 창 오른쪽 끝에서 `endPx`만큼 안쪽, 상태 표시줄 위 */
  | { readonly kind: "end"; readonly endPx: number };

/** 토스트가 서는 자리. `wellWidth`는 열린 well의 폭(px)이다 */
export function toastPlace(layout: Layout, wellOpen: boolean, wellWidth: number): ToastPlace {
  if (layout === "compact") return { kind: "center-bottom" };
  return { kind: "end", endPx: wellOpen ? wellWidth + BAR_AND_GAPS_PX : 56 };
}

/** 기본 아래 간격(bottom-40 = 10rem): 상태 표시줄과 입력창 위 */
export const TOAST_BOTTOM_DEFAULT_PX = 160;
const TOAST_GAP_PX = 12;

/**
 * 토스트의 아래 간격. 입력창과 그 위 카드(승인, 신뢰, 안전 모드)가 서는 자리의 위쪽 끝(`avoidTop`, 창 위에서 잰 px)을
 * 알면 그 위로 올려 허용·거부 단추와 입력창을 덮지 않는다. 그 자리가 없으면(설정 등) 기본값이다.
 */
export function toastBottomPx(avoidTop: number | null, viewportHeight: number): number {
  if (avoidTop === null) return TOAST_BOTTOM_DEFAULT_PX;
  return Math.max(TOAST_BOTTOM_DEFAULT_PX, Math.ceil(viewportHeight - avoidTop) + TOAST_GAP_PX);
}
