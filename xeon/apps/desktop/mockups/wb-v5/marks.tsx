// 점의 모양과 색. 층은 모양으로(L1 네모, L2 동그라미, L3 마름모, 외부 세모), 그룹은 색 하나(남보라)로 가른다.
// 깊이는 없다: 면은 한 색이고 그림자와 번짐은 사방으로 같다. 위·아래를 가르는 빛은 쓰지 않는다.
// 상태는 모양과 무관하게 같은 방식이다: 꺼짐 = 속이 빔, 실패 = 붉은 색(고리 없음), 고름 = 바깥 검은 선이 용수철로 앉는다.
import type { LayerKey } from "./data";

export type Shape = "square" | "circle" | "diamond" | "triangle";
export const SHAPE_OF: Record<LayerKey, Shape> = {
  L1: "square",
  L2: "circle",
  L3: "diamond",
  plugin: "triangle",
};

/** 그룹 색: caustic info 계열 하나. 밝은 판과 어두운 판 모두 토큰이 따라온다. 실패색(danger)과는 색상이 다르다. */
export const GRP = {
  graphic: "var(--cs-color-info-graphic)",
  mark: "var(--cs-color-info-border-strong)",
  border: "var(--cs-color-info-border)",
  soft: "var(--cs-color-info-soft)",
  text: "var(--cs-color-info-text)",
} as const;
const INK = "var(--cs-color-text-primary)";
const MUTE = "var(--cs-color-text-tertiary)";
const BASE = "var(--cs-color-surface-base)";
const DANGER = "var(--cs-color-danger-graphic)";

export interface MarkProps {
  shape: Shape;
  /** 그리는 크기(px). 기준은 28 */
  size?: number;
  on?: boolean;
  group?: boolean;
  failing?: boolean;
  autoOff?: boolean;
  picked?: boolean;
  /** 마우스를 올렸나: 면이 조금 밝아진다 */
  hot?: boolean;
  /** 대체돼 가려진 것: 점선 */
  shadowed?: boolean;
  className?: string;
}

const lighten = (c: string, pct: number): string =>
  `color-mix(in oklab, ${c} ${100 - pct}%, white)`;

function Body({
  shape,
  fill,
  stroke,
  dash,
  sw = 1.2,
}: {
  shape: Shape;
  fill: string;
  stroke: string;
  dash?: string | undefined;
  sw?: number;
}) {
  const common = {
    fill,
    stroke,
    strokeWidth: sw,
    strokeLinejoin: "round" as const,
    strokeDasharray: dash,
  };
  if (shape === "square") return <rect x={-6} y={-6} width={12} height={12} rx={2.6} {...common} />;
  if (shape === "circle") return <circle r={6.8} {...common} />;
  if (shape === "diamond") return <path d="M0 -8.6 L8.6 0 L0 8.6 L-8.6 0 Z" {...common} />;
  return <path d="M0 -8.8 L8.6 5.6 L-8.6 5.6 Z" transform="translate(0 0.9)" {...common} />;
}

export function Mark({
  shape,
  size = 28,
  on = true,
  group = false,
  failing = false,
  autoOff = false,
  picked = false,
  hot = false,
  shadowed = false,
  className,
}: MarkProps) {
  const hue = failing ? DANGER : group ? GRP.graphic : INK;
  const hollow = !on || autoOff;
  const rim = failing ? DANGER : hollow ? (group ? GRP.mark : MUTE) : hue;
  // 가리키면 면 전체가 조금 밝아진다(방향 없이)
  const face = hot ? lighten(hue, 14) : hue;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-14 -14 28 28"
      aria-hidden
      className={className}
      style={{
        overflow: "visible",
        filter: hollow
          ? "drop-shadow(0 0 1.5px color-mix(in oklab, var(--cs-color-text-primary) 18%, transparent))"
          : `drop-shadow(0 0 2px color-mix(in oklab, ${hue} 40%, transparent))`,
      }}
    >
      {picked && (
        <g className="wb5-pop">
          <circle r={12.8} fill="none" stroke={INK} strokeOpacity={0.9} strokeWidth={1.4} />
          <circle
            r={12.8}
            fill="none"
            stroke={failing ? DANGER : group ? GRP.graphic : INK}
            strokeOpacity={0.18}
            strokeWidth={5}
          />
        </g>
      )}
      {hollow ? (
        <Body
          shape={shape}
          fill={BASE}
          stroke={rim}
          sw={1.5}
          dash={shadowed || autoOff ? "2.4 2" : undefined}
        />
      ) : (
        <Body
          shape={shape}
          fill={face}
          stroke={rim}
          sw={0.9}
          dash={shadowed ? "2.4 2" : undefined}
        />
      )}
    </svg>
  );
}

/** 층 이름 옆에 놓는 작은 모양 */
export function LayerMark({
  layer,
  size = 14,
  group = false,
}: {
  layer: LayerKey;
  size?: number;
  group?: boolean;
}) {
  return <Mark shape={SHAPE_OF[layer]} size={size} group={group} />;
}
