// P-03 받은 요청(무대 전체 보기). 모든 대화의 승인·제안·알림을 한 읽기 열에 묶음별로 둔다.
// 행을 누르면 그 자리에서 승인 카드로 펼친다(트랜스크립트·오른쪽 well과 같은 카드 부품). 행마다 원인 대화와
// 그 항목을 낸 그룹·확장·계층(코어 루프, Helm 그룹, learning 그룹, ext:lint-bot …)을 둘째 줄에 보인다.
import {
  AgentRequest,
  Alert,
  Badge,
  Button,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  ScrollArea,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
  Skeleton,
  Textarea,
} from "@caustic/react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import {
  approvals as shared,
  CircleAlert,
  CircleCheck,
  defaultStatusCells,
  FileCode,
  Inbox,
  ListChecks,
  MessageCircleQuestion,
  PanelLeft,
  QuestionCard,
  Shell,
  ShieldCheck,
  Sparkles,
  standardRightTabs,
  Terminal,
  ToolApprovalCard,
  useShell,
  type Decision,
  type StatusCell,
} from "../_shell";
import {
  approvalRows,
  helmTool,
  notices,
  plan,
  proposals,
  review,
  type ApprovalId,
  type ApprovalRow,
} from "./fixtures";
import { InboxRow } from "./parts/inbox-row";
import { RequestCard } from "./parts/request-card";

export type InboxState = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";

const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";

function Section({
  title,
  count,
  end,
  children,
}: {
  title: string;
  count?: number | undefined;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-1">
      <h2 className="m-0 flex h-7 items-center gap-1.5 text-ui-sm font-semibold text-text-primary">
        {title}
        {count !== undefined && <span className="tabular-nums text-text-tertiary">{count}</span>}
        {end !== undefined && <span className="ms-auto">{end}</span>}
      </h2>
      {children}
    </section>
  );
}

const KIND_ICON: Record<ApprovalRow["kind"], ReactNode> = {
  도구: <Terminal />,
  질문: <MessageCircleQuestion />,
  계획: <ListChecks />,
  "변경 검토": <FileCode />,
};

function SkeletonRows() {
  return (
    <div className="grid gap-3 px-2.5 py-2">
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-1.5">
          <Skeleton width="60%" height={14} />
          <Skeleton width="35%" height={10} />
        </div>
      ))}
    </div>
  );
}

export function InboxPage({ state }: { state: InboxState }) {
  const shell = useShell();
  // 이 화면이 곧 받은 요청이라 오른쪽 well은 닫아 둔다(막대의 받은 요청 아이콘은 남는다).
  useLayoutEffect(() => shell.setEndOpen(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const initial: ApprovalId | null =
    state === "S2" ? "a3" : state === "S3" ? "a4" : state === "S5" ? null : "a1";
  const [open, setOpen] = useState<ApprovalId | null>(initial);
  const [filter, setFilter] = useState("all");
  const [thread, setThread] = useState("all");
  const [sort, setSort] = useState("oldest");
  const [decisions, setDecisions] = useState<Record<ApprovalId, Decision>>({
    a1: "pending",
    a5: "pending",
    a2: "pending",
    a3: "pending",
    a4: "pending",
  });
  const [answer, setAnswer] = useState<{ pick: string | null; text: string }>({
    pick: "unit",
    text: "",
  });
  const [mode, setMode] = useState("default");
  const [read, setRead] = useState(false);

  const offline = state === "S8";
  const noRespond = state === "S9";
  const sending = state === "S4";
  const locked = offline || noRespond || sending;
  const empty = state === "S5";
  const loading = state === "S6";
  const failed = state === "S7";

  const decide = (id: ApprovalId, d: Decision) => setDecisions((x) => ({ ...x, [id]: d }));
  const rows = approvalRows
    .filter((r) => thread === "all" || r.thread === thread)
    .filter((r) => decisions[r.id] !== "gone");
  const ordered = sort === "oldest" ? [...rows].reverse() : rows;
  const pending = rows.filter((r) => decisions[r.id] === "pending").length;
  const unread = read ? 0 : notices.filter((n) => n.unread).length;
  const total = pending + proposals.length + unread;

  const remote = sending ? "build-box에서 온 요청 · 12:40에 자동 거부 · " : "";
  const sub = (r: ApprovalRow) =>
    `${remote}${r.thread} · ${r.source.name}${r.caller !== undefined ? ` ${r.caller}` : ""} · ${r.at}`;

  const record = (r: ApprovalRow, d: Decision) => (
    <AgentRequest
      kind="permission"
      status={d === "denied" ? "denied" : "allowed"}
      title={
        d === "denied" ? "거부했어요" : r.kind === "변경 검토" ? "모두 승인했어요" : "승인했어요"
      }
      subtitle={`${r.kind} · ${r.summary}`}
    />
  );

  const card = (r: ApprovalRow) => {
    const d = decisions[r.id];
    switch (r.id) {
      case "a1":
      case "a5":
        return (
          <div className="grid gap-1">
            <ToolApprovalCard
              approval={r.id === "a1" ? shared.a1 : helmTool}
              decision={d}
              subtitle={sub(r)}
              onDecide={(x) => decide(r.id, x)}
              locked={locked}
            />
            {sending && (
              <span aria-live="polite" className="px-1 text-ui-xs text-text-tertiary">
                보내는 중…
              </span>
            )}
          </div>
        );
      case "a2":
        return (
          <QuestionCard
            approval={shared.a2}
            status={d === "answered" ? "answered" : d === "denied" ? "denied" : "pending"}
            subtitle={sub(r)}
            answer={answer}
            onAnswerChange={setAnswer}
            onAnswer={() => decide("a2", "answered")}
            onDeny={() => decide("a2", "denied")}
            locked={locked}
          />
        );
      case "a3":
        if (d !== "pending") return record(r, d);
        return (
          <RequestCard
            icon={<ListChecks />}
            tileTone="bg-agent-soft text-agent-text"
            title={`계획 · v${plan.version}`}
            subtitle={sub(r)}
            locked={locked}
            onAction={(id) => decide("a3", id === "deny" ? "denied" : "allowed")}
            actions={[
              { id: "deny", label: "거부", tone: "danger" },
              { id: "revise", label: "수정 요청", tone: "secondary" },
              { id: "allow", label: "승인", tone: "primary" },
            ]}
          >
            <div className="grid gap-1 font-voice text-voice-sm text-text-primary">
              <p className="m-0 font-semibold">{plan.title}</p>
              <ol className="m-0 grid gap-0.5 ps-5">
                {plan.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <Button size="xs" tone="neutral" variant="ghost" className="-ms-2 justify-self-start">
                전체 보기 (나머지 {plan.more}줄)
              </Button>
            </div>
            <ListDescription
              variant="ghost"
              size="xs"
              aria-label="계획 승인 선택"
              className="rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
            >
              <ListDescriptionRow term="승인 뒤 모드">
                <Select
                  size="xs"
                  aria-label="승인 뒤 모드"
                  value={mode}
                  onValueChange={setMode}
                  className="w-40"
                >
                  {plan.modes.map((m) => (
                    <SelectOption key={m} value={m}>
                      {m}
                    </SelectOption>
                  ))}
                </Select>
              </ListDescriptionRow>
            </ListDescription>
            <Textarea
              size="sm"
              rows={2}
              aria-label="피드백"
              placeholder="수정 요청에 붙일 피드백"
            />
          </RequestCard>
        );
      case "a4":
        if (d !== "pending") return record(r, d);
        return (
          <RequestCard
            icon={<FileCode />}
            tileTone="bg-accent-soft text-accent-text"
            title={`변경 검토 · 라운드 ${review.round}`}
            subtitle={sub(r)}
            locked={locked}
            onAction={(id) => decide("a4", id === "deny" ? "denied" : "allowed")}
            actions={[
              { id: "deny", label: "거부", tone: "danger" },
              { id: "all", label: "모두 승인", tone: "secondary" },
              { id: "open", label: "검토 열기", tone: "primary" },
            ]}
          >
            <div className="flex items-baseline gap-2.5">
              <span className="text-ui-sm font-medium text-text-primary">{review.title}</span>
              <span className="font-mono text-mono-sm text-diff-add-text">+{review.added}</span>
              <span className="font-mono text-mono-sm text-diff-remove-text">
                −{review.removed}
              </span>
            </div>
            <ListDescription
              variant="ghost"
              size="xs"
              aria-label="바뀐 파일"
              className="rounded-none [--cs-size-list-term:12rem] [&_[data-slot=list-description-row]]:px-0"
            >
              {review.files.map((f) => (
                <ListDescriptionRow key={f.path} term={<span className="font-mono">{f.path}</span>}>
                  {f.change} · hunk {f.hunks}
                </ListDescriptionRow>
              ))}
            </ListDescription>
          </RequestCard>
        );
    }
  };

  const showApprovals = filter === "all" || filter === "approvals";
  const showProposals = filter === "all" || filter === "proposals";
  const showNotices = filter === "all" || filter === "notices";

  const link: StatusCell | undefined = offline
    ? {
        id: "link",
        text: "끊김",
        dot: "danger",
        title: "연결 끊김",
        description: "엔진과 연결이 끊겼어요. 읽은 목록은 그대로 보여요.",
      }
    : undefined;
  const status = defaultStatusCells({
    layout: shell.layout,
    thread: false,
    pendingApprovals: pending,
    openEnd: shell.openEnd,
    link,
  });
  if (noRespond && status.start[0] !== undefined && status.start[0].id === "target")
    status.start[0] = {
      ...status.start[0],
      text: "build-box",
      description: "원격 서비스 build-box에 붙어 있어요. 이 연결은 승인에 답할 수 없어요.",
    };

  return (
    <Shell
      activeNav="inbox"
      stageLabel="받은 요청"
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({ inboxBadge: total, only: ["inbox"] })}
      status={status}
    >
      <header
        className={`${READ_WIDTH} flex min-h-10 flex-none flex-wrap items-center gap-x-2 gap-y-1 py-1`}
      >
        {!shell.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => shell.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <h1 className="m-0 me-1 font-ui text-ui-strong text-text-primary">받은 요청</h1>
        <SegmentedControl size="xs" aria-label="종류" value={filter} onValueChange={setFilter}>
          <SegmentedControlItem value="all">모두</SegmentedControlItem>
          <SegmentedControlItem value="approvals" count={empty ? undefined : pending}>
            승인
          </SegmentedControlItem>
          <SegmentedControlItem value="proposals" count={empty ? undefined : proposals.length}>
            제안
          </SegmentedControlItem>
          <SegmentedControlItem value="notices" count={empty || unread === 0 ? undefined : unread}>
            알림
          </SegmentedControlItem>
        </SegmentedControl>
        <span aria-hidden className="flex-1" />
        <Select
          size="xs"
          aria-label="대화"
          value={thread}
          onValueChange={setThread}
          className="w-36"
        >
          <SelectOption value="all">모든 대화</SelectOption>
          <SelectOption value="캐시 무효화 조사">캐시 무효화 조사</SelectOption>
          <SelectOption value="테스트 정리">테스트 정리</SelectOption>
          <SelectOption value="빌드 실패 분석">빌드 실패 분석</SelectOption>
        </Select>
        <Select size="xs" aria-label="정렬" value={sort} onValueChange={setSort} className="w-32">
          <SelectOption value="oldest">오래된 것 먼저</SelectOption>
          <SelectOption value="newest">최근 것 먼저</SelectOption>
        </Select>
      </header>

      <ScrollArea label="받은 요청 목록" className="min-h-0 flex-1">
        <div className={`${READ_WIDTH} grid gap-5 pt-1 pb-4`}>
          {(offline || noRespond) && (
            <Alert tone="warning">
              {offline
                ? "엔진에 연결되면 답할 수 있어요"
                : "이 연결(build-box)에서는 답할 수 없어요. 원격 응답 허용이 꺼져 있어요."}
            </Alert>
          )}

          {empty && (
            <EmptyState
              icon={<Inbox />}
              surface="none"
              className="mt-16"
              title="기다리는 요청이 없어요"
              description="승인, 제안, 알림이 오면 여기에 모여요."
            />
          )}

          {!empty && showApprovals && (
            <Section title="승인" count={loading ? undefined : pending}>
              {loading ? (
                <SkeletonRows />
              ) : (
                <ul aria-label="승인 대기" className="m-0 -mx-2.5 grid list-none gap-1 p-0">
                  {ordered.map((r) =>
                    open === r.id ? (
                      <li key={r.id} className="px-0 py-1">
                        {card(r)}
                      </li>
                    ) : decisions[r.id] !== "pending" ? (
                      <li key={r.id} className="px-0 py-1">
                        {card(r)}
                      </li>
                    ) : (
                      <InboxRow
                        key={r.id}
                        icon={KIND_ICON[r.kind]}
                        iconTone="text-warning-graphic"
                        kind={r.kind}
                        summary={r.summary}
                        mono={r.mono}
                        meta={[r.thread, r.source.name, r.caller]}
                        at={r.at}
                        error={sending && r.id === "a2" ? "이미 처리된 요청이에요" : undefined}
                        onClick={() => setOpen(r.id)}
                      />
                    ),
                  )}
                </ul>
              )}
            </Section>
          )}

          {!empty && showProposals && (
            <Section
              title="제안"
              count={loading ? undefined : failed ? 2 : proposals.length}
              end={
                <Button size="xs" tone="neutral" variant="ghost">
                  제안 화면에서 보기
                </Button>
              }
            >
              {loading ? (
                <SkeletonRows />
              ) : (
                <>
                  {failed && (
                    <Alert tone="warning" className="mb-1">
                      knowledge 능력의 제안을 읽지 못했어요. learning 그룹 제안만 보여요.
                    </Alert>
                  )}
                  <ul aria-label="제안 대기" className="m-0 -mx-2.5 grid list-none gap-1 p-0">
                    {proposals
                      .filter((p) => !failed || p.source.id === "grp:learning")
                      .map((p) => (
                        <InboxRow
                          key={p.target}
                          icon={<Sparkles emphasis="muted" />}
                          iconTone={
                            p.conflict === true ? "text-warning-graphic" : "text-text-tertiary"
                          }
                          kind={p.kind}
                          summary={p.target}
                          mono
                          meta={[p.source.name, p.meta]}
                          at={p.at}
                        />
                      ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          {!empty && showNotices && (
            <Section
              title="알림"
              count={loading || failed ? undefined : notices.length}
              end={
                !loading && !failed && unread > 0 ? (
                  <Button size="xs" tone="neutral" variant="ghost" onClick={() => setRead(true)}>
                    모두 읽음
                  </Button>
                ) : undefined
              }
            >
              {loading ? (
                <SkeletonRows />
              ) : failed ? (
                <Alert
                  tone="danger"
                  action={
                    <Button size="xs" tone="neutral" variant="ghost">
                      다시
                    </Button>
                  }
                >
                  알림을 읽지 못했어요
                </Alert>
              ) : (
                <ul aria-label="알림" className="m-0 -mx-2.5 grid list-none gap-1 p-0">
                  {notices.map((n) => (
                    <InboxRow
                      key={n.title}
                      icon={
                        n.kind === "error" ? (
                          <CircleAlert />
                        ) : n.kind === "completed" ? (
                          <CircleCheck />
                        ) : (
                          <Sparkles emphasis="muted" />
                        )
                      }
                      iconTone={
                        n.kind === "error"
                          ? "text-danger-graphic"
                          : n.kind === "completed"
                            ? "text-success-graphic"
                            : "text-text-tertiary"
                      }
                      kind={
                        n.kind === "error" ? "오류" : n.kind === "completed" ? "완료" : "백그라운드"
                      }
                      summary={n.title}
                      meta={[n.body, n.thread, n.source.name]}
                      at={n.at}
                      unread={n.unread && !read}
                    />
                  ))}
                </ul>
              )}
            </Section>
          )}
          {noRespond && (
            <p className="m-0 flex items-center gap-1.5 text-ui-xs text-text-tertiary">
              <ShieldCheck aria-hidden emphasis="muted" className="size-icon-sm" />
              설정 › 연결에서 원격 응답을 허용하면 여기서 답할 수 있어요.
              <Badge size="xs" mono>
                l2.schedule.remote.allowRespond
              </Badge>
            </p>
          )}
        </div>
      </ScrollArea>
    </Shell>
  );
}
