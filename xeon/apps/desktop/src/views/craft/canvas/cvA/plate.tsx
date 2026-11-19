// cvA 노드의 판(윤곽 SVG)과 조준 표식. 판 위의 글은 부르는 쪽이 놓는다.
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import { platePath } from "./glyphs.tsx";
import type { Kind } from "./model.ts";

function touchPath(shape: Kind | "group", w: number, h: number): string {
  const m = w / 2;
  switch (shape) {
    case "inject":
      return `M${m - 7} ${h}L${m} ${h + 6}L${m + 7} ${h}`;
    case "hook":
      return `M${m - 7} 0L${m} -6L${m + 7} 0`;
    case "drive":
      return `M${w - 14} 0L${w} ${h / 2}L${w - 14} ${h}`;
    case "tool":
      return `M0 10L10 0M${w} ${h - 10}L${w - 10} ${h}`;
    case "group":
      return "";
    default:
      return assertNever(shape, "PlateShape");
  }
}

/**
 * 판 하나. `base`면 왼쪽 안에 두 줄(베이스에 박힌 것), `stacked`면 뒤에 판이 하나 더 겹친다(묶음).
 * 닿는 곳만 종류의 빛(`--cva-ink`)을 받는다.
 */
export function Plate(props: {
  readonly shape: Kind | "group";
  readonly w: number;
  readonly h: number;
  readonly base?: boolean;
  readonly stacked?: boolean;
}): ReactNode {
  const { shape, w, h } = props;
  const d = platePath(shape, w, h);
  const touch = touchPath(shape, w, h);
  return (
    <svg aria-hidden className="cva-plate-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {props.stacked === true ? (
        <g transform="translate(5 -5)">
          <path className="cva-plate-fill" d={d} />
          <path className="cva-plate-line" d={d} opacity={0.55} />
        </g>
      ) : null}
      <path className="cva-plate-fill" d={d} />
      <path className="cva-plate-line" d={d} />
      {touch === "" ? null : <path className="cva-plate-touch" d={touch} />}
      {props.base === true ? (
        <path
          d={`M5 11V${h - 11}M8 11V${h - 11}`}
          stroke="var(--cva-line-hot)"
          strokeWidth={1}
          fill="none"
        />
      ) : null}
    </svg>
  );
}

/** 고른 것의 조준 표식: 바깥 네 귀퉁이 */
export function Reticle(props: {
  readonly w: number;
  readonly h: number;
  readonly arm?: number;
}): ReactNode {
  const a = props.arm ?? 7;
  const w = props.w + 14;
  const h = props.h + 14;
  return (
    <svg aria-hidden className="cva-reticle" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path
        d={`M0 ${a}V0H${a}M${w - a} 0H${w}V${a}M${w} ${h - a}V${h}H${w - a}M${a} ${h}H0V${h - a}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
      />
    </svg>
  );
}
