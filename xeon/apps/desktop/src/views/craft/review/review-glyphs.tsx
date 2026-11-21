import type { ReactElement } from "react";
import { LINE_GLYPH } from "../../illustrations/line-glyph.ts";
import type { PluginKind } from "./review-model.ts";

// 종류 그림(캔버스 cv3와 같은 넷: Inject 들어가는 화살, Hook 문, Drive 겹 갈매기, 도구 플러그). 색은 `review.css`의
// `.rv-kind-<종류>`가 정하고 그림은 currentColor다. 그림은 뜻을 글이 함께 말하므로 낭독기에서 뺀다.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function KindGlyph(props: {
  readonly kind: PluginKind;
  readonly size?: number;
}): ReactElement {
  const s = props.size ?? 12;
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {props.kind === "inject" && (
        <g {...STROKE}>
          <path d="M1.5 6h6" />
          <path d="M5 3.5 7.5 6 5 8.5" />
          <path d="M10.25 2v8" />
        </g>
      )}
      {props.kind === "hook" && (
        <g {...STROKE}>
          <path d="M6 1.6 10.4 6 6 10.4 1.6 6Z" />
          <path d="M6 4.4v3.2" />
        </g>
      )}
      {props.kind === "drive" && (
        <g {...STROKE}>
          <path d="M2.2 2.6 5.6 6 2.2 9.4" />
          <path d="M6.4 2.6 9.8 6 6.4 9.4" />
        </g>
      )}
      {props.kind === "tool" && (
        <g {...STROKE}>
          <path d="M4.2 1.6v2.6M7.8 1.6v2.6" />
          <path d="M2.6 4.2h6.8v1.6a3.4 3.4 0 0 1-6.8 0Z" />
          <path d="M6 9.2v1.6" />
        </g>
      )}
    </svg>
  );
}

const TILE_CLASS: Readonly<Record<28 | 20 | 16, string>> = {
  28: "size-7 rounded-lg",
  20: "size-5 rounded-md",
  16: "size-4 rounded-sm",
};
const GLYPH_SIZE: Readonly<Record<28 | 20 | 16, number>> = { 28: 15, 20: 11, 16: 10 };

/** 종류 타일. 28은 받은 요청 카드 머리의 아이콘 타일과 같은 크기, 16은 목록 줄의 아이콘 자리다 */
export function KindTile(props: {
  readonly kind: PluginKind;
  readonly size: 28 | 20 | 16;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`rv-kind-${props.kind} rv-tile inline-grid shrink-0 place-items-center ${TILE_CLASS[props.size]}`}
    >
      <KindGlyph kind={props.kind} size={GLYPH_SIZE[props.size]} />
    </span>
  );
}

/** 주의 세모: 꼭짓점마다 1.5 앞에서 곡선으로 꺾는다 */
const TRIANGLE =
  "M8.75 3.5 L13.55 11.9 Q14.3 13.2 12.8 13.2 L3.2 13.2 Q1.7 13.2 2.45 11.9 L7.25 3.5 Q8 2.2 8.75 3.5Z";
/** 막힘 팔각형: 꼭짓점마다 0.6 앞에서 꺾는다(더 둥글리면 고리로 읽힌다) */
const OCTAGON =
  "M6.2 1.9 H9.8 Q10.4 1.9 10.82 2.32 L13.68 5.18 Q14.1 5.6 14.1 6.2 V9.8 Q14.1 10.4 13.68 10.82 L10.82 13.68 Q10.4 14.1 9.8 14.1 H6.2 Q5.6 14.1 5.18 13.68 L2.32 10.82 Q1.9 10.4 1.9 9.8 V6.2 Q1.9 5.6 2.32 5.18 L5.18 2.32 Q5.6 1.9 6.2 1.9Z";
/** 알림의 세기(앱의 알림 토스트 tone과 같은 이름). `review-parts.tsx`의 `NoticeTone`이 이 타입이다 */
export type ToneName = "info" | "warning" | "danger" | "success" | "neutral";

/**
 * 알림 그림(m6R5). 이 화면의 알림은 느낌표를 쓰지 않는다 [결정: 2026-11-20 사용자 "2-나"]. 고리(원), 별, 점도 쓰지 않는다.
 * 세기는 색과 모양 둘로 갈린다: 막힘은 팔각형(멈춤 표지)에 가로 막대, 주의는 빈 세모, 안내는 쪽지(둥근 네모에 글 두 줄),
 * 끝남은 맨 체크. 소식(neutral)은 안내와 같은 쪽지를 흐린 색으로 쓴다. 색은 부르는 쪽이 currentColor로 준다. 16 칸.
 * 선은 빈 상태 그림의 바탕(`LINE_GLYPH`, 화면 1.15px)이고 모양도 그 문법을 따른다(m6R7): 세모와 팔각형의 꼭짓점은 짧은 곡선으로 둥글리고,
 * 쪽지 모서리는 2.5다. 쪽지의 글 줄은 곧은 두 줄이다: InspectArt의 물결 글 줄을 16 칸에 줄이면 "≈"로 읽혀 버렸다
 */
export function ToneGlyph(props: { readonly tone: ToneName }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      data-tone-glyph={props.tone}
      {...LINE_GLYPH}
    >
      {props.tone === "danger" && (
        <>
          <path d={OCTAGON} />
          <path d="M5.4 8h5.2" />
        </>
      )}
      {props.tone === "warning" && <path d={TRIANGLE} />}
      {(props.tone === "info" || props.tone === "neutral") && (
        <>
          <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" />
          <path d="M5.25 6.5h5.5M5.25 9.5h3.5" />
        </>
      )}
      {props.tone === "success" && <path d="M3.2 8.4 6.4 11.4 12.8 4.6" />}
    </svg>
  );
}
