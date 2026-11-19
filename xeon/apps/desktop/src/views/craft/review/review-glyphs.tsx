import type { ReactElement } from "react";
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
