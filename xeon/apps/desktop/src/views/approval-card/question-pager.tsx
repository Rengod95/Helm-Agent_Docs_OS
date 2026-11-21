import { t } from "@fresnel/client/i18n";
import { IconButton } from "@caustic/react";
import { ChevronLeft, ChevronRight } from "@caustic/react/icons";
import type { ReactNode } from "react";
import type { QuestionStep } from "./question-pages.ts";

// 질문 카드의 넘김 표시(DP-224 [결정: 2026-11-20 사용자, AGE-65]). 단추 줄 왼쪽에 [이전] 막대들 [다음] "n / 전체"를 둔다.
// 막대 하나가 질문 하나다: 지금 질문은 넓고(24) 나머지는 좁다(12). 답한 질문은 채운 막대, 아직 답하지 않은 질문은 속이 빈 막대라
// 어느 질문이 남았는지 보인다. 색은 글자색 단계(primary·tertiary)와 테두리 색만 쓴다. 숫자는 본문 글꼴의 tabular 숫자다.
// 시안 셋(막대, 번호 단추, 질문 머리 탭)을 앱에서 그려 보고 막대를 골랐다(_notes/design/lc/lcQ1-shots/app-pager-*.png):
// 번호 단추는 지금 질문의 답 여부가 안 보이고, 머리 탭은 본문 위에 한 줄(28)을 더 써 작은 창에서 선택지를 밀어낸다.

function stepLabelOf(step: QuestionStep, total: number): string {
  const position = t("desktop.approvals.question.position", { n: step.index + 1, total });
  const name = step.header === null ? position : `${position} · ${step.header}`;
  const state = t(
    step.answered
      ? "desktop.approvals.question.step.answered"
      : "desktop.approvals.question.step.open",
  );
  return `${name}, ${state}`;
}

function barToneOf(step: QuestionStep): string {
  if (step.answered)
    return step.current ? "bg-text-primary" : "bg-text-tertiary group-hover/step:bg-text-secondary";
  return step.current
    ? "shadow-[inset_0_0_0_1.5px_var(--cs-color-text-primary)]"
    : "shadow-[inset_0_0_0_1.5px_var(--cs-color-border-strong)] group-hover/step:shadow-[inset_0_0_0_1.5px_var(--cs-color-text-tertiary)]";
}

export function QuestionPager(props: {
  readonly steps: readonly QuestionStep[];
  readonly disabled: boolean;
  readonly onPage: (index: number) => void;
}): ReactNode {
  const { steps } = props;
  const total = steps.length;
  const current = steps.find((step) => step.current)?.index ?? 0;
  return (
    <nav
      data-slot="question-pager"
      aria-label={t("desktop.approvals.question.pager")}
      // 이전 단추의 아이콘이 제목 열(왼쪽 40)에 맞도록 단추 안쪽 여백만큼 당긴다
      className="-ml-1.5 flex items-center"
    >
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        data-action="question-prev"
        label={t("desktop.approvals.question.prev")}
        disabled={props.disabled || current === 0}
        onClick={() => {
          props.onPage(current - 1);
        }}
      >
        <ChevronLeft aria-hidden />
      </IconButton>
      <span className="flex items-center">
        {steps.map((step) => {
          const label = stepLabelOf(step, total);
          return (
            <button
              key={step.id}
              type="button"
              data-step={step.answered ? "answered" : "open"}
              aria-current={step.current ? "step" : undefined}
              aria-label={label}
              title={label}
              disabled={props.disabled}
              className="group/step grid h-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent px-1 outline-none focus-visible:shadow-focus disabled:cursor-default"
              onClick={() => {
                props.onPage(step.index);
              }}
            >
              <span
                aria-hidden
                className={`block h-1 rounded-full transition-[width,background-color,box-shadow] duration-150 motion-reduce:transition-none ${step.current ? "w-6" : "w-3"} ${barToneOf(step)}`}
              />
            </button>
          );
        })}
      </span>
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        data-action="question-next"
        label={t("desktop.approvals.question.nextLabel")}
        disabled={props.disabled || current === total - 1}
        onClick={() => {
          props.onPage(current + 1);
        }}
      >
        <ChevronRight aria-hidden />
      </IconButton>
      <span aria-hidden className="ml-1 text-ui-sm text-text-tertiary tabular-nums">
        {t("desktop.approvals.question.count", { n: current + 1, total })}
      </span>
    </nav>
  );
}
