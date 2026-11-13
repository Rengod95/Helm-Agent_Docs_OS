// 진행 중 표시(DP-189 [결정: 2026-11-13 사용자]). 생각 구슬(thinking-indicator)과 같은 흑백 점 구슬(상태 connecting)의 작은 판이다.
// 대화 목록의 도는 대화, 지금 띠의 도는 일·에이전트, 플러그인 활동 트리의 진행 단계가 쓴다. 14px 아이콘 칸(활동 트리는 12px 칸)에 든다.
// 그리기는 dot-orb.tsx(시계 하나, 화면 밖·숨은 창에서 멈춤, 앱 배율까지 또렷하게). 동시에 움직이는 수는 attention-budget의 progress 상한이고,
// 넘거나 움직임을 줄이면 같은 구슬의 멈춘 한 장면이다. 뜻은 부르는 쪽이 글(sr-only·툴팁)로 말한다.

import type { ReactNode } from "react";
import { DotOrb } from "./dot-orb.tsx";
import { ORB_STATE } from "./fx-config.ts";

export function ProgressOrb(props: {
  /** md 14px 칸(아이콘 칸), sm 12px 칸(caustic 활동 트리의 진행 단계 칸) */
  readonly size?: "md" | "sm";
  /** false면 처음부터 멈춘 한 장면이다 */
  readonly live?: boolean;
  readonly className?: string;
}): ReactNode {
  return (
    <DotOrb
      state={ORB_STATE}
      tone="ink"
      size={props.size === "sm" ? 12 : 14}
      kind="progress"
      {...(props.live === undefined ? {} : { live: props.live })}
      {...(props.className === undefined ? {} : { className: props.className })}
    />
  );
}
