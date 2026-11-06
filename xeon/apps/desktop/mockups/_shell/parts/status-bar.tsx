// caustic 빈틈 C-03(상태 표시줄): AppShell에 창 아래 띠 슬롯이 없다. AppShell 아래(같은 창 바탕 bg-app 위)에 높이 28px 띠로 만든다.
// 그리고 C-05(게이지): 토큰 사용량은 Meter 대신 Progress bar로 대신한다.
// 칸마다 caustic Button(size xs, variant ghost)과 Popover를 쓰고, 칸 사이 구분선과 상태 점만 토큰으로 직접 그린다.
// 접근성: 띠 전체가 role="status" 하나이고, 개수 칸은 "승인 대기 2개"처럼 문장 라벨을 단다.
import { Button, Popover, PopoverDescription, PopoverTitle, Progress } from "@caustic/react";
import type { ReactNode } from "react";
import { L } from "../i18n";

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
  /** Popover 안 설명 아래에 더 그릴 내용(예: 플러그인 status 기여의 Popover 트리). */
  content?: ReactNode;
  action?: { label: string; onSelect: () => void };
  // 묶음 D(셸 수명, m4/pg-d): 모두 선택 항목이라 다른 페이지는 그대로 그려진다.
  /** Popover 설명 아래 본문(백그라운드 작업 목록, 대상 요약 등). */
  body?: ReactNode;
  /** Popover 안 둘째 동작(예: "진단 복사"). */
  secondary?: { label: string; onSelect: () => void } | undefined;
  /** 칸 바로 옆에 띠 위 버튼으로 보이는 동작(엔진 실패 때 "엔진 다시 시작"·"진단 복사", §6.3 그림). */
  inline?: { label: string; onSelect: () => void }[] | undefined;
  /** 처음부터 Popover를 연다(목업 스크린숏용). */
  defaultOpen?: boolean | undefined;
  /** 본문이 목록이면 넓은 Popover(lg 320). */
  wide?: boolean | undefined;
}

// 묶음 E(N-49 긴 라벨 규칙): 띠가 모자라면 칸을 통째로 자르지 않고 글을 말줄임한다. 개수 칸(승인, 알림, 확장 실패, 진행 중)과
// 점이 있는 칸(연결·엔진 상태)은 줄이지 않고, 나머지(대상·모델·주도)가 먼저 줄어든다. 자리가 넉넉하면 예전과 똑같다.
const KEEP = new Set([
  "approvals",
  "notices",
  "ext-failures",
  "live",
  "link",
  "engine",
  "tokens",
  "goal",
]);

function Cell({ cell }: { cell: StatusCell }) {
  const keep = KEEP.has(cell.id) || cell.inline !== undefined;
  return (
    <Popover
      side="top"
      align="start"
      size={cell.wide === true ? "lg" : "sm"}
      {...(cell.defaultOpen === true ? { defaultOpen: true } : { defaultOpen: false })}
      anchor={
        <Button
          size="xs"
          variant="ghost"
          aria-label={cell.label}
          title={keep || typeof cell.text !== "string" ? undefined : cell.text}
          className={`h-6 min-w-0 max-w-full gap-1.5 px-1.5 text-ui-xs font-normal text-text-secondary ${keep ? "" : "[&>[data-cell-text]]:truncate"}`}
        >
          {cell.dot !== undefined && (
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dotClass[cell.dot]}`} />
          )}
          {cell.icon !== undefined && (
            <span aria-hidden className="inline-flex text-text-tertiary [&_svg]:size-icon-xs">
              {cell.icon}
            </span>
          )}
          <span data-cell-text="" className="min-w-0 whitespace-nowrap tabular-nums">
            {cell.text}
          </span>
          {cell.trailing}
        </Button>
      }
    >
      <PopoverTitle>{cell.title}</PopoverTitle>
      <PopoverDescription>{cell.description}</PopoverDescription>
      {cell.content}
      {cell.body}
      {(cell.action !== undefined || cell.secondary !== undefined) && (
        <div className="flex flex-wrap gap-1.5">
          {cell.action !== undefined && (
            <Button size="xs" tone="secondary" onClick={cell.action.onSelect}>
              {cell.action.label}
            </Button>
          )}
          {cell.secondary !== undefined && (
            <Button size="xs" variant="ghost" onClick={cell.secondary.onSelect}>
              {cell.secondary.label}
            </Button>
          )}
        </div>
      )}
    </Popover>
  );
}

/** 칸 옆 띠 위 버튼(묶음 D): 엔진 실패처럼 한 번에 눌러야 하는 동작만. */
function InlineActions({ cell }: { cell: StatusCell }) {
  if (cell.inline === undefined || cell.inline.length === 0) return null;
  return (
    <span className="ms-1 flex items-center gap-1">
      {cell.inline.map((a) => (
        <Button
          key={a.label}
          size="xs"
          variant="outline"
          className="h-5 px-1.5 text-ui-xs"
          onClick={a.onSelect}
        >
          {a.label}
        </Button>
      ))}
    </span>
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
      <span
        key={c.id}
        className={`flex min-w-0 items-center ${KEEP.has(c.id) || c.inline !== undefined ? "shrink-0" : "min-w-12 shrink"}`}
      >
        {i > 0 && <Sep />}
        <Cell cell={c} />
        <InlineActions cell={c} />
      </span>
    ));
  return (
    <div
      role="status"
      aria-label={L("상태 표시줄")}
      data-slot="status-bar"
      className="flex h-7 flex-none items-center gap-2 overflow-hidden px-2 font-ui text-ui-xs text-text-secondary"
    >
      <div className="flex min-w-0 shrink items-center">{row(start)}</div>
      <span aria-hidden className="flex-1" />
      <div className="flex min-w-0 shrink items-center">{row(end)}</div>
    </div>
  );
}

/** 토큰 사용량 막대(게이지 대용, C-05). */
export function TokenBar({ ratio }: { ratio: number }) {
  return <Progress value={Math.round(ratio * 100)} decorative size="xs" className="w-12" />;
}
