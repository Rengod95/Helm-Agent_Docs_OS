// 종류 그림 넷(Inject·Hook·Drive·도구)과 그 타일. 색은 종류를 가르는 데만 쓴다(`viz.css`의 `--viz-<종류>`).
// 프로필 캔버스(cv3)와 같은 그림 말: Inject는 들어가는 화살, Hook은 문, Drive는 겹 갈매기, 도구는 플러그.
import { assertNever } from "@fresnel/contracts";
import type { SubjectKind } from "@fresnel/contracts/wire";
import type { CSSProperties, ReactNode } from "react";

export type Kind = "inject" | "hook" | "drive" | "tool" | "block";

export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--viz-inject)",
  hook: "var(--viz-hook)",
  drive: "var(--viz-drive)",
  tool: "var(--viz-tool)",
  block: "var(--cs-color-text-secondary)",
};

export function kindOfSubject(kind: SubjectKind): Kind {
  switch (kind) {
    case "instruction":
    case "skill":
      return "inject";
    case "tool":
      return "tool";
    case "hook":
      return "hook";
    case "drive":
      return "drive";
    case "block":
      return "block";
    default:
      return assertNever(kind, "SubjectKind");
  }
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function KindGlyph(props: { readonly kind: Kind; readonly size?: number }): ReactNode {
  const s = props.size ?? 12;
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {props.kind === "inject" ? (
        <g {...STROKE}>
          <path d="M1.5 6h6" />
          <path d="M5 3.5 7.5 6 5 8.5" />
          <path d="M10.25 2v8" />
        </g>
      ) : null}
      {props.kind === "hook" ? (
        <g {...STROKE}>
          <path d="M6 1.6 10.4 6 6 10.4 1.6 6Z" />
          <path d="M6 4.4v3.2" />
        </g>
      ) : null}
      {props.kind === "drive" ? (
        <g {...STROKE}>
          <path d="M2.2 2.6 5.6 6 2.2 9.4" />
          <path d="M6.4 2.6 9.8 6 6.4 9.4" />
        </g>
      ) : null}
      {props.kind === "tool" ? (
        <g {...STROKE}>
          <path d="M4.2 1.6v2.6M7.8 1.6v2.6" />
          <path d="M2.6 4.2h6.8v1.6a3.4 3.4 0 0 1-6.8 0Z" />
          <path d="M6 9.2v1.6" />
        </g>
      ) : null}
      {props.kind === "block" ? (
        <g {...STROKE}>
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
          <path d="M2 6h8" />
        </g>
      ) : null}
    </svg>
  );
}

/** 28px 아이콘 타일(받은 요청 카드의 타일 크기). 옅은 종류 색 바탕 + 종류 색 그림 */
export function KindTile(props: { readonly kind: Kind; readonly size?: number }): ReactNode {
  const size = props.size ?? 28;
  const color = KIND_COLOR[props.kind];
  const style: CSSProperties = {
    width: size,
    height: size,
    color,
    background: `color-mix(in oklab, ${color} 14%, transparent)`,
  };
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-lg"
      style={style}
    >
      <KindGlyph kind={props.kind} size={Math.round(size * 0.5)} />
    </span>
  );
}
