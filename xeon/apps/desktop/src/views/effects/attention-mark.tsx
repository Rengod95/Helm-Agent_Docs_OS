// 카드 주의 면(DP-190·191). "내 확인이 필요함"을 카드의 면으로 말한다. 받은 요청 카드와 승인 카드가 쓴다.
// 주의 구슬(AttentionMark, 호박 점 구슬)은 없앴다: 카드 머리는 요청 그림(illustrations/request-art.tsx, DP-210)이,
// 수가 있는 자리는 수만이 말한다(DP-211 [결정: 2026-11-15 사용자]). 별·느낌표·단색 점·고리로 돌아가지 않는다(시험 source-rules).
// 면의 짜임은 대화 입력창의 아래 변 빛(beam.tsx GlowPlate, beam.css)과 같다(lcMk4 [결정: 2026-11-19 사용자 "border쪽은 더 밝기 및 채도가 높아져서
// 우리 대화창의 이펙트 같은 느낌으로"]): 1px 고리 마스크 위의 빛깔 띠와 흰 심 알갱이(`.fx-glow-spark`), 안쪽으로 흐리게 번지는 덩이(`.fx-glow-cloud`),
// 다크는 더하기·라이트는 곱하기 섞기다. 입력창은 아래 변 전체지만 카드는 위 변의 가운데에서 가장 밝고 양쪽으로 사그라든다.

import type { CSSProperties, ReactNode } from "react";
import { useAttentionLive } from "./attention-budget.ts";
import { useFxScheme } from "./fx-scheme.ts";

/**
 * 카드 종류(오로라 빛깔 조합을 고른다, attention.css `[data-kind]`). 종류 칸의 중심색에서 출발해 이웃 색으로 번진다
 * [결정: 2026-11-19 사용자 "변경검토나 단순 질문이나, 가드 각각 다른 색이 중심인데, 각 중심색에 맞게 오로라의 색조합들도 각각 다르게"]:
 * review 변경 검토(보라 중심), question 질문(파랑 중심), tool 도구 승인(호박 중심),
 * proposal 받은 요청의 제안(크리스탈과 같은 오로라)
 */
export type AttendKind = "review" | "question" | "tool" | "proposal";

type SparkStyle = CSSProperties & {
  readonly "--x": string;
  readonly "--w": string;
  readonly "--c": string;
};

/** 띠와 덩이의 자리: 가운데가 중심색(a), 양쪽이 이웃 색(b·c). 중심색이 위에 그려지게 마지막에 둔다. 숨의 위상은 이웃끼리 다르다(입력창과 같은 키프레임) */
const SPOTS: readonly {
  readonly at: number;
  readonly tint: "a" | "b" | "c";
  readonly phase: number;
}[] = [
  { at: 0.34, tint: "b", phase: 1 },
  { at: 0.66, tint: "c", phase: 0 },
  { at: 0.5, tint: "a", phase: 3 },
];

function spotStyle(at: number, width: number, tint: "a" | "b" | "c"): SparkStyle {
  return {
    "--x": `${String(at * 100)}%`,
    "--w": `${String(width * 100)}%`,
    "--c": `var(--fx-attend-${tint})`,
  };
}

/**
 * 카드 주의 면의 겹. `.fx-attend-card`를 단 카드 안 첫 자식으로 둔다. 카드 바탕 위·글 아래에 깔린다.
 * `pending`이면 화면 전체에서 하나만(attention-budget) 입력창과 같은 결의 3.6초 숨을 세 번 쉬고 선다(쉬는 동안 프레임 0). 나머지는 같은 빛으로 멈춰 있다.
 * 위험 등급·거부 같은 뜻이 있는 색은 카드 안의 배지·단추가 그대로 낸다
 */
export function AttendGlow(props: {
  readonly pending: boolean;
  readonly kind: AttendKind;
}): ReactNode {
  const live = useAttentionLive("card", props.pending);
  const scheme = useFxScheme();
  if (!props.pending) return null;
  return (
    <span
      aria-hidden
      className="fx-attend-glow"
      data-kind={props.kind}
      data-scheme={scheme}
      data-live={live ? "true" : "false"}
    >
      <span className="fx-attend-bloom">
        {SPOTS.map((spot) => (
          <span
            key={spot.tint}
            className="fx-glow-cloud"
            data-phase={spot.phase}
            style={spotStyle(spot.at, spot.tint === "a" ? 0.5 : 0.28, spot.tint)}
          />
        ))}
      </span>
      <span className="fx-attend-edge">
        <span className="fx-attend-band" />
        {SPOTS.map((spot) => (
          <span
            key={spot.tint}
            className="fx-glow-spark"
            data-phase={spot.phase}
            style={spotStyle(spot.at, spot.tint === "a" ? 0.44 : 0.24, spot.tint)}
          />
        ))}
      </span>
    </span>
  );
}
