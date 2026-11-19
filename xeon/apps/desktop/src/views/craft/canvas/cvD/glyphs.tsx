// cvD 표식: 종류 배지(색만이 아니라 모양으로 갈린다), 결정 표식, 베이스 표식. 모두 단색 선 그림이다.
// 색은 종류마다 하나(caustic identity·agent 토큰)이고 배지 안의 그림에만 쓴다. 노드 몸통은 무채색이다.
import type { CSSProperties, ReactElement } from "react";
import type { Decision, Kind } from "./sample.ts";

/** 종류 색. 밝은 판에서는 같은 색을 어둡게 섞어 글자 대비를 지킨다(`--cvd-ink`가 판마다 다르다) */
export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--cvd-inject)",
  hook: "var(--cvd-hook)",
  drive: "var(--cvd-drive)",
  tool: "var(--cvd-tool)",
};

type KindVars = CSSProperties & {
  readonly "--cvd-inject": string;
  readonly "--cvd-hook": string;
  readonly "--cvd-drive": string;
  readonly "--cvd-tool": string;
};

/** 캔버스 뿌리에 거는 색 변수. 판(dark/light)마다 다르다 */
export function kindVars(theme: "dark" | "light"): KindVars {
  const mix = (token: string): string =>
    theme === "dark" ? `var(${token})` : `color-mix(in oklab, var(${token}) 72%, black)`;
  return {
    "--cvd-inject": mix("--cs-color-identity-iris"),
    "--cvd-hook": mix("--cs-color-identity-amber"),
    "--cvd-drive": mix("--cs-color-agent-stop-1"),
    "--cvd-tool": mix("--cs-color-identity-mint"),
  };
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** 12px 종류 그림: Inject는 판으로 들어가는 화살, Hook은 문(마름모), Drive는 겹 갈매기, 도구는 플러그 */
export function KindGlyph(props: { readonly kind: Kind; readonly size?: number }): ReactElement {
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

/**
 * 18px 배지. 보통은 옅은 바탕 + 색 그림, 가드는 꽉 찬 바탕, 드래프트는 점선 테두리만.
 */
export function KindBadge(props: {
  readonly kind: Kind;
  readonly guard?: boolean;
  readonly draft?: boolean;
  readonly size?: number;
}): ReactElement {
  const size = props.size ?? 18;
  const color = KIND_COLOR[props.kind];
  const style: CSSProperties = props.draft
    ? { color, border: `1px dashed ${color}`, width: size, height: size }
    : props.guard
      ? { color: "var(--cs-color-bg-canvas)", background: color, width: size, height: size }
      : {
          color,
          background: `color-mix(in oklab, ${color} 16%, transparent)`,
          width: size,
          height: size,
        };
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[4px]"
      style={style}
    >
      <KindGlyph kind={props.kind} size={Math.round(size * 0.66)} />
    </span>
  );
}

/** 10px 결정 표식: 막기(빗금 원), 대체(맞바꿈 화살), 묻기(말풍선) */
export function DecisionGlyph(props: { readonly decision: Decision }): ReactElement {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      {props.decision === "block" && (
        <g {...STROKE} strokeWidth={1.25}>
          <circle cx="5" cy="5" r="3.6" />
          <path d="M2.5 7.5 7.5 2.5" />
        </g>
      )}
      {props.decision === "replace" && (
        <g {...STROKE} strokeWidth={1.25}>
          <path d="M1.5 3.5h6M5.8 1.8 7.5 3.5 5.8 5.2" />
          <path d="M8.5 6.5h-6M4.2 4.8 2.5 6.5l1.7 1.7" />
        </g>
      )}
      {props.decision === "ask" && (
        <g {...STROKE} strokeWidth={1.25}>
          <path d="M1.5 2.2h7v4.6H5L3 8.6V6.8H1.5Z" />
        </g>
      )}
    </svg>
  );
}

/** 공용 선 그림 하나(정보, 닫기, 뒤로, 확대 등). 12·14·16px */
export type LineIcon =
  | "info"
  | "close"
  | "back"
  | "plus"
  | "minus"
  | "fit"
  | "chevron-down"
  | "chevron-right"
  | "grip"
  | "open"
  | "remove"
  | "left"
  | "right";

export function Icon(props: { readonly name: LineIcon; readonly size?: number }): ReactElement {
  const s = props.size ?? 14;
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g {...STROKE}>
        {props.name === "info" && (
          <>
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7.2v3.6" />
            <path d="M8 5.1v.1" strokeWidth={2} />
          </>
        )}
        {props.name === "close" && <path d="M4 4l8 8M12 4l-8 8" />}
        {props.name === "back" && <path d="M9.5 3.5 5 8l4.5 4.5" />}
        {props.name === "left" && <path d="M9.5 4 5.5 8l4 4" />}
        {props.name === "right" && <path d="M6.5 4l4 4-4 4" />}
        {props.name === "plus" && <path d="M8 3.5v9M3.5 8h9" />}
        {props.name === "minus" && <path d="M3.5 8h9" />}
        {props.name === "fit" && <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />}
        {props.name === "chevron-down" && <path d="M4.5 6.5 8 10l3.5-3.5" />}
        {props.name === "chevron-right" && <path d="M6.5 4.5 10 8l-3.5 3.5" />}
        {props.name === "open" && <path d="M6 3.5h6.5V10M12.5 3.5 5 11" />}
        {props.name === "remove" && <path d="M3.5 8h9M8 3.5v0" />}
        {props.name === "grip" && (
          <g strokeWidth={2}>
            <path d="M6 4v.1M10 4v.1M6 8v.1M10 8v.1M6 12v.1M10 12v.1" />
          </g>
        )}
      </g>
    </svg>
  );
}
