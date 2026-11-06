// P-02 받은 요청 탭 내용(오른쪽 well). 승인 결정 상태가 이 목업의 store에 있어서 페이지 쪽에 둔다.
// 카드 부품(ToolApprovalCard, QuestionCard, NoticeList)은 공용 셸의 것이다.
import { Button } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { approvals, inbox } from "./fixtures";
import { NoticeList, QuestionCard, ToolApprovalCard } from "../_shell";
import { useMock } from "./store";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-1.5">
      <h3 className="m-0 flex items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
        {title}
        {count !== undefined && <span className="tabular-nums text-text-tertiary">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export function InboxContent() {
  const m = useMock();
  const proposal = inbox.proposals[0];
  const [questionOpen, setQuestionOpen] = useState(false);
  return (
    <div className="grid gap-5">
      <Section title="승인" count={m.pendingApprovals}>
        <div className="grid gap-4">
          <ToolApprovalCard
            flat
            approval={approvals.a1}
            decision={m.decisions.a1}
            subtitle={`${approvals.a1.thread} · ${approvals.a1.at}`}
            onDecide={(d) => m.decide("a1", d)}
            locked={m.reconnecting}
          />
          <QuestionCard
            flat
            approval={approvals.a2}
            status={
              m.decisions.a2 === "answered"
                ? "answered"
                : m.decisions.a2 === "denied"
                  ? "denied"
                  : "pending"
            }
            subtitle={`${approvals.a2.thread} · ${approvals.a2.at}`}
            answer={m.answer}
            onAnswerChange={m.setAnswer}
            onAnswer={() => m.decide("a2", "answered")}
            onDeny={() => m.decide("a2", "denied")}
            locked={m.reconnecting}
            summary={questionOpen ? undefined : { onOpen: () => setQuestionOpen(true) }}
            autoFocus={questionOpen}
          />
        </div>
      </Section>
      {proposal !== undefined && (
        <Section title="제안">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-0 flex-1 truncate text-ui-sm text-text-primary">
              {proposal.kind} <span className="font-mono text-mono-sm">{proposal.target}</span>
            </div>
            <Button size="xs" variant="ghost">
              열기
            </Button>
          </div>
        </Section>
      )}
      <Section title="알림">
        <NoticeList notices={inbox.notices} />
      </Section>
    </div>
  );
}
