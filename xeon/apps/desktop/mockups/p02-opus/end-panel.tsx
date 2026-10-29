// 끝 영역(맥락 패널): Tabs 세 개(받은 요청, 탐구, 작업). 받은 요청만 채운다.
// 대화를 고르지 않았으면(S2) 받은 요청 탭 하나만 보인다.
import {
  Button,
  EmptyState,
  SidePanel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { approvals, inbox } from "./fixtures";
import { Compass, ListChecks, Sparkles } from "./icons";
import { NoticeList } from "./parts/notice-list";
import { QuestionCard } from "./parts/question-card";
import { useMock, type EndTab } from "./store";
import { ToolApprovalCard } from "./tool-approval";

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
    <section aria-label={title} className="grid gap-2">
      <h3 className="m-0 flex items-baseline gap-1.5 px-1 text-ui-sm font-semibold text-text-primary">
        {title}
        {count !== undefined && <span className="tabular-nums text-text-tertiary">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function InboxTab() {
  const m = useMock();
  const proposal = inbox.proposals[0];
  const [questionOpen, setQuestionOpen] = useState(false);
  return (
    <div className="grid gap-5 px-3 pt-1 pb-4">
      <Section title="승인" count={m.pendingApprovals}>
        <ToolApprovalCard
          approval={approvals.a1}
          decision={m.decisions.a1}
          subtitle={`${approvals.a1.thread} · ${approvals.a1.at}`}
          onDecide={(d) => m.decide("a1", d)}
          locked={m.reconnecting}
        />
        <QuestionCard
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
      </Section>
      {proposal !== undefined && (
        <Section title="제안" count={3}>
          <div className="flex min-w-0 items-center gap-3 rounded-xl bg-surface-base px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
            <Sparkles aria-hidden className="size-icon-md shrink-0 text-text-tertiary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui-strong text-text-primary">
                {proposal.kind}: <span className="font-mono text-mono">{proposal.target}</span>{" "}
                {proposal.extra}
              </div>
              <div className="text-ui-xs text-text-tertiary">출처 {proposal.source}</div>
            </div>
            <Button size="xs" tone="neutral" variant="outline">
              제안 열기
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

export function EndPanel({ id }: { id: string }) {
  const m = useMock();
  const onlyInbox = m.view === "none";
  const tab: EndTab = onlyInbox ? "inbox" : m.endTab;
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => m.openEnd(v as EndTab)}
      size="sm"
      className="flex min-h-0 flex-col rounded-panel"
    >
      <SidePanel
        id={id}
        side="end"
        preset="pane"
        label="맥락 패널"
        scrollLabel="받은 요청과 맥락"
        className="min-h-0 flex-1"
        collapsed={!m.endOpen}
        onCollapsedChange={(c) => m.setEndOpen(!c)}
        collapseLabel="맥락 패널 닫기 (⌘J)"
        header={
          <TabsList aria-label="맥락 패널 탭" className="border-b-0">
            <TabsTrigger value="inbox" count={m.pendingApprovals + 3}>
              받은 요청
            </TabsTrigger>
            {!onlyInbox && <TabsTrigger value="helm">탐구</TabsTrigger>}
            {!onlyInbox && <TabsTrigger value="work">작업</TabsTrigger>}
          </TabsList>
        }
      >
        <TabsContent value="inbox">
          <InboxTab />
        </TabsContent>
        {!onlyInbox && (
          <TabsContent value="helm" className="p-3">
            <EmptyState
              size="sm"
              icon={<Compass />}
              title="셸 목업에서는 비어 있어요"
              description="Helm 탐구 진행과 렌즈가 여기에 와요."
            />
          </TabsContent>
        )}
        {!onlyInbox && (
          <TabsContent value="work" className="p-3">
            <EmptyState
              size="sm"
              icon={<ListChecks />}
              title="셸 목업에서는 비어 있어요"
              description="목표와 작업 목록이 여기에 와요."
            />
          </TabsContent>
        )}
      </SidePanel>
    </Tabs>
  );
}
