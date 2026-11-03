// 확장을 가리키는 작은 부품들(§6.21 "확장 행은 모두 같은 부품" [gap:V-16]): 상태 점과 글, 층 mono 열, 이름(라벨 + mono id).
// caustic 빈틈: 상태 점 + 글 한 쌍(StatusDot)이 없다. Badge dot은 알약 면을 같이 그려 표 안에서 무겁다. 토큰으로 만든다.
import type { ReactNode } from "react";
import type { Extension } from "../../_shell";
import { displayName } from "../data";

type Dot = "success" | "warning" | "danger" | "neutral";
const dotBg: Record<Dot, string> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

export function StatusDot({ tone }: { tone: Dot }) {
  return (
    <span aria-hidden className={`inline-block size-1.5 flex-none rounded-full ${dotBg[tone]}`} />
  );
}

/** 확장 상태 → 점 tone과 글. 실패가 있으면 켜짐이어도 warning. */
export function statusOf(e: Extension): { tone: Dot; text: string } {
  if (e.status === "auto_disabled") return { tone: "danger", text: "자동 꺼짐" };
  if (e.status === "disabled") return { tone: "neutral", text: "꺼짐" };
  if (e.exempt === true) return { tone: "success", text: "켜짐 · 면제" };
  if (e.failures > 0) return { tone: "warning", text: `켜짐 · 실패 ${e.failures}` };
  return { tone: "success", text: "켜짐" };
}

export function ExtStatus({ e, pending }: { e: Extension; pending?: boolean }) {
  if (pending === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-ui-dense text-text-secondary">
        <StatusDot tone="neutral" />
        다음 단계 경계에 적용
      </span>
    );
  const s = statusOf(e);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ui-dense text-text-secondary">
      <StatusDot tone={s.tone} />
      {s.text}
    </span>
  );
}

/** DP-31: 층은 짧은 mono 열. */
export function LayerCell({ children }: { children: ReactNode }) {
  return <span className="font-mono text-mono-sm text-text-tertiary">{children}</span>;
}

/** 확장 이름: 한국어 라벨 + mono tertiary id(DP-39). */
export function ExtName({ name, strong = true }: { name: string; strong?: boolean }) {
  const label = displayName[name];
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span
        className={`truncate ${strong ? "font-medium text-text-primary" : "text-text-primary"}`}
      >
        {label ?? name}
      </span>
      {label !== undefined && (
        <span className="truncate font-mono text-mono-sm text-text-tertiary">{name}</span>
      )}
    </span>
  );
}

/** 크래프트 화면 안 구역 제목(h2). 굵기·글자색 단계로만 묶고 선을 더하지 않는다(DP-03). */
export function SectionTitle({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 pb-1">
      <h2 className="m-0 text-ui-dense font-semibold text-text-primary">{children}</h2>
      {end !== undefined && <span className="ms-auto text-ui-xs text-text-tertiary">{end}</span>}
    </div>
  );
}

/** caustic Table을 DP-26에 맞춘다: ghost, 행 사이 선 없음, 머리 아래 선 없음. Table에 "선 없는" 변형이 없어 className으로 덮는다. */
export const PLAIN_TABLE =
  "rounded-none [&_[data-slot=table-cell]]:font-normal [&_[data-slot=table-cell]]:text-ui-dense [&_[data-slot=table-row]]:border-b-0 [&_[data-slot=table-heading]]:shadow-none [&_[data-slot=table-heading]]:bg-transparent [&_[data-slot=table-heading]:first-child]:ps-0 [&_[data-slot=table-cell]:first-child]:ps-0 [&_[data-slot=table-heading]:last-child]:pe-0 [&_[data-slot=table-cell]:last-child]:pe-0 [&_table]:min-w-0";
