// 받은 요청 탭 내용(오른쪽 well)의 가벼운 판. P-02(p02-opus/inbox.tsx)와 같은 구성(승인, 제안, 알림)이고 승인 결정만 이 판 안에 둔다.
// 런타임 묶음(P-05, P-07, P-08, P-14)이 같이 쓴다. 각 mockup.css가 이 폴더를 @source로 읽는다.
import { Button } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { approvals, inbox, NoticeList, ToolApprovalCard, type Decision } from "../../../_shell";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-1.5">
      <h3 className="m-0 flex items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function InboxLite() {
  const [decision, setDecision] = useState<Decision>("pending");
  const proposal = inbox.proposals[0];
  return (
    <div className="grid gap-5">
      <Section title="승인">
        <ToolApprovalCard
          flat
          approval={approvals.a1}
          decision={decision}
          subtitle={`${approvals.a1.thread} · ${approvals.a1.at}`}
          onDecide={setDecision}
        />
        <div className="flex min-w-0 items-center gap-2.5 text-ui-sm">
          <span className="min-w-0 flex-1 truncate text-text-primary">
            질문 · {approvals.a2.questions[0]?.header}{" "}
            <span className="text-text-tertiary">
              {approvals.a2.thread} · {approvals.a2.at}
            </span>
          </span>
          <Button size="xs" tone="neutral" variant="ghost">
            답하기
          </Button>
        </div>
      </Section>
      {proposal !== undefined && (
        <Section title="제안">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="min-w-0 flex-1 truncate text-ui-sm text-text-primary">
              {proposal.kind} <span className="font-mono text-mono-sm">{proposal.target}</span>{" "}
              <span className="text-text-tertiary">{proposal.extra}</span>
            </div>
            <Button size="xs" tone="neutral" variant="ghost">
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
