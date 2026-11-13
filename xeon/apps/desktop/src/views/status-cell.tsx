// 상태 표시줄의 칸 하나(B-09, d02, DP-182). 점·아이콘과 글이 보이는 단추다. 누르면 Popover가 열려 제목·설명·본문을 보이거나(`StatusCell`),
// 곧장 관련 화면으로 간다(`StatusAction`). 칸은 caustic Button(xs, ghost)이고 줄 높이에 맞춰 20px이다(styles.css `.statusbar`).
// 글은 12px(`text-ui-sm`), 평소 tertiary이고 경고·위험일 때만 그 글자색이다. 점·아이콘과 글 사이는 4px.
// 점은 색만으로 뜻을 주지 않도록 글이 따로 있다. 글 없이 점만 둔 칸(정상인 엔진)은 `label`이 이름이다.
// 열림은 칸을 둔 쪽이 든다(`open`, `onOpenChange`). 목록에서 고른 뒤 닫아야 하는 칸은 그 쪽에서 닫는다.
import { Button, Popover, PopoverDescription, PopoverTitle } from "@caustic/react";
import type { ReactNode } from "react";

export type StatusDot = "success" | "warning" | "danger" | "neutral";
export type StatusTone = "warning" | "danger";

const DOT_CLASS: Readonly<Record<StatusDot, string>> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

const TONE_CLASS: Readonly<Record<StatusTone | "none", string>> = {
  none: "text-text-tertiary hover:text-text-secondary aria-expanded:text-text-secondary",
  warning: "text-warning-text",
  danger: "text-danger-text",
};

/** 칸의 겉(단추 안에 보이는 것). 팝오버 칸과 바로 가는 칸이 같이 쓴다 */
export interface StatusCellFace {
  /** 칸의 식별자(`data-bar-cell`). 시험이 이 값으로 찾는다 */
  readonly cellId: string;
  /** 칸에 보이는 글. null이면 점(또는 아이콘)만 보이고 `label`이 이름이다 */
  readonly text: string | null;
  /** 글이 없을 때 단추 이름(화면 낭독, 툴팁) */
  readonly label?: string | undefined;
  /** 글 앞에 늘 보이는 12px 아이콘 */
  readonly icon?: ReactNode;
  /** 글 뒤에 붙는 꼬리(사용량 막대 등). 없으면 그리지 않는다 */
  readonly trailing?: ReactNode;
  /** 상태 점. 없으면 점을 그리지 않는다 */
  readonly dot?: StatusDot | undefined;
  /** 글자색. 없으면 평소(tertiary) */
  readonly tone?: StatusTone | undefined;
  /** 좁은 폭(`styles.css`의 `.statusbar` 컨테이너 쿼리)에서 글을 접고 이 아이콘만 보일 칸. 없으면 접히지 않는다 */
  readonly collapseIcon?: ReactNode;
}

export interface StatusCellProps extends StatusCellFace {
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

function faceButton(face: StatusCellFace, onClick?: () => void): ReactNode {
  const { cellId, text, label, icon, trailing, dot, tone, collapseIcon } = face;
  // 접히는 칸과 점만 있는 칸은 글을 툴팁으로도 준다
  const tip = text === null ? label : collapseIcon === undefined ? undefined : text;
  return (
    <Button
      size="xs"
      variant="ghost"
      className={`min-w-0 max-w-full gap-1 px-1.5 text-ui-sm font-normal ${TONE_CLASS[tone ?? "none"]}`}
      data-bar-cell={cellId}
      data-bar-collapsible={collapseIcon === undefined ? undefined : ""}
      data-bar-tone={tone}
      title={tip}
      aria-label={text === null ? label : undefined}
      onClick={onClick}
    >
      {collapseIcon === undefined ? null : (
        <span aria-hidden data-bar-icon className="shrink-0">
          {collapseIcon}
        </span>
      )}
      {icon === undefined ? null : (
        <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-3">
          {icon}
        </span>
      )}
      {dot === undefined ? null : (
        <span
          aria-hidden
          data-bar-dot={dot}
          className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[dot]}`}
        />
      )}
      {text === null ? null : (
        <span data-bar-text className="min-w-0 truncate whitespace-nowrap tabular-nums">
          {text}
        </span>
      )}
      {trailing === undefined ? null : <span data-bar-trailing>{trailing}</span>}
    </Button>
  );
}

/** 누르면 Popover가 열리는 칸 */
export function StatusCell(props: StatusCellProps): ReactNode {
  const { title, description, body, wide, open, onOpenChange } = props;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="top"
      align="start"
      size={wide === true ? "lg" : "sm"}
      anchor={faceButton(props)}
    >
      <PopoverTitle>{title}</PopoverTitle>
      {description === undefined ? null : <PopoverDescription>{description}</PopoverDescription>}
      {body}
    </Popover>
  );
}

/** 누르면 곧장 관련 화면으로 가는 칸(승인 대기 → 받은 요청). 팝오버를 거치지 않는다 */
export function StatusAction(props: StatusCellFace & { readonly onSelect: () => void }): ReactNode {
  return faceButton(props, props.onSelect);
}
