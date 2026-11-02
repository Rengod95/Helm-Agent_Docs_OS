// 묶음 C 공용 작은 부품(caustic 토큰과 Tailwind만). 머리 주석마다 메운 빈틈을 적는다.
// 옛 언어 이식(m4/redesign의 같은 이름 부품을 옛 토큰으로 옮김): 상태 점 tone은 옛 다섯 가지(success·info 포함)를 그대로 둔다.
// ExtName은 기본으로 id를 보인다(옛 c01~c04가 기본값에 기댄다). SectionTitle은 옛 h2 그대로(새 구역 제목은 PageSection).
// DottedRows·DottedRow는 점선 대신 얇은 실선(border-subtle)으로 행을 나눈다(점선 구분선은 가져오지 않는다).
import { Badge, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import { extName, EXT, Lock, T } from "../_shell";

/** 상태 점 tone(옛 팔레트 다섯 가지). */
export type Dot = "success" | "warning" | "danger" | "neutral" | "info";
const dotBg: Record<Dot, string> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
  info: "bg-info-graphic",
};

/** 상태 점(caustic 빈틈 C-23: 점 + 글 한 쌍이 없다. Badge dot은 알약 면까지 그려 표 안에서 무겁다). */
export function StatusDot({ tone }: { tone: Dot }) {
  return (
    <span aria-hidden className={`inline-block size-1.5 flex-none rounded-full ${dotBg[tone]}`} />
  );
}

export function DotText({ tone, children }: { tone: Dot; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-ui-dense text-text-secondary">
      <StatusDot tone={tone} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** 줄을 얇은 실선으로 나눈 목록(옛 언어: 점선 대신 border-subtle). 기록·실패·묻지 않기처럼 상자 없이 읽는 줄에 쓴다. */
export function DottedRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none p-0">
      {children}
    </ul>
  );
}

/** 목록 한 줄: 앞 표식 + 제목 + 둘째 줄 + 끝(시각·동작). 줄 사이에만 실선, 마지막 줄 아래에는 선을 긋지 않는다. */
export function DottedRow({
  leading,
  title,
  description,
  end,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <li className="flex min-h-10 min-w-0 items-center gap-3 border-b border-border-subtle py-2 last:border-b-0">
      {leading}
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui-dense text-text-primary">{title}</span>
        {description !== undefined && (
          <span className="truncate text-ui-xs text-text-tertiary">{description}</span>
        )}
      </span>
      {end !== undefined && <span className="flex flex-none items-center gap-2">{end}</span>}
    </li>
  );
}

/** 확장 이름: 표시 이름 + 회색 mono id(결정 13, DP-39). 표시 이름이 없으면 id만. */
export function ExtName({
  id,
  strong = false,
  showId = true,
}: {
  id: string;
  strong?: boolean;
  showId?: boolean;
}) {
  const has = EXT[id] !== undefined;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span
        className={`truncate ${strong ? "font-medium text-text-primary" : "text-text-primary"}`}
      >
        {extName(id)}
      </span>
      {has && showId && (
        <span className="truncate font-mono text-mono-sm text-text-tertiary">{id}</span>
      )}
    </span>
  );
}

/** DP-31: 층은 짧은 mono 열. */
export function LayerCell({ children }: { children: ReactNode }) {
  return <span className="font-mono text-mono-sm text-text-tertiary">{children}</span>;
}

/** 크래프트 화면 안 구역 제목(h2). 굵기·글자색 단계로만 묶는다(DP-03). */
export function SectionTitle({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2">
      <h2 className="m-0 min-w-0 truncate text-ui-dense font-semibold text-text-primary">
        {children}
      </h2>
      {end !== undefined && (
        <span className="ms-auto flex items-center gap-1 text-ui-xs text-text-tertiary">{end}</span>
      )}
    </div>
  );
}

/** 기계 값 한 조각(mono, 연한 글). */
export function Mono({ children, dim = true }: { children: ReactNode; dim?: boolean }) {
  return (
    <span
      className={`font-mono text-mono-sm ${dim ? "text-text-tertiary" : "text-text-secondary"}`}
    >
      {children}
    </span>
  );
}

/**
 * "개발 모드에서만" 잠금 배지 + 이유 툴팁(N-30, 결정 4). 잠긴 동작 옆에 하나만 둔다.
 * reason은 이 기기에서 왜 잠겼는지(배포 앱, 저장소 경로 없음, 원격 호스트가 개발 모드가 아님)를 한 문장으로.
 */
export function DevLock({
  reason,
  open,
  size = "xs",
}: {
  reason: ReactNode;
  open?: boolean;
  size?: "xs" | "sm";
}) {
  return (
    <Tooltip
      content={<span className="block max-w-64 whitespace-normal">{reason}</span>}
      side="top"
      {...(open !== undefined ? { open } : {})}
    >
      <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:focus-ring">
        <Badge size={size} tone="neutral" variant="soft" icon={<Lock />}>
          {`${T.devMode}에서만`}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** 읽기 전용 표지(배포 앱의 지난 replay·bench·diff 결과). */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 inline-flex items-center gap-1.5 text-ui-xs text-text-tertiary">
      <Lock aria-hidden emphasis="muted" className="size-icon-xs" />
      {children}
    </p>
  );
}
