// 오로라(dzE 시안 §2, DP-126 [결정: 2026-11-12 사용자]). 턴이 도는 동안의 "살아 있음"을 크리스탈 빛의 느린 흐름으로 보인다.
// 큰 radial 알갱이 셋이 서로 다른 주기로 흐르는 CSS 합성 레이어다(transform·opacity만 움직여 메인 스레드·스타일 재계산 0). 모양은 aurora.css.
// 상태: run 흐름, wait 멈추고 경고 톤으로 고요히 맥동, stop 잦아듦, done 굴절 하이라이트가 한 번 쓸리고 사라짐, off 꺼짐.

import type { CSSProperties, ReactNode } from "react";

export type AuroraState = "off" | "run" | "wait" | "stop" | "done";

/** 입력창 바깥 띠(composer) 또는 지금 띠 바탕(strip) */
export type AuroraPlace = "composer" | "strip";

export function Aurora(props: {
  readonly state: AuroraState;
  readonly site: AuroraPlace;
  readonly style?: CSSProperties;
}): ReactNode {
  return (
    <div
      aria-hidden
      className="fx-aurora"
      data-state={props.state}
      data-site={props.site}
      style={props.style}
    >
      <span className="fx-aurora-blob" data-blob="a" />
      <span className="fx-aurora-blob" data-blob="b" />
      <span className="fx-aurora-blob" data-blob="c" />
      <span className="fx-aurora-wash" />
      <span className="fx-aurora-glint" />
    </div>
  );
}
