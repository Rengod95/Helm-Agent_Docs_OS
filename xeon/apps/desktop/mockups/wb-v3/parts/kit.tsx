// 캔버스 v3 작은 부품: 카드·칸 겉모양, 고른 것의 고리, 가운데 칸의 여백, 상세 그림의 곡선.
// 선 격자 배치(레이아웃)만 옮겼다. 색·반지름·그림자는 옛 언어 토큰만 쓴다(ring 그림자 토큰, 레일은 쓰지 않는다).

import { PAGE_PAD } from "../../_shell";

/** 카드(판): 표면 채움 + 1px 안쪽 테두리(옛 caustic surface 카드와 같은 모양), 반지름 16. */
export const CARD =
  "rounded-2xl bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";

/** 칸(블록·흐름 단계): 떠 있는 면 + 1px 안쪽 테두리, 반지름 12. */
export const TILE =
  "rounded-xl bg-surface-raised shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]";

/** 고른 것(상세의 고른 블록·단계): accent 1px 안쪽 고리. 색은 고른 것에만 쓴다. */
export const RING = "shadow-[inset_0_0_0_1px_var(--cs-color-accent-border-strong)]";

/** 가운데 칸: 레일 없이 바깥 여백 24(PAGE_PAD)만 두고 세로로 흐른다. 넘치면 칸 전체가 스크롤한다. */
export const STAGE = `flex min-h-0 min-w-0 flex-1 flex-col overflow-auto ${PAGE_PAD}`;

/** 수평으로 들어가 수평으로 나오는 부드러운 곡선 */
export function hCurve(ax: number, ay: number, bx: number, by: number) {
  const dx = Math.max(24, Math.abs(bx - ax) * 0.5);
  return `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
}
