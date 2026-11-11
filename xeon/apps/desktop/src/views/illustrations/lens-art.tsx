import type { ReactNode } from "react";

// 새 대화 화면 그림(DP-70): 프레넬 렌즈 단면. 왼쪽에서 들어온 평행광 다섯 줄이 계단진 렌즈 면을 지나 오른쪽 한 점(초점)에 모인다.
// 브랜드(유리·굴절)와 같은 말이고, "작업이 한 폴더에 초점을 맞춘다"는 뜻이다. 면 채움·그라데이션·움직임은 없다.
// 렌즈와 들어오는 빛은 currentColor(감싸개의 글자색), 나가는 빛과 초점만 caustic accent-graphic이다(라이트·다크 토큰이 바뀐다).

const ACCENT = "var(--cs-color-accent-graphic)";
const STROKE = 1.25;

/** 렌즈 윤곽: 평평한 뒷면(x=34)과 광축에 나란한 계단으로 이어진 다섯 띠의 앞면 */
const LENS =
  "M34 12 H38 Q41 16 42 24 H38 Q42.5 27 44 36 H38 C44 38.5 46 42 46 48 C46 54 44 57.5 38 60 H44 Q42.5 69 38 72 H42 Q41 80 38 84 H34 Z";

/** 빛 한 줄: 들어오는 높이와 렌즈 앞면을 나서는 x */
const RAYS: readonly { readonly y: number; readonly exit: number }[] = [
  { y: 18, exit: 40.6 },
  { y: 33, exit: 43.3 },
  { y: 48, exit: 46 },
  { y: 63, exit: 43.3 },
  { y: 78, exit: 40.6 },
];

const FOCUS = { x: 88, y: 48 } as const;

export function LensArt(props: { readonly size?: number }): ReactNode {
  const size = props.size ?? 96;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      width={size}
      height={size}
      style={{ width: size, height: size, flex: "none" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g opacity={0.45}>
        {RAYS.map((ray) => (
          <path key={`in-${ray.y}`} d={`M4 ${ray.y} H34`} />
        ))}
      </g>
      <path d={LENS} />
      <g stroke={ACCENT}>
        {RAYS.map((ray) => (
          <path
            key={`out-${ray.y}`}
            d={`M${ray.exit} ${ray.y} L${FOCUS.x} ${FOCUS.y}`}
            opacity={ray.y === FOCUS.y ? 1 : 0.75}
          />
        ))}
      </g>
      <circle cx={FOCUS.x} cy={FOCUS.y} r={1.75} fill={ACCENT} stroke="none" />
    </svg>
  );
}
