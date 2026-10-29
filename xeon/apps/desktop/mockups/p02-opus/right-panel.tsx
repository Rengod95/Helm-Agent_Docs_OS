// 오른쪽 맥락 패널(DP-10). 접으면 아이콘만 있는 세로 떠 있는 막대(caustic FloatingBar vertical).
// 펼치면 누른 아이콘 옆에서 두 단계로 펼친다: 바깥 well(Card variant="well") 안에 내용 카드(CardPanel).
// 넓은 폭에서는 대화 영역을 밀고(헤어라인), 1100px 이하에서는 대화 위에 떠서 그림자 하나만 가진다.
import {
  Button,
  Card,
  CardPanel,
  EmptyState,
  FloatingBar,
  FloatingBarItem,
  IconButton,
  ScrollArea,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { approvals, inbox } from "./fixtures";
import { Compass, Inbox, ListChecks, Sparkles, X } from "./icons";
import { NoticeList } from "./parts/notice-list";
import { QuestionCard } from "./parts/question-card";
import { useMock, type EndTab } from "./store";
import { ToolApprovalCard } from "./tool-approval";

const TABS: { id: EndTab; label: string; icon: ReactNode }[] = [
  { id: "inbox", label: "받은 요청", icon: <Inbox /> },
  { id: "helm", label: "탐구", icon: <Compass /> },
  { id: "work", label: "작업", icon: <ListChecks /> },
];

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

function InboxContent() {
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
        <Section title="제안" count={3}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Sparkles aria-hidden className="size-icon-sm shrink-0 text-text-tertiary" />
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
      <Section title="알림" count={inbox.notices.length}>
        <NoticeList notices={inbox.notices} />
      </Section>
    </div>
  );
}

export function RightPanel() {
  const m = useMock();
  const tabs = m.view === "none" ? TABS.filter((t) => t.id === "inbox") : TABS;
  const tab: EndTab = m.view === "none" ? "inbox" : m.endTab;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const overlay = m.layout !== "wide";
  const inboxCount = m.pendingApprovals + 3;
  const open = m.endOpen;

  return (
    <aside aria-label="맥락 패널" className="relative flex flex-none items-start gap-1.5">
      {open && (
        <Card
          variant="well"
          size="sm"
          role="region"
          aria-label={current.label}
          // 아이콘 쪽(위 오른쪽)에서 펼쳐지는 느낌: 그 모서리를 원점으로 커지며 나타난다.
          className={[
            "flex w-[352px] max-w-[calc(100vw-4.5rem)] flex-col self-stretch origin-top-right animate-enter enter-scale",
            overlay ? "absolute inset-y-0 end-[calc(100%+0.375rem)] z-30 shadow-3" : "",
          ].join(" ")}
        >
          <div className="flex h-8 flex-none items-center gap-1.5 ps-2.5 pe-0.5">
            <h2 className="m-0 flex-1 truncate text-ui-sm font-semibold text-text-primary">
              {current.label}
            </h2>
            <IconButton
              size="xs"
              variant="ghost"
              label="맥락 패널 접기"
              onClick={() => m.setEndOpen(false)}
            >
              <X />
            </IconButton>
          </div>
          <CardPanel className="flex min-h-0 flex-1 flex-col gap-0 p-0">
            <ScrollArea label={current.label} className="min-h-0 flex-1">
              <div className="p-3">
                {tab === "inbox" && <InboxContent />}
                {tab !== "inbox" && (
                  <EmptyState
                    size="sm"
                    surface="none"
                    icon={current.icon}
                    title="셸 목업에서는 비어 있어요"
                  />
                )}
              </div>
            </ScrollArea>
          </CardPanel>
        </Card>
      )}
      <FloatingBar label="맥락 패널" orientation="vertical" size="sm" shadow="2">
        {tabs.map((t) => (
          <FloatingBarItem
            key={t.id}
            icon={t.icon}
            aria-label={t.id === "inbox" ? `${t.label} ${inboxCount}개` : t.label}
            aria-expanded={open && tab === t.id}
            active={open && tab === t.id}
            {...(t.id === "inbox" && !(open && tab === "inbox") ? { badge: inboxCount } : {})}
            onClick={() => (open && tab === t.id ? m.setEndOpen(false) : m.openEnd(t.id))}
          />
        ))}
      </FloatingBar>
    </aside>
  );
}
