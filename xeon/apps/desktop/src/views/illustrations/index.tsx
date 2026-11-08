import type { ReactNode } from "react";

// 빈 상태 그림. 장식이라 aria-hidden이고 외부 그림 없이 SVG로 직접 그린다.
// 선은 currentColor(텍스트 보조색), 면은 currentColor를 옅게 깐 것, 강조 한 곳만 caustic accent 변수를 쓴다(라이트·다크 둘 다 토큰이 바뀐다).
// 크기는 160 좌표를 128px로 보이며, caustic EmptyState media 칸의 svg 크기 규칙을 style로 덮는다.

const ACCENT = "var(--cs-color-accent-graphic)";
const PAPER = "var(--cs-color-surface-base)";
const SIZE = 128;

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
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse
        cx="80"
        cy="140"
        rx="46"
        ry="6"
        fill="currentColor"
        fillOpacity={0.1}
        stroke="none"
      />
      {children}
    </svg>
  );
}

/** 대화 목록이 빔: 말풍선 둘 */
export function ThreadsArt(): ReactNode {
  return (
    <Art>
      <rect x="24" y="30" width="80" height="54" rx="14" fill="currentColor" fillOpacity={0.1} />
      <path d="M44 84 L40 100 L58 84" fill={PAPER} />
      <path d="M44 84 L40 100 L58 84" fill="currentColor" fillOpacity={0.1} />
      <path d="M42 50h44M42 64h28" opacity={0.6} />
      <rect x="62" y="68" width="76" height="52" rx="14" fill={PAPER} />
      <rect
        x="62"
        y="68"
        width="76"
        height="52"
        rx="14"
        fill={ACCENT}
        fillOpacity={0.14}
        stroke={ACCENT}
      />
      <path d="M118 120 L122 134 L106 120" fill={PAPER} stroke={ACCENT} />
      <circle cx="84" cy="94" r="3" fill={ACCENT} stroke="none" />
      <circle cx="100" cy="94" r="3" fill={ACCENT} stroke="none" />
      <circle cx="116" cy="94" r="3" fill={ACCENT} stroke="none" />
    </Art>
  );
}

/** 알림·검토가 모두 처리됨: 빈 받은편지함과 체크 */
export function InboxArt(): ReactNode {
  return (
    <Art>
      <path
        d="M28 88 L46 40 H114 L132 88 V122 a8 8 0 0 1 -8 8 H36 a8 8 0 0 1 -8 -8 Z"
        fill="currentColor"
        fillOpacity={0.1}
      />
      <path d="M28 88 H58 a6 6 0 0 1 6 6 a16 16 0 0 0 32 0 a6 6 0 0 1 6 -6 H132" />
      <circle cx="80" cy="56" r="20" fill={PAPER} stroke={ACCENT} />
      <circle cx="80" cy="56" r="20" fill={ACCENT} fillOpacity={0.14} stroke="none" />
      <path d="M70 56 L77 63 L91 48" stroke={ACCENT} strokeWidth={4} />
    </Art>
  );
}

/** 예약 없음: 달력과 시계 */
export function ScheduleArt(): ReactNode {
  return (
    <Art>
      <rect x="26" y="36" width="92" height="88" rx="12" fill="currentColor" fillOpacity={0.1} />
      <path d="M26 62 H118" />
      <path d="M50 28 V44 M94 28 V44" />
      <path d="M44 78h10M66 78h10M88 78h10M44 94h10M66 94h10M44 108h10" opacity={0.55} />
      <circle cx="112" cy="106" r="28" fill={PAPER} />
      <circle cx="112" cy="106" r="28" fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} />
      <path d="M112 90 V106 L124 112" stroke={ACCENT} />
    </Art>
  );
}

/** 제안 없음: 전구와 반짝임 */
export function ProposalArt(): ReactNode {
  return (
    <Art>
      <path
        d="M80 26 a38 38 0 0 1 22 69 v10 a6 6 0 0 1 -6 6 H64 a6 6 0 0 1 -6 -6 V95 A38 38 0 0 1 80 26 Z"
        fill="currentColor"
        fillOpacity={0.1}
      />
      <path d="M66 120 H94 M70 132 H90" />
      <path d="M70 70 L80 82 L90 70" stroke={ACCENT} />
      <path d="M80 82 V104" stroke={ACCENT} />
      <path d="M128 34 v14 M121 41 h14" stroke={ACCENT} />
      <path d="M30 50 v10 M25 55 h10" opacity={0.6} />
      <circle cx="132" cy="84" r="3" fill="currentColor" stroke="none" opacity={0.5} />
    </Art>
  );
}

/** 비밀 없음: 금고와 열쇠 */
export function VaultArt(): ReactNode {
  return (
    <Art>
      <rect x="26" y="34" width="108" height="88" rx="14" fill="currentColor" fillOpacity={0.1} />
      <rect x="38" y="46" width="84" height="64" rx="8" />
      <circle cx="80" cy="78" r="18" fill={PAPER} />
      <circle cx="80" cy="78" r="18" fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} />
      <path d="M80 66 V90 M68 78 H92" stroke={ACCENT} opacity={0.8} />
      <path d="M44 122 v10 M116 122 v10" />
    </Art>
  );
}

/** 시험 없음: 플라스크 */
export function TestsArt(): ReactNode {
  return (
    <Art>
      <path
        d="M64 28 H96 M70 28 V62 L42 112 a10 10 0 0 0 9 15 H109 a10 10 0 0 0 9 -15 L90 62 V28"
        fill="currentColor"
        fillOpacity={0.1}
      />
      <path
        d="M54 98 H106 L118 112 a10 10 0 0 1 -9 15 H51 a10 10 0 0 1 -9 -15 Z"
        fill={ACCENT}
        fillOpacity={0.2}
        stroke={ACCENT}
      />
      <circle cx="78" cy="84" r="4" stroke={ACCENT} />
      <circle cx="90" cy="72" r="3" stroke={ACCENT} />
      <circle cx="82" cy="108" r="3" fill={ACCENT} stroke="none" />
    </Art>
  );
}

/** 폴더·묶음이 비어 있음: 열린 빈 폴더 */
export function FolderArt(): ReactNode {
  return (
    <Art>
      <path
        d="M24 52 a8 8 0 0 1 8 -8 H62 L72 56 H128 a8 8 0 0 1 8 8 V116 a8 8 0 0 1 -8 8 H32 a8 8 0 0 1 -8 -8 Z"
        fill="currentColor"
        fillOpacity={0.1}
      />
      <path
        d="M24 76 a8 8 0 0 1 8 -8 H128 a8 8 0 0 1 8 8 V116 a8 8 0 0 1 -8 8 H32 a8 8 0 0 1 -8 -8 Z"
        fill={PAPER}
      />
      <path
        d="M24 76 a8 8 0 0 1 8 -8 H128 a8 8 0 0 1 8 8 V116 a8 8 0 0 1 -8 8 H32 a8 8 0 0 1 -8 -8 Z"
        fill={ACCENT}
        fillOpacity={0.12}
        stroke={ACCENT}
      />
      <path d="M66 96 H94" stroke={ACCENT} />
    </Art>
  );
}

/** 확장 없음: 퍼즐 조각 */
export function PuzzleArt(): ReactNode {
  return (
    <Art>
      <path
        d="M30 56 H56 a14 14 0 1 1 28 0 H110 V82 a14 14 0 1 1 0 28 V122 H30 Z"
        fill="currentColor"
        fillOpacity={0.1}
      />
      <path d="M110 82 a14 14 0 1 1 0 28" fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} />
      <path d="M44 74 H60 M44 92 H72" opacity={0.55} />
    </Art>
  );
}

/** 살필 것이 없음: 돋보기 */
export function InspectArt(): ReactNode {
  return (
    <Art>
      <rect x="24" y="30" width="86" height="72" rx="10" fill="currentColor" fillOpacity={0.1} />
      <path d="M40 50 H94 M40 66 H78 M40 82 H64" opacity={0.55} />
      <circle cx="102" cy="96" r="24" fill={PAPER} />
      <circle cx="102" cy="96" r="24" fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} />
      <path d="M120 114 L138 132" stroke={ACCENT} strokeWidth={5} />
    </Art>
  );
}

/** 찾을 수 없음: 점선 상자와 물음표 */
export function MissingArt(): ReactNode {
  return (
    <Art>
      <rect
        x="30"
        y="34"
        width="100"
        height="88"
        rx="14"
        fill="currentColor"
        fillOpacity={0.1}
        strokeDasharray="6 8"
      />
      <path d="M68 70 a12 12 0 1 1 18 10 c-4 3 -6 5 -6 10" stroke={ACCENT} strokeWidth={4} />
      <circle cx="80" cy="104" r="3.5" fill={ACCENT} stroke="none" />
    </Art>
  );
}

/** 공급자 풀이 비어 있음: 플러그와 전원 */
export function PlugArt(): ReactNode {
  return (
    <Art>
      <rect x="46" y="62" width="68" height="40" rx="12" fill="currentColor" fillOpacity={0.1} />
      <path d="M64 62 V38 M96 62 V38" />
      <path d="M80 102 V118 a14 14 0 0 1 -14 14 H40" />
      <circle cx="80" cy="82" r="8" fill={ACCENT} fillOpacity={0.2} stroke={ACCENT} />
    </Art>
  );
}
