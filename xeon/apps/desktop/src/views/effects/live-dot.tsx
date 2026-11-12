// "도는 중" 점(dzE 시안 §2.5·§3, DP-127 [결정: 2026-11-12 사용자]). 지금 띠와 그 펼친 목록에서 회전 스피너 대신 쓴다.
// 14px 칸(아이콘 자리와 같은 크기) 가운데 6px 크리스탈 점이 숨 쉰다. wait는 경고 색으로 멈춘다. 모양은 beam.css.

import type { ReactNode } from "react";

export function LiveDot(props: {
  readonly state: "run" | "wait";
  readonly className?: string;
}): ReactNode {
  return (
    <span aria-hidden className={`fx-dot ${props.className ?? ""}`} data-state={props.state}>
      <span className="fx-dot-core" />
    </span>
  );
}
