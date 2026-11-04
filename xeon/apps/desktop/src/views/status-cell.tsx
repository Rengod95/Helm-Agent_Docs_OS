// 상태 표시줄의 칸 하나(B-09, d02). 점과 글이 보이는 단추이고, 누르면 Popover가 열려 제목·설명·본문을 보인다.
// 칸은 caustic Button(xs, ghost)과 Popover를 쓴다. 점은 색만으로 뜻을 주지 않도록 칸 글이 따로 있다.
// 열림은 칸을 둔 쪽이 든다(`open`, `onOpenChange`). 목록에서 고른 뒤 닫아야 하는 칸은 그 쪽에서 닫는다.
import { Button, Popover, PopoverDescription, PopoverTitle } from "@caustic/react";
import type { ReactNode } from "react";

export type StatusDot = "success" | "warning" | "danger" | "neutral";

const DOT_CLASS: Readonly<Record<StatusDot, string>> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

export interface StatusCellProps {
  /** 칸의 식별자(`data-bar-cell`). 시험이 이 값으로 찾는다 */
  readonly cellId: string;
  /** 칸에 보이는 글 */
  readonly text: string;
  /** 상태 점. 없으면 점을 그리지 않는다 */
  readonly dot?: StatusDot | undefined;
  /** Popover 제목 */
  readonly title: string;
  /** Popover 설명. 없으면 생략한다 */
  readonly description?: string | undefined;
  /** Popover 설명 아래 본문. 없으면 생략한다 */
  readonly body?: ReactNode;
  /** 본문이 목록이면 넓은 Popover를 연다 */
  readonly wide?: boolean | undefined;
  /** Popover가 열려 있는가. 칸을 둔 쪽이 든다 */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function StatusCell(props: StatusCellProps): ReactNode {
  const { cellId, text, dot, title, description, body, wide, open, onOpenChange } = props;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="top"
      align="start"
      size={wide === true ? "lg" : "sm"}
      anchor={
        <Button
          size="xs"
          variant="ghost"
          className="h-6 min-w-0 max-w-full gap-1.5 px-1.5 text-ui-xs font-normal"
          data-bar-cell={cellId}
        >
          {dot === undefined ? null : (
            <span
              aria-hidden
              data-bar-dot={dot}
              className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[dot]}`}
            />
          )}
          <span className="min-w-0 whitespace-nowrap tabular-nums">{text}</span>
        </Button>
      }
    >
      <PopoverTitle>{title}</PopoverTitle>
      {description === undefined ? null : <PopoverDescription>{description}</PopoverDescription>}
      {body}
    </Popover>
  );
}
