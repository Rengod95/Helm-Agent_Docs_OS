// 주의 표시(DP-189 [결정: 2026-11-13 사용자 "2번같은 스타일의 아이콘"]). "내 확인이 필요함"을 나타내는 점 구슬이다.
// 생각 구슬과 같은 점 구슬 식구로, 상태는 listening(물결이 고리들을 굴러가는 촘촘한 구)이고 잉크는 줄 물듦과 같은 호박 → 산호다.
// 진행 중(ProgressOrb: 성긴 흑백 별자리 connecting)과 점의 밀도·모양·색 온도·움직임이 모두 달라 멈춘 한 장면에서도 갈린다.
// 그리기는 dot-orb.tsx. 움직이는 수는 attention-budget의 mark 상한(3)이고, 넘거나 움직임을 줄이면 멈춘 한 장면이다.
// 별·느낌표·단색 점·고리로 돌아가지 않는다(시험 source-rules). 뜻은 부르는 쪽이 글(툴팁·sr-only)로 말한다.

import type { ReactNode } from "react";
import type { OrbState } from "thinking-orbs";
import { useAttentionLive } from "./attention-budget.ts";
import { DotOrb } from "./dot-orb.tsx";

/** 주의 구슬의 상태(dzV4 후보 B, `_notes/design/dz/dzV4-design.md`) */
const ATTENTION_ORB_STATE: OrbState = "listening";

export function AttentionMark(props: {
  /** md 14px 칸(카드 머리·아이콘 칸), sm 12px 칸(내비 줄 숫자 옆) */
  readonly size?: "md" | "sm";
  /** false면 처음부터 멈춘 한 장면이다 */
  readonly live?: boolean;
  readonly className?: string;
}): ReactNode {
  const size = props.size ?? "md";
  return (
    <span
      aria-hidden
      data-slot="attention-mark"
      data-size={size}
      className={`fx-attend-mark${props.className === undefined ? "" : ` ${props.className}`}`}
    >
      <DotOrb
        state={ATTENTION_ORB_STATE}
        tone="warm"
        size={size === "sm" ? 12 : 14}
        kind="mark"
        {...(props.live === undefined ? {} : { live: props.live })}
      />
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
