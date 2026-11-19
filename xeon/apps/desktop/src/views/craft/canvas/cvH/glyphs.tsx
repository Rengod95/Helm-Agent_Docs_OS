// cvH 표식: 종류 그림(D의 모양을 이어받는다: Inject 화살, Hook 마름모, Drive 겹 갈매기, 도구 플러그), 결정, 위험 눈금, 작은 선 그림.
// 색은 종류 넷에만 쓴다(`--cvh-inject` 등, cvH.css가 판마다 채도를 누른다). 나머지는 무채색이다.
import type { CSSProperties, ReactElement } from "react";
import type { SharedRisk } from "../shared-sample.ts";
import type { Kind } from "./model.ts";

export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--cvh-inject)",
  hook: "var(--cvh-hook)",
  drive: "var(--cvh-drive)",
  tool: "var(--cvh-tool)",
};

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

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

/** 종류 배지: 옅은 바탕 + 색 그림. 드래프트는 점선 테두리만, 가드는 꽉 찬 바탕 */
export function KindBadge(props: {
  readonly kind: Kind;
  readonly size?: number;
  readonly draft?: boolean;
  readonly guard?: boolean;
}): ReactElement {
  const size = props.size ?? 20;
  const color = KIND_COLOR[props.kind];
  const style: CSSProperties =
    props.draft === true
      ? { color, border: `1px dashed ${color}`, width: size, height: size }
      : props.guard === true
        ? { color: "var(--cvh-ground)", background: color, width: size, height: size }
        : {
            color,
            background: `color-mix(in oklab, ${color} 15%, transparent)`,
            width: size,
            height: size,
          };
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[5px]"
      style={style}
    >
      <KindGlyph kind={props.kind} size={Math.round(size * 0.62)} />
    </span>
  );
}

export type GlyphName =
  | "block"
  | "replace"
  | "ask"
  | "lock"
  | "loop"
  | "group"
  | "close"
  | "enter"
  | "up"
  | "down"
  | "left"
  | "right"
  | "plus"
  | "minus"
  | "fit"
  | "relations"
  | "play"
  | "trash"
  | "drag"
  | "warn"
  | "doc"
  | "skill"
  | "server"
  | "setting"
  | "shield"
  | "handoff"
  | "start"
  | "fold"
  | "unfold"
  | "seed";

/** 12 격자의 선 그림 */
export function Glyph(props: { readonly name: GlyphName; readonly size?: number }): ReactElement {
  const s = props.size ?? 12;
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <g {...STROKE} strokeWidth={1.3}>
        {props.name === "block" && (
          <>
            <circle cx="6" cy="6" r="4.2" />
            <path d="M3 9 9 3" />
          </>
        )}
        {props.name === "replace" && (
          <path d="M2 4h7.2M7.4 2.2 9.2 4 7.4 5.8M10 8H2.8M4.6 6.2 2.8 8l1.8 1.8" />
        )}
        {props.name === "ask" && (
          <path d="M2 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5.5L3 10V8a1 1 0 0 1-1-1Z" />
        )}
        {props.name === "lock" && (
          <>
            <rect x="2.5" y="5.4" width="7" height="4.6" rx="1" />
            <path d="M4 5.4V4a2 2 0 0 1 4 0v1.4" />
          </>
        )}
        {props.name === "loop" && (
          <>
            <path d="M9.6 6a3.6 3.6 0 1 1-1.05-2.55" />
            <path d="M9.2 1.8v2.1H7.1" />
          </>
        )}
        {props.name === "group" && (
          <>
            <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2" />
            <path d="M4 6h4M6 4v4" />
          </>
        )}
        {props.name === "close" && <path d="M3 3l6 6M9 3 3 9" />}
        {props.name === "enter" && <path d="M2 6h6.5M6.5 3.5 9 6 6.5 8.5M10.2 2v8" />}
        {props.name === "up" && <path d="M3 7.5 6 4.5l3 3" />}
        {props.name === "down" && <path d="M3 4.5 6 7.5l3-3" />}
        {props.name === "left" && <path d="M7.5 3 4.5 6l3 3" />}
        {props.name === "right" && <path d="M4.5 3 7.5 6l-3 3" />}
        {props.name === "plus" && <path d="M6 2.5v7M2.5 6h7" />}
        {props.name === "minus" && <path d="M2.5 6h7" />}
        {props.name === "fit" && <path d="M2 4.5V2h2.5M7.5 2H10v2.5M10 7.5V10H7.5M4.5 10H2V7.5" />}
        {props.name === "relations" && (
          <>
            <circle cx="2.8" cy="9" r="1.3" />
            <circle cx="9.2" cy="3" r="1.3" />
            <path d="M3.8 8C5 5 6.5 4.2 8.1 3.6" strokeDasharray="1.6 1.6" />
          </>
        )}
        {props.name === "play" && <path d="M3.5 2.5v7l6-3.5Z" />}
        {props.name === "trash" && (
          <path d="M2.5 3.5h7M4.5 3.5V2.2h3v1.3M3.5 3.5l.5 6.3h4l.5-6.3" />
        )}
        {props.name === "drag" && (
          <path d="M4.5 3h.01M7.5 3h.01M4.5 6h.01M7.5 6h.01M4.5 9h.01M7.5 9h.01" strokeWidth={2} />
        )}
        {props.name === "warn" && (
          <>
            <path d="M6 1.8 10.6 10H1.4Z" />
            <path d="M6 5v2.2M6 8.6h.01" />
          </>
        )}
        {props.name === "doc" && <path d="M3 1.8h4l2 2v6.4H3ZM7 1.8v2h2M4.6 6.2h2.8M4.6 8h2.8" />}
        {props.name === "skill" && (
          <path d="M2.2 3.2h3.3v6.6H2.2ZM6.5 3.2h3.3v6.6H6.5ZM2.2 5.2h3.3M6.5 5.2h3.3" />
        )}
        {props.name === "server" && (
          <>
            <rect x="2" y="2" width="8" height="3.4" rx="0.8" />
            <rect x="2" y="6.6" width="8" height="3.4" rx="0.8" />
            <path d="M4 3.7h.01M4 8.3h.01" strokeWidth={1.8} />
          </>
        )}
        {props.name === "setting" && (
          <path d="M2 3.5h4M8 3.5h2M2 8.5h1.5M5.5 8.5H10M7 2v3M4.5 7v3" />
        )}
        {props.name === "shield" && (
          <path d="M6 1.6 9.8 3v3.2c0 2.2-1.6 3.6-3.8 4.2-2.2-.6-3.8-2-3.8-4.2V3Z" />
        )}
        {props.name === "handoff" && (
          <path d="M2 8.5c2.5 0 3-5 6.6-5M6.8 1.8 8.6 3.5 6.8 5.2M8.8 10H10" strokeDasharray="0" />
        )}
        {props.name === "start" && <path d="M3 2v8M3 2.4h6l-1.6 2 1.6 2H3" />}
        {props.name === "fold" && <path d="M2.5 4.5 6 2l3.5 2.5M2.5 7.5 6 10l3.5-2.5" />}
        {props.name === "unfold" && <path d="M2.5 2.5 6 5l3.5-2.5M2.5 9.5 6 7l3.5 2.5" />}
        {props.name === "seed" && (
          <>
            <circle cx="6" cy="6" r="2" />
            <path d="M6 1.5v1.6M6 8.9v1.6M1.5 6h1.6M8.9 6h1.6" />
          </>
        )}
      </g>
    </svg>
  );
}

const RISK_STEPS: readonly SharedRisk[] = ["none", "read", "write", "exec"];

/** 위험 눈금 네 칸. 쓰기부터 경고 색, 실행은 위험 색(경고는 보이게) */
export function RiskGauge(props: {
  readonly risk: SharedRisk;
  readonly wide?: boolean;
}): ReactElement {
  const level = RISK_STEPS.indexOf(props.risk);
  const tone =
    props.risk === "exec"
      ? "var(--cs-color-danger-text, var(--cs-color-warning-text))"
      : props.risk === "write"
        ? "var(--cs-color-warning-text)"
        : "var(--cvh-ink-2)";
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-[2px]">
      {RISK_STEPS.map((step, i) => (
        <span
          key={step}
          className="inline-block rounded-[1px]"
          style={{
            width: props.wide === true ? 14 : 6,
            height: props.wide === true ? 5 : 8,
            background: i <= level && level > 0 ? tone : "var(--cvh-hair)",
          }}
        />
      ))}
    </span>
  );
}
