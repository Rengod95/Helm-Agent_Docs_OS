// 점의 모양과 색. 층은 모양으로(L1 네모, L2 동그라미, L3 마름모, 외부 세모), 그룹은 색 하나(남보라)로 가른다.
// 상태는 모양과 무관하게 읽히도록 같은 방식으로 얹는다: 꺼짐 = 속이 빔, 실패 = 붉은 채움 + 붉은 테두리 고리, 고름 = 바깥 검은 고리.
import { LAYER_NAME, type LayerKey } from "./data";

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
  /** 대체돼 가려진 것: 점선 */
  shadowed?: boolean;
  /** 어두운 바탕(고른 칩) 위에 놓을 때 */
  inverse?: boolean;
  className?: string;
}

function Body({
  shape,
  fill,
  stroke,
  dash,
}: {
  shape: Shape;
  fill: string;
  stroke: string;
  dash?: string | undefined;
}) {
  const common = {
    fill,
    stroke,
    strokeWidth: 1.7,
    strokeLinejoin: "round" as const,
    strokeDasharray: dash,
  };
  if (shape === "square") return <rect x={-6} y={-6} width={12} height={12} rx={2} {...common} />;
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
  shadowed = false,
  inverse = false,
  className,
}: MarkProps) {
  const hue = failing ? DANGER : inverse ? BASE : group ? GRP.mark : INK;
  const hollow = !on || autoOff;
  const fill = hollow ? (inverse ? "transparent" : BASE) : hue;
  const stroke = failing ? DANGER : hollow ? (inverse ? BASE : group ? GRP.mark : MUTE) : hue;
  return (
    <svg width={size} height={size} viewBox="-14 -14 28 28" aria-hidden className={className}>
      {picked && <circle r={12.6} fill="none" stroke={INK} strokeWidth={1.6} />}
      {failing && !picked && (
        <circle
          r={11.4}
          fill="none"
          stroke={DANGER}
          strokeWidth={1.3}
          strokeDasharray={autoOff ? "2.6 2.2" : undefined}
        />
      )}
      <Body shape={shape} fill={fill} stroke={stroke} dash={shadowed ? "2.4 2" : undefined} />
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

/** 캔버스 한쪽의 범례: 층 = 모양, 그룹/단일 = 색, 꺼짐·실패 = 상태 */
export function Legend() {
  const layers: LayerKey[] = ["L1", "L2", "L3", "plugin"];
  return (
    <div
      role="group"
      aria-label="범례"
      className="flex flex-col gap-1.5 rounded-2xl border border-border-subtle bg-surface-raised px-3 py-2 text-footnote text-text-secondary shadow-2"
    >
      <div className="flex items-center gap-3">
        {layers.map((l) => (
          <span key={l} className="inline-flex items-center gap-1">
            <Mark shape={SHAPE_OF[l]} size={18} />
            {LAYER_NAME[l]}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <Mark shape="diamond" size={18} group />
          그룹 구성원
        </span>
        <span className="inline-flex items-center gap-1">
          <Mark shape="diamond" size={18} />
          단일
        </span>
        <span className="inline-flex items-center gap-1">
          <Mark shape="diamond" size={18} on={false} />
          꺼짐
        </span>
        <span className="inline-flex items-center gap-1">
          <Mark shape="diamond" size={18} failing />
          실패
        </span>
      </div>
    </div>
  );
}
