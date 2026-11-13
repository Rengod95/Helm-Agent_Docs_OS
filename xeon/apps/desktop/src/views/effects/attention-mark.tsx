// 주의 표시(DP-189 [결정: 2026-11-13 사용자 "그 고리를 절대 쓰지 않는다"]). "내 확인이 필요함"을 나타내는 살아 있는 작은 마크다.
// 오목한 네 꼭지 별(벡터)이 호박 → 산호 빛으로 칸 가운데에 서고, 뒤에 따뜻한 번짐이 있다. 반짝일 때는 별이 조금 돌며 커졌다 잦아든다.
// 진행 중(LiveDot run: 둥근 크리스탈 점이 숨 쉼)과 모양·색 온도·움직임이 모두 다르다. 움직임을 줄이거나 상한(attention-budget)을 넘으면
// 같은 모양으로 멈춘다. 모양은 attention.css. 뜻은 부르는 쪽이 글(툴팁·sr-only)로 말한다.

import { useId, type ReactNode } from "react";
import { useAttentionLive } from "./attention-budget.ts";

/** 오목한 네 꼭지 별(10 × 10). 꼭지는 칸 끝에 닿고 허리는 가운데로 깊게 들어간다 */
const GLINT_PATH =
  "M5 0C5.55 3.1 6.9 4.45 10 5C6.9 5.55 5.55 6.9 5 10C4.45 6.9 3.1 5.55 0 5C3.1 4.45 4.45 3.1 5 0Z";

export function AttentionMark(props: {
  /** md 14px 칸(아이콘 칸, 대화 줄 앞·카드 머리), sm 12px 칸(내비 줄 숫자 옆) */
  readonly size?: "md" | "sm";
  /** false면 처음부터 멈춘 모양이다(목록 안에서 같은 뜻이 여럿일 때 부르는 쪽이 줄이고 싶으면) */
  readonly live?: boolean;
  readonly className?: string;
}): ReactNode {
  const id = useId();
  const live = useAttentionLive("mark", props.live ?? true);
  const fill = `fx-attend-fill-${id.replace(/[^\w-]/g, "")}`;
  return (
    <span
      aria-hidden
      data-slot="attention-mark"
      data-size={props.size ?? "md"}
      data-live={live ? "true" : "false"}
      className={`fx-attend-mark${props.className === undefined ? "" : ` ${props.className}`}`}
    >
      <span className="fx-attend-halo" />
      <svg className="fx-attend-glint" viewBox="0 0 10 10" focusable="false">
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--fx-attend-a)" />
            <stop offset="1" stopColor="var(--fx-attend-b)" />
          </linearGradient>
        </defs>
        <path d={GLINT_PATH} fill={`url(#${fill})`} />
      </svg>
    </span>
  );
}

/**
 * 카드 주의 면의 겹(위 변 빛 + 안쪽 오로라). `.fx-attend-card`를 단 카드 안 첫 자식으로 둔다. 카드 바탕 위·글 아래에 깔린다.
 * `pending`이면 화면 전체에서 하나만 오로라가 흐르고(attention-budget) 나머지는 같은 빛으로 멈춰 있다
 */
export function AttendGlow(props: { readonly pending: boolean }): ReactNode {
  const live = useAttentionLive("card", props.pending);
  if (!props.pending) return null;
  return (
    <span aria-hidden className="fx-attend-glow" data-live={live ? "true" : "false"}>
      <span className="fx-attend-glow-haze" />
      <span className="fx-attend-glow-edge" />
    </span>
  );
}
