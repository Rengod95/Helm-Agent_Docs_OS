// caustic 빈틈: AgentRequest의 proposal은 "Proposal · " 머리가 영어로 붙고 review는 떠 있는 패널 모양이라,
// 받은 요청 목록 안의 계획·변경 검토 카드로 쓰기 어렵다. 공용 QuestionCard(_shell/parts/question-card.tsx)와 같은 치수
// (2xl 모서리, compact 안쪽 여백, 36px 타일, border-subtle 헤어라인, ui-strong 제목)로 머리·본문·버튼 줄을 짠다.
// 버튼 줄 규칙은 AgentRequest와 같다: 거부(danger) = ghost 시작 쪽, 확정 = 잉크 끝 쪽.
import { Button, Card } from "@caustic/react";
import { Fragment, useId, type ReactNode } from "react";

export interface RequestAction {
  id: string;
  label: string;
  tone: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export interface RequestCardProps {
  icon: ReactNode;
  /** 타일 색: bg-*-soft text-*-text */
  tileTone: string;
  title: ReactNode;
  subtitle: ReactNode;
  actions: RequestAction[];
  onAction?: (id: string) => void;
  locked?: boolean;
  children?: ReactNode;
}

const LOOK = {
  primary: { variant: "solid" },
  secondary: { variant: "outline" },
  danger: { variant: "ghost" },
} as const;

export function RequestCard({
  icon,
  tileTone,
  title,
  subtitle,
  actions,
  onAction,
  locked = false,
  children,
}: RequestCardProps) {
  const titleId = useId();
  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      variant="surface"
      className="grid min-w-0 gap-2.5 rounded-2xl bg-surface-base px-inset-compact-x py-inset-compact-y shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none animate-rise focus-visible:focus-ring"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={`grid size-card-tile shrink-0 place-items-center rounded-lg [&_svg]:size-card-glyph ${tileTone}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div id={titleId} className="text-ui-strong font-semibold text-text-primary">
            {title}
          </div>
          <div className="mt-0.5 truncate text-ui-sm text-text-secondary">{subtitle}</div>
        </div>
      </div>
      <fieldset disabled={locked} className="m-0 grid min-w-0 gap-2.5 border-0 p-0">
        {children}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {actions.map((a, i) => (
            <Fragment key={a.id}>
              <Button
                size="sm"
                tone="neutral"
                {...LOOK[a.tone]}
                disabled={a.disabled === true}
                onClick={() => onAction?.(a.id)}
              >
                {a.label}
              </Button>
              {a.tone === "danger" && i === 0 && <span aria-hidden className="flex-1" />}
            </Fragment>
          ))}
        </div>
      </fieldset>
    </Card>
  );
}
