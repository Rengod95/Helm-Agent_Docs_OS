// 카드 주의 면(DP-191). "내 확인이 필요함"을 카드의 면(위 변 빛 + 안쪽 오로라)으로 말한다. 받은 요청 카드와 승인 카드가 쓴다.
// 주의 구슬(AttentionMark, 호박 점 구슬)은 없앴다: 카드 머리는 요청 그림(illustrations/request-art.tsx, DP-210)이,
// 수가 있는 자리는 수만이 말한다(DP-211 [결정: 2026-11-15 사용자]). 별·느낌표·단색 점·고리로 돌아가지 않는다(시험 source-rules).

import type { ReactNode } from "react";
import { useAttentionLive } from "./attention-budget.ts";

/**
 * 카드 주의 면의 겹(위 변 빛 + 안쪽 오로라). `.fx-attend-card`를 단 카드 안 첫 자식으로 둔다. 카드 바탕 위·글 아래에 깔린다.
 * `pending`이면 화면 전체에서 하나만 오로라가 흐르고(attention-budget) 나머지는 같은 빛으로 멈춰 있다.
 * 빛깔은 따뜻한 빛(승인 카드)이 기본이고, 크리스탈 표시를 단 카드(받은 요청 카드)는 `tone="crystal"`로 표시와 같은 오로라 계열이다(DP-223)
 */
export function AttendGlow(props: {
  readonly pending: boolean;
  readonly tone?: "warm" | "crystal";
}): ReactNode {
  const live = useAttentionLive("card", props.pending);
  if (!props.pending) return null;
  return (
    <span
      aria-hidden
      className="fx-attend-glow"
      data-live={live ? "true" : "false"}
      data-tone={props.tone ?? "warm"}
    >
      <span className="fx-attend-glow-haze" />
      <span className="fx-attend-glow-edge" />
    </span>
  );
}
