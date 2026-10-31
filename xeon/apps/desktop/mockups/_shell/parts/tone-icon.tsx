// DP-29: tone 색은 아이콘을 감싼 작은 면(아이콘 바탕)에만 준다. 행이나 글자 전체를 칠하지 않는다.
// caustic 빈틈: Badge icon-only 정사각형은 있지만 아이콘 크기·면 크기를 목록 행(20px)에 맞춘 "tone 아이콘 면"이 없다.
import type { ReactNode } from "react";

type Tone = "danger" | "warning" | "success" | "info" | "neutral";
const face: Record<Tone, string> = {
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  success: "bg-success-soft text-success-text",
  info: "bg-info-soft text-info-text",
  neutral: "bg-neutral-track text-text-tertiary",
};

export function ToneIcon({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`inline-grid size-5 flex-none place-items-center rounded-sm [&_svg]:size-icon-xs ${face[tone]}`}
    >
      {children}
    </span>
  );
}
