// S-01 폭 단계. caustic 중단점과 같은 경계(720, 1100)다 (L4.desktop-ux.spec §4.1, DP-13).

/** wide: 시작 영역 붙박이 + 끝 영역 떠 있는 막대. medium: 끝 영역은 무대 위 시트. compact: 시작 영역도 시트 */
export type Layout = "wide" | "medium" | "compact";

const LAYOUT_BREAKPOINTS: { readonly compactMax: 720; readonly mediumMax: 1100 } = {
  compactMax: 720,
  mediumMax: 1100,
};

/** 창 폭(px)에서 폭 단계를 구한다. 경계 값은 아래 단계에 든다(720은 compact, 1100은 medium) */
export function layoutOf(width: number): Layout {
  if (width <= LAYOUT_BREAKPOINTS.compactMax) return "compact";
  if (width <= LAYOUT_BREAKPOINTS.mediumMax) return "medium";
  return "wide";
}

/** 한 단계에 들어설 때 패널의 기본 열림 상태. 시작 영역은 compact가 아니면 붙박이로 열리고, 끝 영역은 늘 닫힌 채 시작한다 */
export function panelDefaults(layout: Layout): {
  readonly startOpen: boolean;
  readonly endOpen: boolean;
} {
  return { startOpen: layout !== "compact", endOpen: false };
}
