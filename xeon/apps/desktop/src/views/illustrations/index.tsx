import type { ReactNode } from "react";

// 빈 상태 그림. 장식이라 aria-hidden이고 외부 그림 없이 SVG로 직접 그린다.
// 크래프트 Link의 선 언어를 따른다: 면 채움 없는 얇은 선(화면에서 약 1.1px), 한 줄 큐빅 곡선이 나란히 묶인 가닥, 끝에 점 하나.
// 선은 currentColor(텍스트 보조색), 가닥과 점은 caustic accent 변수(라이트·다크 토큰이 바뀐다).
// 느린 빛(illustrations.css)은 가닥 하나만 따라 흐르고, 움직임 줄이기에서는 멈춘다.
// 160 좌표를 128px로 보이며, caustic EmptyState media 칸의 svg 크기 규칙을 style로 덮는다.

const ACCENT = "var(--cs-color-accent-graphic)";
const SIZE = 128;
const HAIR = 1.4;

function Art({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 160"
      width={SIZE}
      height={SIZE}
      style={{ width: SIZE, height: SIZE, flex: "none" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={HAIR}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** 같은 곡선을 위아래로 어긋나게 겹친 가닥 묶음. 뒤로 갈수록 흐려지고, 첫 가닥만 빛이 흐른다 */
function Strands({
  d,
  n = 3,
  gap = 3.5,
  light = true,
}: {
  readonly d: string;
  readonly n?: number;
  readonly gap?: number;
  readonly light?: boolean;
}): ReactNode {
  return (
    <g stroke={ACCENT}>
      {Array.from({ length: n }, (_, i) => (
        <path
          key={i}
          d={d}
          transform={`translate(0 ${i * gap})`}
          opacity={1 - i * 0.25}
          strokeWidth={i === 0 ? HAIR * 1.15 : HAIR}
        />
      ))}
      {light ? (
        <path d={d} pathLength={1} className="empty-art-light" strokeWidth={HAIR * 1.6} />
      ) : null}
    </g>
  );
}

function Dot({ x, y }: { readonly x: number; readonly y: number }): ReactNode {
  return <circle cx={x} cy={y} r="2.6" fill={ACCENT} stroke="none" />;
}

const SOFT = 0.7;

/** 대화 목록이 빔: 말풍선 윤곽 둘과 둘을 잇는 물결 */
export function ThreadsArt(): ReactNode {
  return (
    <Art>
      <path
        d="M26 34 C26 24 32 20 42 20 H84 C94 20 100 24 100 34 V58 C100 68 94 72 84 72 H52 L38 84 V72 C30 72 26 68 26 58 Z"
        opacity={SOFT}
      />
      <path d="M42 40 C52 34 60 46 70 40 S84 36 88 40" opacity={SOFT} />
      <Strands d="M58 78 C66 100 94 86 104 104 S126 116 134 120" />
      <Dot x={134} y={120} />
    </Art>
  );
}

/** 알림·검토가 모두 처리됨: 열린 받은편지함 윤곽 위로 흐르는 물결 */
export function InboxArt(): ReactNode {
  return (
    <Art>
      <path
        d="M24 94 L42 46 H118 L136 94 V120 C136 126 132 130 126 130 H34 C28 130 24 126 24 120 Z"
        opacity={SOFT}
      />
      <path d="M24 94 H58 C62 94 64 96 64 100 C64 110 72 114 80 114 C88 114 96 110 96 100 C96 96 98 94 102 94 H136" />
      <Strands d="M44 66 C58 50 70 80 84 64 S106 52 118 62" n={2} gap={5} />
      <Dot x={118} y={62} />
    </Art>
  );
}

/** 예약 없음: 달력 윤곽과 흘러가는 시간 */
export function ScheduleArt(): ReactNode {
  return (
    <Art>
      <path
        d="M30 44 C30 38 34 34 40 34 H120 C126 34 130 38 130 44 V120 C130 126 126 130 120 130 H40 C34 130 30 126 30 120 Z"
        opacity={SOFT}
      />
      <path d="M30 60 H130" opacity={SOFT} />
      <path d="M52 26 V42 M108 26 V42" />
      <Strands d="M44 100 C58 76 70 118 84 96 S108 80 118 90" />
      <Dot x={118} y={90} />
    </Art>
  );
}

/** 제안 없음: 전구 윤곽과 그 안에서 피어오르는 물결 */
export function ProposalArt(): ReactNode {
  return (
    <Art>
      <path
        d="M80 24 C102 24 118 40 118 60 C118 74 110 84 102 92 C98 96 98 100 98 106 H62 C62 100 62 96 58 92 C50 84 42 74 42 60 C42 40 58 24 80 24 Z"
        opacity={SOFT}
      />
      <path d="M66 118 H94 M72 128 H88" />
      <Strands d="M58 78 C66 52 78 92 88 64 S102 54 104 48" n={2} gap={5} />
      <Dot x={104} y={48} />
    </Art>
  );
}

/** 비밀 없음: 금고 윤곽과 잠금 둘레의 물결 */
export function VaultArt(): ReactNode {
  return (
    <Art>
      <path
        d="M30 44 C30 36 36 30 44 30 H116 C124 30 130 36 130 44 V104 C130 112 124 118 116 118 H44 C36 118 30 112 30 104 Z"
        opacity={SOFT}
      />
      <path d="M46 118 V130 M114 118 V130" />
      <Strands d="M52 74 C62 54 72 96 82 76 S100 56 110 70" />
      <Dot x={110} y={70} />
    </Art>
  );
}

/** 시험 없음: 플라스크 윤곽과 액체의 물결 */
export function TestsArt(): ReactNode {
  return (
    <Art>
      <path
        d="M66 24 H94 M72 24 V62 L44 112 C40 120 46 130 56 130 H104 C114 130 120 120 116 112 L88 62 V24"
        opacity={SOFT}
      />
      <Strands d="M52 106 C64 94 72 118 84 106 S100 96 110 104" n={2} gap={6} />
      <Dot x={110} y={104} />
      <circle cx="80" cy="82" r="3.4" stroke={ACCENT} opacity={0.7} />
    </Art>
  );
}

/** 폴더·묶음이 비어 있음: 열린 빈 폴더 윤곽과 안으로 흐르는 선 */
export function FolderArt(): ReactNode {
  return (
    <Art>
      <path
        d="M24 54 C24 48 28 44 34 44 H62 L72 56 H126 C132 56 136 60 136 66 V114 C136 120 132 124 126 124 H34 C28 124 24 120 24 114 Z"
        opacity={SOFT}
      />
      <path d="M24 76 C24 72 28 70 32 70 H128 C132 70 136 72 136 76" opacity={SOFT} />
      <Strands d="M44 98 C58 86 70 110 84 98 S108 90 118 98" n={2} gap={5} />
      <Dot x={118} y={98} />
    </Art>
  );
}

/** 확장 없음: 퍼즐 조각 윤곽과 끼워질 자리로 향하는 물결 */
export function PuzzleArt(): ReactNode {
  return (
    <Art>
      <path
        d="M32 54 H58 C58 40 82 40 82 54 H108 V80 C122 80 122 104 108 104 V124 H32 Z"
        opacity={SOFT}
      />
      <Strands d="M46 90 C58 72 70 108 82 90 S102 78 108 92" n={2} gap={5} />
      <Dot x={108} y={92} />
    </Art>
  );
}

/** 살필 것이 없음: 돋보기와 줄 */
export function InspectArt(): ReactNode {
  return (
    <Art>
      <path
        d="M28 40 C28 34 32 30 38 30 H98 C104 30 108 34 108 40 V92 C108 98 104 102 98 102 H38 C32 102 28 98 28 92 Z"
        opacity={SOFT}
      />
      <path d="M44 50 C56 44 66 56 78 50 S92 46 96 50 M44 68 C54 62 62 74 72 68" opacity={SOFT} />
      <circle cx="102" cy="96" r="24" stroke={ACCENT} />
      <Strands d="M88 96 C94 84 104 108 114 94" n={2} gap={4} light={false} />
      <path d="M120 114 L138 132" stroke={ACCENT} />
    </Art>
  );
}

/** 찾을 수 없음: 점선 윤곽과 물결 물음표 */
export function MissingArt(): ReactNode {
  return (
    <Art>
      <path
        d="M32 44 C32 38 36 34 42 34 H118 C124 34 128 38 128 44 V112 C128 118 124 122 118 122 H42 C36 122 32 118 32 112 Z"
        strokeDasharray="1 7"
        opacity={SOFT}
      />
      <Strands d="M66 72 C66 56 94 56 94 72 C94 84 80 84 80 96" n={2} gap={3} />
      <Dot x={80} y={108} />
    </Art>
  );
}

/** 공급자 풀이 비어 있음: 플러그와 이어지지 못한 선 */
export function PlugArt(): ReactNode {
  return (
    <Art>
      <path
        d="M52 64 H108 C112 64 114 66 114 70 V90 C114 98 108 104 100 104 H60 C52 104 46 98 46 90 V70 C46 66 48 64 52 64 Z"
        opacity={SOFT}
      />
      <path d="M64 64 V40 M96 64 V40" />
      <Strands d="M80 104 C80 124 62 120 56 128 S36 138 26 132" n={2} gap={4} />
      <Dot x={26} y={132} />
    </Art>
  );
}

/** 새 대화 화면: 프레넬 렌즈의 단면(홈 파인 능선)과, 왼쪽에서 든 평행한 빛이 렌즈를 지나 한 점에 모이는 선들 */
export function NewThreadArt(): ReactNode {
  // 능선 다섯 개가 세로로 쌓인다. 능선마다 오른쪽으로 불룩한 곡선 하나가 같은 x로 돌아온다
  const LENS_X = 112;
  const RIDGE = 17;
  const TOP = 17;
  const FOCUS = { x: 232, y: 60 };
  const centers = Array.from({ length: 5 }, (_, i) => TOP + RIDGE * i + RIDGE / 2);
  const ridges = centers
    .map((_, i) => {
      const y = TOP + RIDGE * i;
      return `M${LENS_X} ${y} C${LENS_X + 13} ${y + 3} ${LENS_X + 13} ${y + RIDGE - 3} ${LENS_X} ${y + RIDGE}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 260 120"
      width={280}
      height={129}
      style={{ width: 280, height: 129, flex: "none" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={HAIR}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g opacity={SOFT}>
        <path d={`M${LENS_X} ${TOP} V${TOP + RIDGE * 5}`} />
        <path d={ridges} />
        {centers.map((y) => (
          <path key={y} d={`M14 ${y} H${LENS_X - 6}`} />
        ))}
      </g>
      <g stroke={ACCENT}>
        {centers.map((y, i) => (
          <path
            key={y}
            d={`M${LENS_X + 12} ${y} L${FOCUS.x} ${FOCUS.y}`}
            opacity={i === 2 ? 1 : 0.75}
            strokeWidth={i === 2 ? HAIR * 1.15 : HAIR}
          />
        ))}
        <path
          d={`M${LENS_X + 12} ${centers[2] ?? FOCUS.y} L${FOCUS.x} ${FOCUS.y}`}
          pathLength={1}
          className="empty-art-light"
          strokeWidth={HAIR * 1.6}
        />
      </g>
      <Dot x={FOCUS.x} y={FOCUS.y} />
    </svg>
  );
}
