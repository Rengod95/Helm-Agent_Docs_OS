// cvF 표식: 종류 그림(색과 아이콘), 종류마다 다른 카드 윤곽, 결정 표식, 관계 선의 끝 기호.
// 색은 종류를 가르는 데만 쓴다(그림, 왼쪽 가는 띠). 채도는 caustic identity 토큰 그대로이고 밝은 판에서는 검정과 섞어 대비를 지킨다.
import { assertNever } from "@fresnel/contracts";
import type { CSSProperties, ReactElement } from "react";
import type { Kind } from "./model.ts";

export const KIND_COLOR: Readonly<Record<Kind, string>> = {
  inject: "var(--cvf-inject)",
  hook: "var(--cvf-hook)",
  drive: "var(--cvf-drive)",
  tool: "var(--cvf-tool)",
};

type KindVars = CSSProperties & {
  readonly "--cvf-inject": string;
  readonly "--cvf-hook": string;
  readonly "--cvf-drive": string;
  readonly "--cvf-tool": string;
};

/** 캔버스 뿌리에 거는 종류 색. 판(dark/light)마다 다르다 */
export function kindVars(theme: "dark" | "light"): KindVars {
  const mix = (token: string): string =>
    theme === "dark"
      ? `color-mix(in oklab, var(${token}) 86%, var(--cs-color-text-primary))`
      : `color-mix(in oklab, var(${token}) 70%, black)`;
  return {
    "--cvf-inject": mix("--cs-color-identity-iris"),
    "--cvf-hook": mix("--cs-color-identity-amber"),
    "--cvf-drive": mix("--cs-color-agent-stop-1"),
    "--cvf-tool": mix("--cs-color-identity-mint"),
  };
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** 12칸 종류 그림: Inject는 판으로 들어가는 화살, Hook은 문(마름모), Drive는 겹 갈매기, 도구는 플러그 */
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

/** 종류 타일: 옅은 바탕 + 색 그림. 드래프트(리뷰 전)는 점선 테두리만 */
export function KindTile(props: {
  readonly kind: Kind;
  readonly size?: number;
  readonly draft?: boolean;
}): ReactElement {
  const size = props.size ?? 20;
  const color = KIND_COLOR[props.kind];
  const style: CSSProperties =
    props.draft === true
      ? { color, border: `1px dashed ${color}`, width: size, height: size }
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
      <KindGlyph kind={props.kind} size={Math.round(size * 0.64)} />
    </span>
  );
}

/** 10칸 결정 표식: 막기(빗금 원), 대체(맞바꿈 화살), 묻기(말풍선) */
export function DecisionGlyph(props: {
  readonly decision: "block" | "replace" | "ask";
  readonly size?: number;
}): ReactElement {
  const s = props.size ?? 10;
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
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

/**
 * 종류마다 다른 카드 윤곽(w×h, 흐름 px). 도면의 부품 기호처럼 닿는 쪽에 모양이 있다:
 *   Inject: 오른쪽 위 귀를 접은 종이(블록에 넣는 재료), Hook: 레일 쪽(위) 가운데에 탭(문의 걸쇠),
 *   Drive: 오른쪽 끝이 화살촉(턴을 끌고 간다), 도구: 레일 쪽(아래)에 플러그 다리 둘.
 */
export function outlinePath(kind: Kind, w: number, h: number): string {
  const r = 6;
  switch (kind) {
    case "inject": {
      const f = 16;
      return `M${r} 0H${w - f}L${w} ${f}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
    }
    case "hook": {
      const t = 22;
      const c = w / 2;
      return `M${r} 0H${c - t}L${c - t + 6} -7H${c + t - 6}L${c + t} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
    }
    case "drive": {
      const a = 14;
      return `M${r} 0H${w - a}L${w} ${h / 2}L${w - a} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
    }
    case "tool": {
      const c = w / 2;
      return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${c + 13}V${h + 7}H${c + 7}V${h}H${c - 7}V${h + 7}H${c - 13}V${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
    }
    default:
      return assertNever(kind, "cvF outlinePath");
  }
}

/** Inject 귀의 접힌 선 */
export function earPath(w: number): string {
  const f = 16;
  return `M${w - f} 0V${f}H${w}`;
}

/** 관계 선의 끝 기호(도면 기호): 핸드오프는 찬 화살, 의존은 빈 원(받는 쪽), 대체는 빈 마름모 */
export function RelationMarkers(props: { readonly prefix?: string }): ReactElement {
  // 안 판과 캔버스가 함께 마운트되므로(캔버스는 숨긴 채) 판마다 id를 따로 쓴다
  const p = props.prefix ?? "cvf-m";
  return (
    <svg width={0} height={0} aria-hidden="true" focusable="false" className="cvf-markers">
      <defs>
        <marker
          id={`${p}-arrow`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="14"
          markerHeight="14"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1 1.5 9 5 1 8.5Z" className="cvf-marker-fill" />
        </marker>
        <marker
          id={`${p}-circle`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="14"
          markerHeight="14"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <circle cx="5" cy="5" r="3.6" className="cvf-marker-hollow" />
        </marker>
        <marker
          id={`${p}-diamond`}
          viewBox="0 0 12 10"
          refX="11"
          refY="5"
          markerWidth="17"
          markerHeight="14"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1 5 6 1.4 11 5 6 8.6Z" className="cvf-marker-hollow" />
        </marker>
        <marker
          id={`${p}-tick`}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M5 1v8" className="cvf-marker-line" />
        </marker>
      </defs>
    </svg>
  );
}
