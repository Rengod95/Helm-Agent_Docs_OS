// N-43: 승인 카드 네 종류(도구 실행·질문·계획·변경 검토)를 한 부품으로. 트랜스크립트 끝, 오른쪽 받은 요청 well, P-03 무대에서
// 같은 부품·같은 머리 규칙(종류 · 출처 · 시각, 받은 요청이면 앞에 대화 이름)을 쓴다. 한쪽에서 답하면 페이지 상태 하나가 바뀌어
// 세 곳에서 함께 기록 줄로 바뀐다(approval.resolved, FS-02).
// - 도구·질문은 공용 ToolApprovalCard·QuestionCard 그대로.
// - 계획·변경 검토는 caustic AgentRequest에 맞는 kind가 없어(proposal은 영어 머리, review는 떠 있는 패널) p03의 RequestCard와 같은
//   치수로 짠 KindCard를 쓴다. well 안에서는 테두리 없는 flat 변형(DP-20).
import {
  AgentRequest,
  Button,
  Card,
  ListDescription,
  ListDescriptionRow,
  Select,
  SelectOption,
} from "@caustic/react";
import { Fragment, useId, useState, type ReactNode } from "react";
import {
  approvals,
  FileCode,
  ListChecks,
  QuestionCard,
  T,
  ToolApprovalCard,
  type ToolApproval,
} from "../../_shell";

export type CardKind = "tool" | "question" | "plan" | "review";
export type CardStatus = "pending" | "allowed" | "denied" | "answered";
export type Where = "transcript" | "well" | "page";

export const KIND_LABEL: Record<CardKind, string> = {
  tool: T.approvalTool,
  question: T.approvalQuestion,
  plan: T.approvalPlan,
  review: T.approvalReview,
};

/** 카드마다 낸 쪽(DP-33)과 시각. 대화는 모두 t1 "캐시 무효화 조사". */
export const CARD_META: Record<CardKind, { source: string; at: string; summary: string }> = {
  tool: { source: "core", at: "14:05", summary: "bash · rm -rf .cache && bun test" },
  question: { source: "grp:helm", at: "14:06", summary: "어느 테스트 묶음부터 볼까요?" },
  plan: { source: "l1:plan", at: "14:07", summary: "캐시 만료 수정 · 3단계" },
  review: { source: "l2:artifacts", at: "14:09", summary: "src/cache.ts 외 2 · +42 −18" },
};

const TOOL: ToolApproval = { ...approvals.a1, thread: "캐시 무효화 조사" };
const QUESTION = { ...approvals.a2, thread: "캐시 무효화 조사" };

export function subtitleOf(kind: CardKind, where: Where): string {
  const m = CARD_META[kind];
  const lead = where === "transcript" ? "" : "캐시 무효화 조사 · ";
  // 도구 카드 제목은 도구 이름(bash)이라 종류 말을 둘째 줄 앞에 둔다. 나머지 셋은 제목에 종류가 있다.
  const kindWord = kind === "tool" ? `${KIND_LABEL.tool} · ` : "";
  return `${kindWord}${lead}${m.source} · ${m.at}`;
}

const LOOK = {
  primary: { variant: "solid" },
  secondary: { variant: "outline" },
  danger: { variant: "ghost" },
} as const;

/** 계획·변경 검토 카드 틀(p03 RequestCard와 같은 치수 + flat). */
function KindCard({
  icon,
  tileTone,
  title,
  subtitle,
  actions,
  onAction,
  flat,
  children,
}: {
  icon: ReactNode;
  tileTone: string;
  title: ReactNode;
  subtitle: ReactNode;
  actions: { id: string; label: string; tone: "primary" | "secondary" | "danger" }[];
  onAction: (id: string) => void;
  flat: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      variant="surface"
      className={
        flat
          ? "grid min-w-0 gap-2.5 bg-transparent p-0 shadow-none"
          : "grid min-w-0 gap-2.5 rounded-2xl bg-surface-base px-inset-compact-x py-inset-compact-y shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] animate-rise"
      }
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
      {children}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {actions.map((a, i) => (
          <Fragment key={a.id}>
            <Button size="sm" tone="neutral" {...LOOK[a.tone]} onClick={() => onAction(a.id)}>
              {a.label}
            </Button>
            {a.tone === "danger" && i === 0 && <span aria-hidden className="flex-1" />}
          </Fragment>
        ))}
      </div>
    </Card>
  );
}

export function ApprovalCard({
  kind,
  status,
  where,
  onDecide,
}: {
  kind: CardKind;
  status: CardStatus;
  where: Where;
  onDecide: (d: "allowed" | "denied" | "answered") => void;
}) {
  const flat = where === "well";
  const subtitle = subtitleOf(kind, where);
  const [answer, setAnswer] = useState<{ pick: string | null; text: string }>({
    pick: "unit",
    text: "",
  });
  const [mode, setMode] = useState("default");

  if (status !== "pending" && (kind === "plan" || kind === "review")) {
    return (
      <AgentRequest
        kind="permission"
        status={status === "denied" ? "denied" : "allowed"}
        title={
          status === "denied" ? "거부했어요" : kind === "review" ? "모두 승인했어요" : "승인했어요"
        }
        subtitle={`${KIND_LABEL[kind]} · ${CARD_META[kind].summary}`}
      />
    );
  }

  switch (kind) {
    case "tool":
      return (
        <ToolApprovalCard
          approval={TOOL}
          decision={status === "pending" ? "pending" : status === "denied" ? "denied" : "allowed"}
          subtitle={subtitle}
          flat={flat}
          onDecide={(d) => onDecide(d === "denied" ? "denied" : "allowed")}
        />
      );
    case "question":
      return (
        <QuestionCard
          approval={QUESTION}
          status={status === "pending" ? "pending" : status === "denied" ? "denied" : "answered"}
          subtitle={subtitle}
          flat={flat}
          answer={answer}
          onAnswerChange={setAnswer}
          onAnswer={() => onDecide("answered")}
          onDeny={() => onDecide("denied")}
        />
      );
    case "plan":
      return (
        <KindCard
          icon={<ListChecks />}
          tileTone="bg-agent-soft text-agent-text"
          title={`${T.approvalPlan} · v2`}
          subtitle={subtitle}
          flat={flat}
          onAction={(id) => onDecide(id === "deny" ? "denied" : "allowed")}
          actions={[
            { id: "deny", label: "거부", tone: "danger" },
            { id: "revise", label: "수정 요청", tone: "secondary" },
            { id: "allow", label: "승인", tone: "primary" },
          ]}
        >
          <div className="grid gap-1 font-voice text-voice-sm text-text-primary">
            <p className="m-0 font-semibold">캐시 만료 수정</p>
            <ol className="m-0 grid gap-0.5 ps-5">
              <li>만료 단위를 ms로 통일</li>
              <li>isExpired 경계 테스트 3개 추가</li>
              <li>docs/cache.md 단위 표기 고치기</li>
            </ol>
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
                <SelectOption value="default">default</SelectOption>
                <SelectOption value="acceptEdits">acceptEdits</SelectOption>
              </Select>
            </ListDescriptionRow>
          </ListDescription>
        </KindCard>
      );
    case "review":
      return (
        <KindCard
          icon={<FileCode />}
          tileTone="bg-accent-soft text-accent-text"
          title={`${T.approvalReview} · 라운드 1`}
          subtitle={subtitle}
          flat={flat}
          onAction={(id) => onDecide(id === "deny" ? "denied" : "allowed")}
          actions={[
            { id: "deny", label: "거부", tone: "danger" },
            { id: "all", label: "모두 승인", tone: "secondary" },
            { id: "open", label: "검토 열기", tone: "primary" },
          ]}
        >
          <div className="flex items-baseline gap-2.5">
            <span className="text-ui-sm font-medium text-text-primary">캐시 만료 수정</span>
            <span className="font-mono text-mono-sm text-diff-add-text">+42</span>
            <span className="font-mono text-mono-sm text-diff-remove-text">−18</span>
          </div>
          <ListDescription
            variant="ghost"
            size="xs"
            aria-label="바뀐 파일"
            className="rounded-none [--cs-size-list-term:10rem] [&_[data-slot=list-description-row]]:px-0"
          >
            <ListDescriptionRow term={<span className="font-mono">src/cache.ts</span>}>
              수정 · hunk 4
            </ListDescriptionRow>
            <ListDescriptionRow term={<span className="font-mono">test/cache.test.ts</span>}>
              수정 · hunk 2
            </ListDescriptionRow>
            <ListDescriptionRow term={<span className="font-mono">docs/cache.md</span>}>
              수정 · hunk 1
            </ListDescriptionRow>
          </ListDescription>
        </KindCard>
      );
  }
}
