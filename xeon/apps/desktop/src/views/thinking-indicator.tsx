import type { ReactNode } from "react";

// 생각 표시(dsI). 프레넬 렌즈의 동심 고리를 바깥에서 안으로 위상차를 두고 밝혀 빛이 모이는 모양이다.
// React Bits "Lattice Loader"의 "격자 점이 파동처럼 밝아진다"는 발상만 따왔고 코드는 옮기지 않았다(직접 쓴 SVG + CSS).
// 움직임은 thinking-indicator.css가 맡는다. 움직임을 줄이면 정지 모양이다.

/** 한 고리. 반지름과 호 개수(둘레를 `segments`개 호로 끊는다)와 시작 각도 */
type Ring = { readonly r: number; readonly segments: number; readonly angle: number };

const CENTER = 12;
/** 둘레를 60으로 맞춰(pathLength) 호와 틈의 길이를 고리마다 같은 비율로 준다 */
const PATH_LENGTH = 60;
/** 바깥 → 안. 렌즈의 계단처럼 안쪽일수록 호가 적고 길다 */
const RINGS: readonly Ring[] = [
  { r: 10, segments: 6, angle: -90 },
  { r: 6.5, segments: 4, angle: -45 },
  { r: 3.2, segments: 2, angle: 0 },
];

function dashOf(segments: number): string {
  const period = PATH_LENGTH / segments;
  const gap = Math.max(2, period * 0.2);
  return `${period - gap} ${gap}`;
}

export function ThinkingIndicator(props: {
  /** 한 변(px). 기본은 16, 첫 응답 대기는 24 */
  readonly size?: number;
  /** 움직이는지. 끝난 생각은 false(정지 모양) */
  readonly active: boolean;
  readonly className?: string;
}): ReactNode {
  const size = props.size ?? 16;
  return (
    <svg
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      data-active={props.active ? "true" : "false"}
      className={`thinking-indicator shrink-0${props.className === undefined ? "" : ` ${props.className}`}`}
    >
      {RINGS.map((ring, i) => (
        <circle
          key={ring.r}
          className={`thinking-indicator-part thinking-indicator-step-${i}`}
          cx={CENTER}
          cy={CENTER}
          r={ring.r}
          pathLength={PATH_LENGTH}
          strokeDasharray={dashOf(ring.segments)}
          strokeLinecap="round"
          strokeWidth={1.6}
          stroke="currentColor"
          transform={`rotate(${ring.angle} ${CENTER} ${CENTER})`}
        />
      ))}
      <circle
        className="thinking-indicator-part thinking-indicator-step-3"
        cx={CENTER}
        cy={CENTER}
        r={1.3}
        fill="currentColor"
      />
    </svg>
  );
}
