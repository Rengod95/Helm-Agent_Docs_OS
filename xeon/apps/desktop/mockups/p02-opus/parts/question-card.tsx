// caustic 빈틈: AgentRequest의 kind는 proposal·review·permission뿐이라 "질문"(선택지 + 직접 입력 + 답하기/거부)이 없다.
// permission은 방패 타일이 고정이고 proposal은 "Proposal · " 머리가 영어로 붙는다. 그래서 질문 카드는 caustic Card 위에
// AgentRequest permission 카드와 같은 치수(2xl 모서리, compact 안쪽 여백, 36px 타일, border-subtle 헤어라인, ui-strong 제목)로 직접 짠다.
// 선택지는 caustic ChoiceGroup(appearance answer), 직접 입력은 Input, 버튼은 AgentRequest와 같은 규칙(거부 = ghost 시작 쪽,
// 확정 = 잉크 끝 쪽)이다. 답한 뒤 기록 줄은 AgentRequest의 record(status answered/denied)를 그대로 쓴다.
import { AgentRequest, Button, Card, ChoiceGroup, ChoiceGroupItem, Input } from "@caustic/react";
import { useId, type KeyboardEvent } from "react";
import type { QuestionApproval } from "../fixtures";
import { MessageCircleQuestion } from "../icons";

export interface QuestionCardProps {
  approval: QuestionApproval;
  status: "pending" | "answered" | "denied";
  /** 머리 둘째 줄: 대화 이름과 시각(끝 영역) 또는 시각만(트랜스크립트) */
  subtitle: string;
  answer: { pick: string | null; text: string };
  onAnswerChange: (a: { pick: string | null; text: string }) => void;
  onAnswer: () => void;
  onDeny: () => void;
  /** 연결이 끊겼을 때 응답 버튼과 입력을 잠근다 */
  locked?: boolean;
  /** 끝 영역 요약: 질문 한 줄과 "답하기"만 보이고, 누르면 펼친다 */
  summary?: { onOpen: () => void } | undefined;
  autoFocus?: boolean;
  /** 표면 안에 놓일 때 상자 없이 */
  flat?: boolean;
}

export function QuestionCard({
  approval,
  status,
  subtitle,
  answer,
  onAnswerChange,
  onAnswer,
  onDeny,
  locked = false,
  summary,
  flat = false,
  autoFocus,
}: QuestionCardProps) {
  const titleId = useId();
  const q = approval.questions[0];
  if (q === undefined) return null;

  if (status !== "pending") {
    const picked = q.options.find((o) => o.id === answer.pick)?.label ?? answer.text;
    return (
      <AgentRequest
        kind="permission"
        status={status}
        title={status === "answered" ? "답했어요" : "질문을 거부했어요"}
        subtitle={
          status === "answered" ? `${q.header} · ${picked}` : `${q.header} · ${approval.thread}`
        }
      />
    );
  }

  const ready = answer.pick !== null || answer.text.trim() !== "";
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      onDeny();
    }
  };

  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      aria-keyshortcuts="N"
      data-slot="question-card"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      variant={flat ? "ghost" : "surface"}
      className={
        flat
          ? "grid min-w-0 gap-2.5 rounded-none p-0 shadow-none outline-none focus-visible:focus-ring"
          : "grid min-w-0 gap-2.5 rounded-2xl bg-surface-base px-inset-compact-x py-inset-compact-y shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none animate-rise focus-visible:focus-ring"
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="grid size-card-tile shrink-0 place-items-center rounded-lg bg-info-soft text-info-text [&_svg]:size-card-glyph"
        >
          <MessageCircleQuestion />
        </span>
        <div className="min-w-0 flex-1">
          <div id={titleId} className="text-ui-strong font-semibold text-text-primary">
            질문 · {q.header}
          </div>
          <div className="mt-0.5 truncate text-ui-sm text-text-secondary">{subtitle}</div>
        </div>
      </div>

      {summary !== undefined ? (
        <div className="flex min-w-0 items-center gap-2">
          <p className="m-0 min-w-0 flex-1 truncate font-voice text-voice-sm text-text-primary">
            {q.text}
          </p>
          <Button
            size="xs"
            tone="neutral"
            variant="outline"
            disabled={locked}
            onClick={summary.onOpen}
          >
            답하기
          </Button>
        </div>
      ) : (
        <fieldset disabled={locked} className="m-0 grid min-w-0 gap-2.5 border-0 p-0">
          <ChoiceGroup
            appearance="answer"
            question={q.text}
            value={answer.pick ?? ""}
            onValueChange={(v) =>
              onAnswerChange({ ...answer, pick: typeof v === "string" && v !== "" ? v : null })
            }
            disabled={locked}
          >
            {q.options.map((o) => (
              <ChoiceGroupItem
                key={o.id}
                value={o.id}
                title={o.recommended === true ? `${o.label} (추천)` : o.label}
                description={o.description}
                autoFocus={autoFocus === true && o.recommended === true}
              />
            ))}
          </ChoiceGroup>
          {q.allowFreeText && (
            <Input
              size="sm"
              aria-label="직접 입력"
              placeholder="직접 입력"
              value={answer.text}
              onValueChange={(text) => onAnswerChange({ ...answer, text })}
            />
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Button size="sm" tone="neutral" variant="ghost" onClick={onDeny}>
              거부
            </Button>
            <span aria-hidden className="flex-1" />
            <Button size="sm" tone="neutral" variant="solid" disabled={!ready} onClick={onAnswer}>
              답하기
            </Button>
          </div>
        </fieldset>
      )}
    </Card>
  );
}
