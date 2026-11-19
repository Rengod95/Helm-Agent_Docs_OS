// cvA 표식: 플러그인 종류 넷과 내부 재료의 선 그림(16px 격자, 선 1.5). 색은 부모의 `color`(종류의 빛)를 따른다.
// 그림만으로도 종류가 갈리게 뜻을 담는다: Inject는 아래로 들어가는 쐐기, Hook은 걸쇠, Drive는 앞으로 미는 겹화살, 도구는 꽂는 단자.
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import type { Kind, Unit } from "./model.ts";

const KIND_PATH: Readonly<Record<Kind, string>> = {
  inject: "M3 3.5h10L8 9.5zM3 12.5h10",
  hook: "M6 2v7.2a2.8 2.8 0 0 0 5.6 0V7.5M9.6 9.4l2-2 2 2",
  drive: "M2.5 3.5 7 8l-4.5 4.5M8 3.5 12.5 8 8 12.5",
  tool: "M5.5 2v3.2M10.5 2v3.2M3.5 5.2h9v2.6a4.5 4.5 0 0 1-9 0zM8 12.3V14",
};

const UNIT_PATH: Readonly<Record<Unit, string>> = {
  instruction: "M4 2.5h6l2.5 2.5v8.5H4zM6.3 7h4M6.3 9.5h4M6.3 12h2.5",
  skill: "M3 4.5 8 2l5 2.5L8 7zM3 8l5 2.5L13 8M3 11.5 8 14l5-2.5",
  memory:
    "M3.5 4c0-1 2-1.8 4.5-1.8s4.5.8 4.5 1.8v8c0 1-2 1.8-4.5 1.8S3.5 13 3.5 12zM3.5 4c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8",
  tool: "M10.5 2.5a3 3 0 0 0-3.2 4L2.8 11a1.4 1.4 0 0 0 2 2l4.5-4.5a3 3 0 0 0 4-3.2l-1.8 1.8-1.8-.5-.5-1.8z",
  server: "M3 3h10v4H3zM3 9h10v4H3zM5.2 5h.01M5.2 11h.01",
};

export function KindGlyph(props: { readonly kind: Kind; readonly size?: number }): ReactNode {
  const s = props.size ?? 16;
  return (
    <svg aria-hidden width={s} height={s} viewBox="0 0 16 16" className="shrink-0">
      <path
        d={KIND_PATH[props.kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UnitGlyph(props: { readonly unit: Unit; readonly size?: number }): ReactNode {
  const s = props.size ?? 16;
  return (
    <svg aria-hidden width={s} height={s} viewBox="0 0 16 16" className="shrink-0">
      <path
        d={UNIT_PATH[props.unit]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 단계(Drive의 자기 단계) 표식: 육각 */
export function StepGlyph(props: { readonly size?: number }): ReactNode {
  const s = props.size ?? 16;
  return (
    <svg aria-hidden width={s} height={s} viewBox="0 0 16 16" className="shrink-0">
      <path
        d="M5 2.5h6L14 8l-3 5.5H5L2 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 종류의 빛(CSS 변수). 종류와 상태에만 색이 든다 */
export const KIND_INK: Readonly<Record<Kind, string>> = {
  inject: "var(--cva-inject)",
  hook: "var(--cva-hook)",
  drive: "var(--cva-drive)",
  tool: "var(--cva-tool)",
};

/**
 * 노드 판의 윤곽(종류마다 다르다). 레일 쪽으로 닿는 곳이 튀어나온다: Inject는 아래 가운데 쐐기, Hook은 위 가운데 걸쇠,
 * Drive는 오른쪽이 앞으로 뾰족하고, 도구는 두 모서리를 깎은 판이다. 묶음(접힘)은 판 둘이 겹친다.
 */
export function platePath(shape: Kind | "group", w: number, h: number): string {
  const c = 6;
  const m = w / 2;
  switch (shape) {
    case "inject":
      return `M${c} 0H${w - c}L${w} ${c}V${h - c}L${w - c} ${h}H${m + 7}L${m} ${h + 6}L${m - 7} ${h}H${c}L0 ${h - c}V${c}Z`;
    case "hook":
      return `M${c} 0H${m - 7}L${m} -6L${m + 7} 0H${w - c}L${w} ${c}V${h - c}L${w - c} ${h}H${c}L0 ${h - c}V${c}Z`;
    case "drive":
      return `M${c} 0H${w - 14}L${w} ${h / 2}L${w - 14} ${h}H${c}L0 ${h - c}V${c}Z`;
    case "tool":
      return `M10 0H${w}V${h - 10}L${w - 10} ${h}H0V10Z`;
    case "group":
      return `M${c} 0H${w - c}L${w} ${c}V${h - c}L${w - c} ${h}H${c}L0 ${h - c}V${c}Z`;
    default:
      return assertNever(shape, "PlateShape");
  }
}
