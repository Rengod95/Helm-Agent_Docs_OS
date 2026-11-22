import type { ReactNode } from "react";
import { LINE_GLYPH } from "../illustrations/line-glyph.ts";

// 그려지는 체크(dzM2 시안 §3·§7·§9). caustic Check(Solar linear)와 같은 획을 직접 그린 것이고, `draw`면 선이 220ms에 한 번 그려진다.
// 선은 직접 그린 아이콘의 한 벌(`LINE_GLYPH`, 화면 1px, AGE-34)이다. 크기가 1em이라 칸 좌표의 굵기는 non-scaling-stroke로 화면 px에 맞춘다.
// 상태가 바뀐 순간에만 `draw`를 준다(처음부터 끝난 줄은 그냥 체크). 움직임 줄이기에서는 바로 끝 모양이다(drawn-check.css).

export function DrawnCheck(props: {
  /** 선이 그려지며 나타난다 */
  readonly draw: boolean;
  readonly className?: string;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      {...LINE_GLYPH}
      aria-hidden
      data-slot="drawn-check"
      data-draw={props.draw ? "true" : undefined}
      className={`${LINE_GLYPH.className} fx-check ${props.className ?? ""}`}
    >
      <path d="M4 12.6111L8.92308 17.5L20 6.5" />
    </svg>
  );
}
