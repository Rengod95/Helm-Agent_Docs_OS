// 설정 묶음 공용 작은 부품(caustic 토큰과 Tailwind만). 머리 주석마다 메운 빈틈을 적는다.
import { Button, type ListReorderAnnouncement } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { ChevronRight, Lock } from "../_shell";

/** 가려진 범위 값(다른 범위에 값이 있지만 더 좁은 범위가 이김). caustic Accordion은 행 48px라 한 줄 펼침을 직접 만든다. */
export function ShadowedScopes({
  rows,
  defaultOpen = false,
  disabled = false,
}: {
  rows: { scope: string; value: ReactNode; path: string }[];
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex w-fit items-center gap-1 rounded-sm text-ui-sm text-text-tertiary outline-none hover:text-text-primary focus-visible:focus-ring"
      >
        <ChevronRight
          aria-hidden
          className={`size-icon-xs transition-transform duration-quick ${open ? "rotate-90" : ""}`}
        />
        다른 범위 값이 가려져 있어요
      </button>
      {open && (
        <div className="grid gap-1 ps-4">
          {rows.map((r) => (
            <div
              key={r.scope}
              title={r.path}
              className="flex min-w-0 items-center gap-2 text-ui-sm"
            >
              <span className="w-14 flex-none text-text-tertiary">{r.scope}</span>
              <span className="font-mono text-mono-sm text-text-primary">{r.value}</span>
              <Button size="xs" variant="ghost" disabled={disabled} className="ms-auto">
                이 범위 값 지우기
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 관리 정책 잠금 문장(lockInfo). 정책 파일 경로는 툴팁(title)으로만. */
export function LockNote({ path = "/etc/fresnel/managed.json" }: { path?: string }) {
  return (
    <p title={path} className="m-0 flex min-w-0 items-center gap-1.5 text-ui-sm text-text-tertiary">
      <Lock aria-hidden className="size-icon-xs flex-none" />
      <span className="flex-none">관리 정책으로 잠김</span>
    </p>
  );
}

/** List reorderable에 주는 한국어 문구(caustic은 기본 영어 문구가 없어 소비자가 준다). */
export const reorderLabels = {
  handleLabel: (t: string) => `${t} 순서 바꾸기`,
  instructions: "Space로 잡고 위아래 화살표로 옮긴 뒤 Space로 놓아요. Esc는 취소예요.",
  announce: (e: ListReorderAnnouncement) =>
    e.type === "picked"
      ? `${e.title}을 잡았어요. ${e.size}개 중 ${e.position}번째예요.`
      : e.type === "moved"
        ? `${e.position}번째`
        : e.type === "dropped"
          ? `${e.title}을 ${e.position}번째로 옮겼어요.`
          : `${e.title} 옮기기를 취소했어요.`,
};
