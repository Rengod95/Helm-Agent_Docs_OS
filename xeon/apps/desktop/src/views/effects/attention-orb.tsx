// 주의 구슬(DP-194a). 머리 줄 플레이그라운드 탭과 오른쪽 막대 플러그인 단추가 "사용자가 볼 것이 있다"를 같은 모양으로 말한다.
// 생각 구슬과 같은 점 구슬 식구(dot-orb.tsx의 DotOrb, 멈춘 한 장면, 12px, 따뜻한 잉크 하나)다. 자리(모서리)는 부르는 쪽이 className으로 준다.
// 뜻은 부르는 쪽의 이름(aria-label)이 말하고, 구슬은 aria-hidden이다. 고리, 별, 단색 맨 점, 느낌표는 쓰지 않는다.

import type { ReactNode } from "react";
import { DotOrb } from "./dot-orb.tsx";

/** 주의 구슬 한 개. 자리는 `className`(절대 위치 등)으로 받는다. 누름은 구슬을 지나 아래 요소가 받는다 */
export function AttentionOrb(props: { readonly className?: string }): ReactNode {
  const className =
    props.className === undefined
      ? "pointer-events-none inline-flex size-3 items-center justify-center"
      : `pointer-events-none inline-flex size-3 items-center justify-center ${props.className}`;
  return (
    <span aria-hidden="true" data-slot="attention-orb" className={className}>
      <DotOrb state="listening" tone="warm" size={12} kind="mark" live={false} />
    </span>
  );
}
