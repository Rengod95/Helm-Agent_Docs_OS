// 점의 모양과 빛깔. 층은 모양으로 가른다(L1 네모, L2 동그라미, L3 마름모, 외부 세모).
// 그룹 구성원은 info 색, 단일 플러그인은 얼음빛 토큰, 실패는 danger 토큰이다. 색은 전부 caustic 토큰이라 밝은 판과 어두운 판을 따른다.
// 상태는 모양과 무관하다: 꺼짐은 속이 비고 옅고, 가리키면 후광이 세지고, 고르면 얇은 색 고리가 선다. 색만으로 상태를 말하지 않는다.
import { useId, type CSSProperties, type ReactElement } from "react";
import type { LayerKey } from "@fresnel/client/workbench/canvas";
import { assertNever } from "@fresnel/contracts";

export type Shape = "square" | "circle" | "diamond" | "triangle";

export function shapeOf(layer: LayerKey): Shape {
  switch (layer) {
    case "L1":
      return "square";
    case "L2":
      return "circle";
    case "L3":
      return "diamond";
    case "plugin":
      return "triangle";
    default:
      return assertNever(layer, "shapeOf");
  }
}

/** 몸과 번짐의 토큰. 실패는 이 셋 중 하나로 그린다 */
const TONE = {
  group: { body: "var(--cs-color-info-graphic)" },
  single: { body: "var(--cs-color-chart-6)" },
  danger: { body: "var(--cs-color-danger-graphic)" },
} as const;

export interface MarkProps {
  readonly shape: Shape;
  /** 그리는 크기(px) */
  readonly size?: number;
  /** 켜짐 */
  readonly on?: boolean;
  readonly group?: boolean;
  readonly failing?: boolean;
  /** 연속 실패로 자동 꺼짐 */
  readonly autoOff?: boolean;
  /** 고른 것: 얇은 색 고리 */
  readonly picked?: boolean;
  /** 가리킴: 후광이 세진다 */
  readonly hot?: boolean;
  readonly className?: string | undefined;
}

function Body({
  shape,
  scale = 1,
  style,
  strokeWidth = 0,
  dash,
}: {
  readonly shape: Shape;
  readonly scale?: number;
  readonly style: CSSProperties;
  readonly strokeWidth?: number;
  readonly dash?: string | undefined;
}) {
  // 세모는 무게중심을 조금 내려 둔다(원래 자리 그대로)
  const dy = shape === "triangle" ? 0.9 : 0;
  const common = {
    style,
    strokeWidth,
    strokeLinejoin: "round" as const,
    strokeDasharray: dash,
    transform: `translate(0 ${dy}) scale(${scale})`,
  };
  switch (shape) {
    case "square":
      return <rect x={-6} y={-6} width={12} height={12} rx={2.6} {...common} />;
    case "circle":
      return <circle r={6.8} {...common} />;
    case "diamond":
      return <path d="M0 -8.6 L8.6 0 L0 8.6 L-8.6 0 Z" {...common} />;
    case "triangle":
      return <path d="M0 -8.8 L8.6 5.6 L-8.6 5.6 Z" {...common} />;
    default:
      return assertNever(shape, "Body");
  }
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
  className,
}: MarkProps): ReactElement {
  // 번짐 그라데이션 id는 점마다 달라야 한다(같은 판에 점이 여럿이다)
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const haloId = `craft-halo-${uid}`;
  const tone = failing ? TONE.danger : group ? TONE.group : TONE.single;
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
          <stop offset={0} style={{ stopColor: tone.body }} stopOpacity={glow} />
          <stop offset={0.42} style={{ stopColor: tone.body }} stopOpacity={glow * 0.38} />
          <stop offset={1} style={{ stopColor: tone.body }} stopOpacity={0} />
        </radialGradient>
      </defs>
      {picked && (
        <circle
          r={11.6}
          fill="none"
          style={{ stroke: tone.body }}
          strokeOpacity={0.95}
          strokeWidth={1}
        />
      )}
      <circle r={13} fill={`url(#${haloId})`} style={{ opacity: "var(--craft-halo-gain, 1)" }} />
      {hollow ? (
        // 꺼짐·자동 꺼짐: 속이 옅게 비치고 테두리만 선다
        <Body
          shape={shape}
          style={{ fill: tone.body, fillOpacity: 0.14, stroke: tone.body }}
          strokeWidth={1.4}
          dash={autoOff ? "2.4 2" : undefined}
        />
      ) : (
        <>
          <Body
            shape={shape}
            style={{ fill: tone.body, stroke: "var(--cs-color-material-rim)" }}
            strokeWidth={0.5}
          />
          {/* 밝은 핵: 어두운 판에서는 밝게, 밝은 판에서는 짙게 앉는다 */}
          <Body
            shape={shape}
            scale={0.46}
            style={{ fill: `color-mix(in oklab, ${tone.body} 55%, var(--cs-color-text-primary))` }}
          />
        </>
      )}
    </svg>
  );
}
