// 유리 조각의 모양과 결정 문양. 종류는 깎임(외곽선)과 빛 색으로 갈린다:
// Inject = 에메랄드 컷(네 모서리를 깎은 판), Hook = 양끝이 뾰족한 문(가로 마름모), Drive = 기운 결정(평행사변형), 도구 = 한 모서리를 크게 깎은 카트리지.
// 색은 CSS 변수(`--k-1..3`)로만 칠한다. 이 파일은 색 값을 갖지 않는다(cvB.css가 테마별로 정한다).
import { assertNever } from "@fresnel/contracts";
import { useId, type ReactNode } from "react";
import { KINDS, type Kind, type PartKind } from "./model.ts";

export type Shape = Kind | "group" | "part" | "frame";

/** 종류별 외곽선(w×h 상자 안) */
export function shapePath(shape: Shape, w: number, h: number): string {
  switch (shape) {
    case "inject": {
      const c = 10;
      return `M${c} 0 H${w - c} L${w} ${c} V${h - c} L${w - c} ${h} H${c} L0 ${h - c} V${c} Z`;
    }
    case "hook": {
      const p = 13;
      return `M${p} 0 H${w - p} L${w} ${h / 2} L${w - p} ${h} H${p} L0 ${h / 2} Z`;
    }
    case "drive": {
      const s = 14;
      return `M${s} 0 H${w} L${w - s} ${h} H0 Z`;
    }
    case "tool":
      return `M0 3 Q0 0 3 0 H${w - 18} L${w} 18 V${h - 3} Q${w} ${h} ${w - 3} ${h} H8 L0 ${h - 8} Z`;
    case "group": {
      const c = 14;
      return `M${c} 0 H${w - c} L${w} ${c} V${h - c} L${w - c} ${h} H${c} L0 ${h - c} V${c} Z`;
    }
    case "part": {
      const c = 7;
      return `M0 4 Q0 0 4 0 H${w - c} L${w} ${c} V${h - 4} Q${w} ${h} ${w - 4} ${h} H4 Q0 ${h} 0 ${h - 4} Z`;
    }
    case "frame": {
      const c = 22;
      return `M${c} 0 H${w - c} L${w} ${c} V${h - c} L${w - c} ${h} H${c} L0 ${h - c} V${c} Z`;
    }
    default:
      return assertNever(shape, "cvB.shapePath");
  }
}

/** 윗면의 꺾인 면(빛이 닿는 쪽). 외곽선 안에서 잘린다 */
function facetPath(shape: Shape, w: number, h: number): string {
  // 큰 판(내부 테두리)에서도 꺾임이 판을 덮지 않게 크기를 묶는다
  const fw = Math.min(w * 0.46, 150);
  const fh = Math.min(h * 0.46, 26);
  if (shape === "drive") return `M14 0 H${fw + 14} L${fw * 0.7 + 8} ${fh} H8 Z`;
  return `M0 0 H${fw} L${fw * 0.72} ${fh} L0 ${fh * 1.15} Z`;
}

/**
 * 유리 판 하나: 몸(단색 유리), 윗면 꺾임, 굴절된 가장자리 빛(rim), 바닥 받침(베이스).
 * 노드의 바탕으로 깔고 글은 그 위에 둔다. 장식이라 화면 읽기에서 숨긴다.
 */
export function GlassPlate(props: {
  readonly shape: Shape;
  readonly w: number;
  readonly h: number;
  readonly dashed?: boolean;
  readonly pedestal?: boolean;
}): ReactNode {
  const clip = useId();
  const d = shapePath(props.shape, props.w, props.h);
  return (
    <svg
      className="cvb-plate"
      width={props.w}
      height={props.h}
      viewBox={`0 0 ${props.w} ${props.h}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <path d={d} />
        </clipPath>
      </defs>
      <path className="cvb-plate-body" d={d} />
      <g clipPath={`url(#${clip})`}>
        <path className="cvb-plate-inner" d={d} />
        <path className="cvb-plate-facet" d={facetPath(props.shape, props.w, props.h)} />
        {props.pedestal === true && (
          <rect className="cvb-plate-pedestal" x={0} y={props.h - 4} width={props.w} height={4} />
        )}
        <path className="cvb-plate-sheen" d={d} />
      </g>
      <path className="cvb-plate-rim" d={d} data-dashed={props.dashed === true ? "" : undefined} />
    </svg>
  );
}

/** 결정 문양(20×20). 면 셋을 밝기 셋으로 칠한다 */
export function Gem(props: { readonly kind: Kind | "group"; readonly size?: number }): ReactNode {
  const size = props.size ?? 20;
  return (
    <svg
      className="cvb-gem"
      data-kind={props.kind}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      {gemFacets(props.kind)}
    </svg>
  );
}

function gemFacets(kind: Kind | "group"): ReactNode {
  switch (kind) {
    case "inject":
      // 붓는 결정(아래로 선 삼각)
      return (
        <>
          <path className="cvb-f1" d="M2 4 H18 L14 8 H6 Z" />
          <path className="cvb-f2" d="M2 4 L6 8 L10 18 Z" />
          <path className="cvb-f3" d="M18 4 L14 8 L10 18 Z" />
          <path className="cvb-f2" d="M6 8 H14 L10 18 Z" opacity="0.7" />
        </>
      );
    case "hook":
      // 문(마름모)
      return (
        <>
          <path className="cvb-f1" d="M10 1.5 L1.5 10 H10 Z" />
          <path className="cvb-f2" d="M10 1.5 L18.5 10 H10 Z" />
          <path className="cvb-f2" d="M1.5 10 L10 18.5 V10 Z" />
          <path className="cvb-f3" d="M18.5 10 L10 18.5 V10 Z" />
        </>
      );
    case "drive":
      // 기운 결정 둘(턴을 쥐는 조각)
      return (
        <>
          <path className="cvb-f1" d="M8.5 1.5 H15 L11 10 H4.5 Z" />
          <path className="cvb-f3" d="M4.5 10 H11 L8 18.5 H1.5 Z" opacity="0.9" />
          <path className="cvb-f2" d="M13 10.5 H18.5 L15.5 18.5 H10 Z" />
        </>
      );
    case "tool":
      // 육면체
      return (
        <>
          <path className="cvb-f1" d="M10 1.5 L18 6 L10 10.5 L2 6 Z" />
          <path className="cvb-f2" d="M2 6 L10 10.5 V18.5 L2 14 Z" />
          <path className="cvb-f3" d="M18 6 L10 10.5 V18.5 L18 14 Z" />
        </>
      );
    case "group":
      // 결정 무리(작은 마름모 셋)
      return (
        <>
          <path className="cvb-f2" d="M6 3 L10 7.5 L6 12 L2 7.5 Z" />
          <path className="cvb-f1" d="M14 3 L18 7.5 L14 12 L10 7.5 Z" />
          <path className="cvb-f3" d="M10 9 L14 13.5 L10 18 L6 13.5 Z" />
        </>
      );
    default:
      return assertNever(kind, "cvB.gemFacets");
  }
}

/** 구성 요소 문양(16×16, 무채색 선). 플러그인 내부의 조각마다 */
export function PartGlyph(props: { readonly kind: PartKind | "station" }): ReactNode {
  return (
    <svg
      className="cvb-part-glyph"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {partLines(props.kind)}
    </svg>
  );
}

function partLines(kind: PartKind | "station"): ReactNode {
  switch (kind) {
    case "rule":
      return <path d="M4 2.5 H10 L12.5 5 V13.5 H4 Z M6 7.5 H10.5 M6 10 H10.5" />;
    case "skill":
      return (
        <path d="M8 2 L13.5 5.25 V10.75 L8 14 L2.5 10.75 V5.25 Z M8 5.5 L10.5 8 L8 10.5 L5.5 8 Z" />
      );
    case "memory":
      return (
        <path d="M3 4.5 C3 3 13 3 13 4.5 V11.5 C13 13 3 13 3 11.5 Z M3 4.5 C3 6 13 6 13 4.5 M3 8 C3 9.5 13 9.5 13 8" />
      );
    case "mcp":
      return <path d="M2.5 3 H13.5 V7 H2.5 Z M2.5 9 H13.5 V13 H2.5 Z M5 5 H5.5 M5 11 H5.5" />;
    case "handler":
      return <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z M4.5 8 H11.5" />;
    case "step":
      return <path d="M3 8 H11 M8.5 5 L11.5 8 L8.5 11 M13.5 3.5 V12.5" />;
    case "handoff":
      return <path d="M2 10.5 C5 4 11 4 14 10.5 M11.5 9 L14 10.5 L14.5 7.5" />;
    case "setting":
      return <path d="M2.5 5 H13.5 M2.5 11 H13.5 M10 3 V7 M6 9 V13" />;
    case "permission":
      return (
        <path d="M8 1.75 L13.25 3.75 V8 C13.25 11 10.75 13.25 8 14.25 C5.25 13.25 2.75 11 2.75 8 V3.75 Z" />
      );
    case "station":
      return <path d="M2 5 H5 M2 5 V11 H5 M14 5 H11 M14 5 V11 H11 M0.5 8 H15.5" />;
    default:
      return assertNever(kind, "cvB.partLines");
  }
}

/** 문서 전체에서 쓰는 그라데이션(종류별 가장자리 빛, 윗면 광택). 화면마다 한 번 둔다 */
export function GlassDefs(): ReactNode {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {KINDS.map((kind) => (
          <linearGradient
            key={kind}
            id={`cvb-rim-${kind}`}
            className="cvb-rim-defs"
            data-kind={kind}
            x1="0"
            y1="0"
            x2="1"
            y2="1"
          >
            <stop offset="0" data-s="1" />
            <stop offset="0.28" data-s="g" />
            <stop offset="0.55" data-s="2" />
            <stop offset="1" data-s="3" />
          </linearGradient>
        ))}
        <linearGradient id="cvb-sheen" className="cvb-sheen-defs" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" data-s="top" />
          <stop offset="0.55" data-s="clear" />
        </linearGradient>
      </defs>
    </svg>
  );
}
