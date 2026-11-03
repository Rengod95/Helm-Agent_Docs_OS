// 점의 모양과 빛깔. 층은 모양으로(L1 네모, L2 동그라미, L3 마름모, 외부 세모), 그룹은 정보 색(파랑)으로, 단일 플러그인은 얼음빛으로 가른다.
// 점은 빛나는 몸이다: 방사형 번짐(같은 색의 원) 위에 색 있는 몸, 가운데 더 밝은 작은 심, 아주 가는 밝은 테두리.
// 그림자·위아래 빛·번짐 필터는 없다. 색은 orbit-lines.css의 변수(판마다)에서 온다.
import { useId, type CSSProperties } from "react";
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

export interface MarkProps {
  shape: Shape;
  /** 그리는 크기(px). 기준은 28 */
  size?: number;
  on?: boolean;
  group?: boolean;
  failing?: boolean;
  autoOff?: boolean;
  picked?: boolean;
  /** 마우스를 올렸나: 번짐이 조금 세진다 */
  hot?: boolean;
  /** 대체돼 가려진 것: 점선 */
  shadowed?: boolean;
  className?: string;
}

/** 점의 바탕 빛깔: 몸(body)과 번짐(halo). 값은 orbit-lines.css가 판마다 정한다. */
type Tone = "group" | "single" | "danger";
const TONE: Record<Tone, { body: string; halo: string }> = {
  group: { body: "var(--wb5-mk-group)", halo: "var(--wb5-hl-group)" },
  single: { body: "var(--wb5-mk-single)", halo: "var(--wb5-hl-single)" },
  danger: { body: "var(--wb5-mk-danger)", halo: "var(--wb5-hl-danger)" },
};

/** 모양 하나. scale은 가운데를 기준으로 줄인다(심에 쓴다). */
function Body({
  shape,
  scale = 1,
  style,
  sw = 0,
  dash,
}: {
  shape: Shape;
  scale?: number;
  style: CSSProperties;
  sw?: number;
  dash?: string | undefined;
}) {
  // 세모는 무게중심을 아래로 조금 내려 두었다(원래 자리 그대로)
  const dy = shape === "triangle" ? 0.9 : 0;
  const common = {
    style,
    strokeWidth: sw,
    strokeLinejoin: "round" as const,
    strokeDasharray: dash,
    transform: `translate(0 ${dy}) scale(${scale})`,
  };
  if (shape === "square") return <rect x={-6} y={-6} width={12} height={12} rx={2.6} {...common} />;
  if (shape === "circle") return <circle r={6.8} {...common} />;
  if (shape === "diamond") return <path d="M0 -8.6 L8.6 0 L0 8.6 L-8.6 0 Z" {...common} />;
  return <path d="M0 -8.8 L8.6 5.6 L-8.6 5.6 Z" {...common} />;
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
  // 같은 판에 점이 여럿이라 번짐 그라데이션 id는 점마다 달라야 한다
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const haloId = `wb5-halo-${uid}`;
  const tone: Tone = failing ? "danger" : group ? "group" : "single";
  const { body, halo } = TONE[tone];
  const hollow = !on || autoOff;
  // 번짐의 세기: 꺼진 점은 옅고, 가리키면 세지고, 고르면 가장 세다
  const glow = hollow ? 0.2 : picked ? 0.9 : hot ? 0.74 : 0.56;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-14 -14 28 28"
      aria-hidden
      className={className}
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient id={haloId} cx={0} cy={0} r={13} gradientUnits="userSpaceOnUse">
          <stop offset={0} style={{ stopColor: halo }} stopOpacity={glow} />
          <stop offset={0.42} style={{ stopColor: halo }} stopOpacity={glow * 0.38} />
          <stop offset={1} style={{ stopColor: halo }} stopOpacity={0} />
        </radialGradient>
      </defs>
      {picked && (
        <g className="wb5-pop">
          <circle
            r={11.6}
            fill="none"
            style={{ stroke: body }}
            strokeOpacity={0.95}
            strokeWidth={1}
          />
        </g>
      )}
      <circle r={13} fill={`url(#${haloId})`} style={{ opacity: "var(--wb5-halo-gain, 1)" }} />
      {hollow ? (
        // 꺼짐·자동 꺼짐: 속이 옅게 비치고 테두리만 선다
        <Body
          shape={shape}
          style={{ fill: body, fillOpacity: 0.14, stroke: body }}
          sw={1.4}
          dash={shadowed || autoOff ? "2.4 2" : undefined}
        />
      ) : shadowed ? (
        // 가려짐: 옅은 몸에 점선 테두리
        <Body
          shape={shape}
          style={{ fill: body, fillOpacity: 0.35, stroke: body }}
          sw={1.2}
          dash="2.4 2"
        />
      ) : (
        <>
          <Body shape={shape} style={{ fill: body, stroke: "var(--wb5-rim)" }} sw={0.5} />
          <Body
            shape={shape}
            scale={0.46}
            style={{ fill: `color-mix(in oklab, ${body} 55%, white)` }}
          />
        </>
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
