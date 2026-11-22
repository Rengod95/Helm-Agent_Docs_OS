import type { ReactNode } from "react";
import { useAttentionLive } from "../effects/attention-budget.ts";

// 요청 그림(DP-210 [결정: 2026-11-15 사용자 "페이지 레벨에서 사용되는 이런 아이콘 디자인 스타일의 아이콘으로", dzN2]).
// 빈 상태 그림(index.tsx)과 같은 손으로 20 칸에 다시 그린 작은 판이다: 면 없는 가는 선(1.1), 윤곽은 글 색 60%,
// 나란한 두 가닥(앞 100%, 뒤 40%), 강조색(`accent-graphic`)은 가닥을 따라 흐르는 빛 한 획뿐이다.
// 처음 나타날 때 가닥이 한 번 그려지고, 그 뒤 빛이 7초에 한 번 흐른다. 흐르는 수는 attention-budget의 mark 상한(3)이고,
// 넘거나 움직임을 줄이면(OS·앱 설정) 다 그려진 멈춘 그림이다. 색은 부르는 쪽의 글 색(currentColor)을 따른다.
// 종류: proposal 전구(ProposalArt의 축소), approval 받은 편지함(InboxArt의 축소). 뜻은 부르는 쪽이 글로 말한다(aria-hidden).

const ACCENT = "var(--cs-color-accent-graphic)";

export type RequestArtKind = "proposal" | "approval";

const SHAPES: Readonly<
  Record<RequestArtKind, { readonly outline: readonly string[]; readonly strand: string }>
> = {
  proposal: {
    outline: [
      "M10 2.8 C13 2.8 15.2 5 15.2 7.8 C15.2 9.7 14.2 10.9 13.1 12 C12.6 12.5 12.5 13.1 12.5 13.8 H7.5 C7.5 13.1 7.4 12.5 6.9 12 C5.8 10.9 4.8 9.7 4.8 7.8 C4.8 5 7 2.8 10 2.8 Z",
      "M8.1 16 H11.9 M8.9 17.7 H11.1",
    ],
    strand: "M7.3 10.6 C8.1 7.4 9.5 11.4 10.5 8.5 S12.1 6.7 12.6 6",
  },
  approval: {
    outline: [
      "M3 12 L5.2 5.6 H14.8 L17 12 V15 C17 15.9 16.4 16.6 15.5 16.6 H4.5 C3.6 16.6 3 15.9 3 15 Z",
      "M3 12 H7 C7.4 12 7.6 12.3 7.6 12.7 C7.6 13.8 8.6 14.4 10 14.4 C11.4 14.4 12.4 13.8 12.4 12.7 C12.4 12.3 12.6 12 13 12 H17",
    ],
    strand: "M5.9 9.2 C7.5 7.2 8.9 10.8 10.4 8.8 S13 7.2 14.1 8.4",
  },
};

/** 앞 가닥과 뒤 가닥 사이(20 칸 좌표) */
const STRAND_GAP = 1.5;

export function RequestArt(props: {
  readonly kind: RequestArtKind;
  /** 화면 px. 카드 머리 20, 줄 상태 칸 16 */
  readonly size?: 16 | 20;
  /** false면 처음부터 다 그려진 멈춘 그림이다(여러 줄에 같은 그림이 설 때) */
  readonly live?: boolean;
  readonly className?: string;
}): ReactNode {
  const size = props.size ?? 20;
  const live = useAttentionLive("mark", props.live !== false);
  const shape = SHAPES[props.kind];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="request-art"
      data-kind={props.kind}
      data-live={live ? "true" : "false"}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      // 20 좌표를 size px로 보인다. 윤곽과 가닥은 어느 크기에서도 화면 1px다(AGE-34). 흐르는 빛만 효과라 더 굵다
      strokeWidth={20 / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`request-art${props.className === undefined ? "" : ` ${props.className}`}`}
    >
      {shape.outline.map((d) => (
        <path key={d} d={d} opacity={0.6} />
      ))}
      <path d={shape.strand} pathLength={1} className="request-art-strand" />
      <path
        d={shape.strand}
        pathLength={1}
        transform={`translate(0 ${STRAND_GAP})`}
        opacity={0.4}
        className="request-art-strand"
      />
      {live ? (
        <path
          d={shape.strand}
          pathLength={1}
          stroke={ACCENT}
          strokeWidth={1.5}
          className="request-art-light"
        />
      ) : null}
    </svg>
  );
}
