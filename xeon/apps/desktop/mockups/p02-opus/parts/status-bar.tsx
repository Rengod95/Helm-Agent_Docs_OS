// caustic 빈틈 C-03(상태 표시줄): AppShell에 창 아래 띠 슬롯이 없다. AppShell 아래(같은 창 바탕 bg-app 위)에 높이 28px 띠로 만든다.
// 그리고 C-05(게이지): 토큰 사용량은 Meter 대신 Progress bar로 대신한다.
// 칸마다 caustic Button(size xs, variant ghost)과 Popover를 쓰고, 칸 사이 구분선과 상태 점만 토큰으로 직접 그린다.
// 접근성: 띠 전체가 role="status" 하나이고, 개수 칸은 "승인 대기 2개"처럼 문장 라벨을 단다.
import { Button, Popover, PopoverDescription, PopoverTitle, Progress } from "@caustic/react";
import type { ReactNode } from "react";

type Dot = "success" | "warning" | "danger" | "neutral";
const dotClass: Record<Dot, string> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

export interface StatusCell {
  id: string;
  /** 칸에 보이는 글 */
  text: ReactNode;
  /** 보이는 글과 다를 때 스크린 리더용 문장 */
  label?: string;
  icon?: ReactNode;
  dot?: Dot;
  /** 칸 안 꼬리(토큰 막대 등) */
  trailing?: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onSelect: () => void };
}

function Cell({ cell }: { cell: StatusCell }) {
  return (
    <Popover
      side="top"
      align="start"
      size="sm"
      anchor={
        <Button
          size="xs"
          variant="ghost"
          aria-label={cell.label}
          className="h-6 gap-1.5 px-1.5 text-ui-xs font-normal text-text-secondary"
        >
          {cell.dot !== undefined && (
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dotClass[cell.dot]}`} />
          )}
          {cell.icon !== undefined && (
            <span aria-hidden className="inline-flex text-text-tertiary [&_svg]:size-icon-xs">
              {cell.icon}
            </span>
          )}
          <span className="whitespace-nowrap tabular-nums">{cell.text}</span>
          {cell.trailing}
        </Button>
      }
    >
      <PopoverTitle>{cell.title}</PopoverTitle>
      <PopoverDescription>{cell.description}</PopoverDescription>
      {cell.action !== undefined && (
        <div>
          <Button size="xs" tone="secondary" onClick={cell.action.onSelect}>
            {cell.action.label}
          </Button>
        </div>
      )}
    </Popover>
  );
}

function Sep() {
  return <span aria-hidden className="mx-0.5 h-3 w-px shrink-0 bg-border-subtle" />;
}

export interface StatusBarProps {
  start: StatusCell[];
  end: StatusCell[];
}

export function StatusBar({ start, end }: StatusBarProps) {
  const row = (cells: StatusCell[]) =>
    cells.map((c, i) => (
      <span key={c.id} className="flex items-center">
        {i > 0 && <Sep />}
        <Cell cell={c} />
      </span>
    ));
  return (
    <div
      role="status"
      aria-label="상태 표시줄"
      data-slot="status-bar"
      className="flex h-7 flex-none items-center gap-2 overflow-hidden px-2 font-ui text-ui-xs text-text-secondary"
    >
      <div className="flex min-w-0 items-center">{row(start)}</div>
      <span aria-hidden className="flex-1" />
      <div className="flex min-w-0 items-center">{row(end)}</div>
    </div>
  );
}

/** 토큰 사용량 막대(게이지 대용, C-05). */
export function TokenBar({ ratio }: { ratio: number }) {
  return <Progress value={Math.round(ratio * 100)} decorative size="xs" className="w-12" />;
}
