import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type { LiveApprovalRequest } from "../../state/engine/input.ts";
import { Badge, Button } from "@caustic/react";
import { ChevronRight, FileText, MessageCircleQuestion, ShieldCheck } from "@caustic/react/icons";
import { memo, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApproval, useThread } from "../../state/engine/index.ts";
import { useApprovalDetail, useApprovalSend } from "../../state/ui/index.ts";
import {
  APPROVAL_FAILURE_ID,
  answerOf,
  approvalOriginView,
  type ApprovalOriginView,
  type QuestionDraft,
} from "../approval-form.ts";
import { useCommands, type ApprovalDecision } from "../commands.ts";
import { APPROVE_ALL_ANSWER } from "../review-model.ts";
import { QuestionBody, ReviewBody, RiskBadge, ToolBody, toolHasArgs } from "./bodies.tsx";
import { useClockNow } from "./clock.ts";
import {
  approvalAgeOf,
  approvalExpiryOf,
  approvalKeyOf,
  cardTitleViewOf,
  clockTextOf,
  threadLinkVisibleOf,
  type ApprovalAge,
} from "./card-model.ts";
import { useGoToThread } from "../thread-link.ts";
import { AttendGlow, type AttendKind } from "../effects/attention-mark.tsx";
import { WriteAccessBody } from "./write-access-body.tsx";
import {
  writeAccessDecisionsOf,
  writeAccessFoldsOf,
  writeAccessViewOf,
} from "./write-access-model.ts";

// 승인 카드. 트랜스크립트 끝, 끝 영역 받은 요청(InboxApprovals), P-03 목록이 같은 카드를 쓴다(FS-02).
// 카드는 거울의 approvals를 읽고 응답 직후 표시는 UI 스토어가 가진다. 대기열에서 빠지는 일은 approval.resolved가 한다.
// 머리의 대화 이름은 트랜스크립트 밖에서만 누를 수 있다(threadLinkVisibleOf).
// 카드 틀은 네 종류가 같다(L4.desktop-ux DP-134 [결정: 2026-11-12 사용자]): 안쪽 16, 머리(아이콘 칸 28 + 사이 12 + 제목·곁 줄),
// 본문과 단추 줄은 제목 열(왼쪽 40)에 맞추고 사이 12. 단추 줄은 오른쪽 아래에 [거부] [주 동작](sm 28, 사이 8), 왼쪽은 펼침 단추나 보조 동작.
// caustic AgentRequest는 종류마다 틀(구슬·유리 판·띠)과 단추 배치가 달라 쓰지 않는다. 본문은 ChoiceGroup·Input·Textarea·MessageCode·Alert.

type ApprovalBodyKind = LiveApprovalRequest["body"]["kind"];

const KIND_LEAD: Readonly<Record<ApprovalBodyKind, MessageId>> = {
  tool: "desktop.approvals.kind.tool",
  question: "desktop.approvals.kind.question",
  review: "desktop.approvals.kind.review",
};

/** 종류마다 머리 아이콘 칸의 그림과 색. 도구는 경고(실행 권한), 질문은 정보, 계획·검토는 에이전트 색이다 */
const KIND_TILE: Readonly<
  Record<ApprovalBodyKind, { readonly icon: ReactNode; readonly tone: string }>
> = {
  tool: { icon: <ShieldCheck aria-hidden />, tone: "bg-warning-tint text-warning-text" },
  question: { icon: <MessageCircleQuestion aria-hidden />, tone: "bg-info-tint text-info-text" },
  review: { icon: <FileText aria-hidden />, tone: "bg-agent-tint text-agent-text" },
};

/**
 * 카드 주의 면의 빛깔 조합(DP-190, lcMk4). 종류 칸의 색(KIND_TILE)이 중심이다: 변경 검토는 보라, 질문은 파랑, 도구는 호박이고
 * 쓰기 허용(가드)은 도구와 같은 호박 칸이지만 주황 쪽으로 기운 조합이라 한 화면에 쌓여도 갈린다
 */
export function attendKindOf(kind: ApprovalBodyKind, writeAccess: boolean): AttendKind {
  if (writeAccess) return "guard";
  return kind;
}

/** 입력 중인 칸에서 누른 글자는 바로 가기가 아니다 */
function isTypingTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function originTextOf(origin: ApprovalOriginView): string {
  const text =
    origin.kind === "background"
      ? t("desktop.approvals.origin.background")
      : origin.kind === "host"
        ? t("desktop.approvals.origin.host")
        : origin.kind === "subagent"
          ? t("desktop.approvals.origin.subagent", { name: origin.name })
          : origin.kind === "groupChild"
            ? t("desktop.approvals.origin.groupChild", {
                label:
                  origin.label ?? t("desktop.approvals.origin.subagent", { name: origin.name }),
                scope: origin.scope,
              })
            : t("desktop.approvals.origin.group", { name: origin.name });
  return `${t("desktop.approvals.origin.label")}: ${text}`;
}

function ageTextOf(age: ApprovalAge): string {
  switch (age.unit) {
    case "now":
      return t("desktop.approvals.age.now");
    case "minutes":
      return t("desktop.approvals.age.minutes", { count: age.count });
    case "hours":
      return t("desktop.approvals.age.hours", { count: age.count });
    case "days":
      return t("desktop.approvals.age.days", { count: age.count });
    default:
      return assertNever(age, "approval age");
  }
}

/**
 * 카드가 보내는 답들. primary는 Y, deny는 N, thread는 샌드박스 밖 쓰기의 "이 대화에서 계속 허용"이다.
 * null이면 그 동작을 끈다(thread는 그 단추를 그리지 않는다)
 */
type Decisions = {
  readonly primary: ApprovalDecision | null;
  readonly deny: ApprovalDecision;
  readonly thread: ApprovalDecision | null;
};

type Action = {
  readonly id: string;
  readonly label: MessageId;
  readonly decision: ApprovalDecision | null;
  readonly look: "solid" | "soft" | "ghost";
};

/** 단추 크기: 네 종류 모두 폼 표준 sm(28)이다 */
const ACTION_SIZE = "sm";

function ActionButton(props: {
  readonly action: Action;
  readonly disabled: boolean;
  readonly onRespond: (decision: ApprovalDecision) => void;
}): ReactNode {
  const { action } = props;
  const decision = action.decision;
  return (
    <Button
      type="button"
      data-action={action.id}
      size={ACTION_SIZE}
      variant={action.look}
      disabled={props.disabled || decision === null}
      onClick={() => {
        if (decision !== null) props.onRespond(decision);
      }}
    >
      {t(action.label)}
    </Button>
  );
}

function PendingCard(props: {
  readonly id: EventId;
  readonly threadId: ThreadId;
  readonly request: LiveApprovalRequest;
  /** 이 카드를 그리는 트랜스크립트의 대화. 트랜스크립트 밖이면 null */
  readonly within: ThreadId | null;
}): ReactNode {
  const { id, request } = props;
  const commands = useCommands();
  const sendState = useApprovalSend(id);
  const detail = useApprovalDetail(id);
  const thread = useThread(props.threadId);
  const goToThread = useGoToThread();
  const now = useClockNow();
  const [draft, setDraft] = useState<QuestionDraft>({});
  // 도구 인자(원시 JSON)는 접어 두고 단추 줄 왼쪽의 펼침 단추로 연다
  const [argsOpen, setArgsOpen] = useState(false);
  // 쓰기 허용 본문이 폭 때문에 잘린 값이 있다고 알린 상태(펼침 단추를 세운다)
  const [clipped, setClipped] = useState(false);
  const argsId = useId();
  const titleId = useId();
  const { body } = request;
  const busy = sendState === "sending";

  const writeAccess = writeAccessViewOf(request);
  const decisions: Decisions = decisionsOf(request, { draft });
  const respond = (decision: ApprovalDecision): void => {
    detach(commands.respondApproval(id, decision), rethrow);
  };
  /** host가 모르는 승인을 대기열에서 뺀다(`gone`일 때 지우기 단추) */
  const dismiss = (): void => {
    commands.dismissApproval(id);
  };
  /** 검토 열기: 변경 검토 화면(P-04)을 이 승인으로 연다. 화면 자리는 App이 옮긴다 */
  const openReview = (): void => {
    if (body.kind === "review")
      commands.openReview({ approvalId: id, reviewId: body.review.reviewId });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (busy || isTypingTarget(event.target)) return;
    const action = approvalKeyOf(event, event.target === event.currentTarget);
    if (action === null) return;
    const decision = action === "primary" ? decisions.primary : decisions.deny;
    if (decision === null) return;
    event.preventDefault();
    respond(decision);
  };

  const titleView = cardTitleViewOf(request);
  const cardTitle =
    titleView === null
      ? request.title
      : titleView.id === "desktop.approvals.title.tool"
        ? t(titleView.id, titleView.params)
        : titleView.id === "desktop.approvals.title.writeAccess"
          ? t(titleView.id)
          : titleView.id === "desktop.approvals.title.web"
            ? t(titleView.id, titleView.params)
            : titleView.id === "desktop.approvals.title.mcpStart"
              ? t(titleView.id, titleView.params)
              : t(titleView.id, { name: titleView.params.name, op: t(titleView.params.opId) });
  const origin = approvalOriginView(request.origin.caller, request.origin.source);
  const expiry = approvalExpiryOf(request);
  const review = body.kind === "review" ? body.review : null;
  const threadName = thread?.title ?? t("desktop.approvals.card.thread.untitled");
  // 대화 이름이 링크인 것은 트랜스크립트 밖의 카드이고, 열 수 있는 대화(거울에 있음, 이동 문맥이 있음)일 때다
  const linkTo = threadLinkVisibleOf({
    threadId: props.threadId,
    within: props.within,
    openable: thread !== undefined && goToThread !== null,
  })
    ? goToThread
    : null;
  const meta = [
    review === null ? null : t("desktop.approvals.review.round", { round: review.round }),
    ageTextOf(approvalAgeOf(now, request.requestedAt)),
    expiry === null
      ? null
      : t(
          expiry.decision === "answer"
            ? "desktop.approvals.expiry.answer"
            : "desktop.approvals.expiry.deny",
          {
            time: clockTextOf(expiry.at),
          },
        ),
  ].filter((part): part is string => part !== null);
  const threadLabel = t("desktop.approvals.card.threadLabel");
  const lead = t(KIND_LEAD[body.kind]);
  const subtitle: ReactNode =
    linkTo === null ? (
      [lead, `${threadLabel}: ${threadName}`, ...meta].join(" · ")
    ) : (
      <>
        {`${lead} · ${threadLabel}: `}
        {/* 대화 이름 링크는 글 줄 안의 링크다(단추 상자 없이 밑줄 hover). 누르는 영역은 줄 높이 */}
        <button
          type="button"
          data-action="thread"
          className="cursor-pointer rounded-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus-visible:shadow-focus"
          onClick={() => {
            linkTo(props.threadId);
          }}
        >
          {threadName}
        </button>
        {meta.map((part) => ` · ${part}`)}
      </>
    );

  // 오른쪽 아래 단추 묶음, 읽는 순서대로: [거부] [(계획) 수정 요청 | (쓰기 허용) 이 대화에서 계속 허용] [주 동작]. 주 동작만 채움이다
  const answers: Action[] = [
    { id: "deny", label: denyLabelOf(body.kind), decision: decisions.deny, look: "ghost" },
  ];
  if (decisions.thread !== null) {
    answers.push({
      id: "allow-thread",
      label: "desktop.approvals.writeAccess.thread.button",
      decision: decisions.thread,
      look: "soft",
    });
  }
  answers.push({
    id: "primary",
    label:
      writeAccess === null
        ? primaryLabelOf(body.kind)
        : "desktop.approvals.writeAccess.once.button",
    decision: decisions.primary,
    look: "solid",
  });
  const tool = body.kind === "tool" ? body.tool : null;
  // 쓰기 허용 승인은 같은 값을 구조로 이미 보여 원시 인자 단추 대신, 잘린 경로·명령이 있을 때만 "전체 보기"를 둔다
  const hasArgs = writeAccess === null && tool !== null && toolHasArgs(tool);
  const folds = writeAccess !== null && (clipped || writeAccessFoldsOf(writeAccess));

  const bodyNode =
    writeAccess !== null ? (
      <WriteAccessBody view={writeAccess} open={argsOpen} id={argsId} onClipped={setClipped} />
    ) : body.kind === "tool" ? (
      <ToolBody body={body.tool} argsOpen={argsOpen} argsId={argsId} />
    ) : body.kind === "question" ? (
      <QuestionBody
        questions={body.question.questions}
        draft={draft}
        disabled={busy}
        onChange={setDraft}
      />
    ) : (
      <ReviewBody review={body.review} />
    );

  const tile = KIND_TILE[body.kind];
  return (
    <li data-slot="approval-card-item" data-approval-id={id} className="list-none">
      <article
        data-slot="approval-card"
        data-approval-kind={body.kind}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // 주의 면(DP-190): 대기 중인 카드는 위 변 가운데의 빛과 안쪽으로 옅은 번짐이 깔린다(종류마다 빛깔 조합, 답을 보내는 동안은 걷는다)
        className="fx-attend-card grid gap-3 rounded-xl bg-surface-base p-4 text-ui text-text-primary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle),var(--cs-focus)]"
      >
        <AttendGlow pending={!busy} kind={attendKindOf(body.kind, writeAccess !== null)} />
        {/* 머리: 아이콘 칸 28, 제목 13/600, 곁 줄 12 tertiary(종류 · 대화 · 시각). 위험도·출처는 오른쪽 끝 */}
        <header data-slot="approval-head" className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-4 ${tile.tone}`}
          >
            {tile.icon}
          </span>
          <div className="grid min-w-0 flex-1 gap-0.5 pt-px">
            <h3
              id={titleId}
              data-slot="approval-title"
              className="m-0 text-ui-strong [overflow-wrap:anywhere]"
            >
              {cardTitle}
            </h3>
            <p data-slot="approval-subtitle" className="m-0 text-ui-sm text-text-tertiary">
              {subtitle}
            </p>
          </div>
          {tool === null && origin === null ? null : (
            <span className="flex shrink-0 items-center gap-1.5 pt-px">
              {origin === null ? null : (
                <Badge size="sm" className="bg-info-tint text-info-text">
                  {originTextOf(origin)}
                </Badge>
              )}
              {tool === null ? null : <RiskBadge body={tool} />}
            </span>
          )}
        </header>
        {/* 본문이 비면(웹 승인처럼 접힌 인자뿐이면) 칸째 숨겨 머리와 단추 줄 사이가 12 하나로 남는다 */}
        <div
          data-slot="approval-body"
          className="grid min-w-0 gap-2 pl-10 [&:not(:has(>:not(:empty)))]:hidden"
        >
          {bodyNode}
          {sendState === undefined || sendState === "sending" ? null : (
            <p className="m-0 text-ui text-danger-text" role="alert" data-failure={sendState}>
              {t(APPROVAL_FAILURE_ID[sendState])}
              {detail === undefined ? null : ` (${detail})`}
            </p>
          )}
        </div>
        {/* 단추 줄: 대기열 띠 안에서 본문이 스크롤될 때도 바닥에 붙어 늘 닿는다(sticky, 배경은 카드 면) */}
        <div
          data-slot="approval-actions"
          className="sticky bottom-0 flex min-w-0 flex-wrap items-center gap-2 bg-surface-base pl-10"
        >
          {hasArgs ? (
            <Button
              type="button"
              data-action="args"
              size={ACTION_SIZE}
              variant="ghost"
              aria-expanded={argsOpen}
              aria-controls={argsId}
              // 펼침 단추의 글이 제목 열에 맞도록 단추 안쪽 여백만큼 당긴다
              className="-ml-2.5 gap-1 text-text-secondary [&_svg]:size-3.5 [&_svg]:transition-transform aria-expanded:[&_svg]:rotate-90"
              onClick={() => {
                setArgsOpen((open) => !open);
              }}
            >
              <ChevronRight aria-hidden />
              {t(argsOpen ? "desktop.approvals.args.hide" : "desktop.approvals.args.show")}
            </Button>
          ) : null}
          {folds ? (
            <Button
              type="button"
              data-action="fold"
              size={ACTION_SIZE}
              variant="ghost"
              aria-expanded={argsOpen}
              aria-controls={argsId}
              className="-ml-2.5 gap-1 text-text-secondary [&_svg]:size-3.5 [&_svg]:transition-transform aria-expanded:[&_svg]:rotate-90"
              onClick={() => {
                setArgsOpen((open) => !open);
              }}
            >
              <ChevronRight aria-hidden />
              {t(
                argsOpen
                  ? "desktop.approvals.writeAccess.less"
                  : "desktop.approvals.writeAccess.full",
              )}
            </Button>
          ) : null}
          {body.kind === "review" ? (
            <Button
              type="button"
              data-action="open"
              size={ACTION_SIZE}
              variant="outline"
              disabled={busy}
              onClick={openReview}
            >
              {t("desktop.approvals.review.open.button")}
            </Button>
          ) : null}
          {/* 답 단추 묶음은 오른쪽 끝에 붙고, 좁은 폭에서 줄이 넘치면 묶음째 다음 줄 오른쪽으로 내려간다(주 동작이 혼자 왼쪽으로 떨어지지 않게) */}
          <span
            data-slot="approval-answers"
            className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
          >
            {busy ? (
              <span role="status" className="text-ui-sm text-text-tertiary">
                {t("desktop.approvals.sendingStatus")}
              </span>
            ) : null}
            {sendState === "gone" ? (
              <Button
                type="button"
                data-action="dismiss"
                size={ACTION_SIZE}
                variant="ghost"
                onClick={dismiss}
              >
                {t("desktop.approvals.failure.gone.dismiss")}
              </Button>
            ) : (
              answers.map((action) => (
                <ActionButton key={action.id} action={action} disabled={busy} onRespond={respond} />
              ))
            )}
          </span>
        </div>
      </article>
    </li>
  );
}

/** 검토 카드의 거부는 파일 전체를 거절하는 뜻이라 "모두 거절"이다 [결정: 2026-11-04 사용자 Q8] */
function denyLabelOf(kind: ApprovalBodyKind): MessageId {
  return kind === "review"
    ? "desktop.approvals.review.denyAll.button"
    : "desktop.approvals.deny.button";
}

function primaryLabelOf(kind: ApprovalBodyKind): MessageId {
  switch (kind) {
    case "tool":
      return "desktop.approvals.allow.button";
    case "question":
      return "desktop.approvals.answer.button";
    case "review":
      return "desktop.approvals.review.approveAll.button";
    default:
      return assertNever(kind, "approval primary label");
  }
}

/** 종류와 입력 상태에서 보낼 답을 만든다. 질문은 모든 문항에 답이 있어야 기본 답이 생긴다 */
function decisionsOf(
  request: LiveApprovalRequest,
  state: { readonly draft: QuestionDraft },
): Decisions {
  const { body } = request;
  const deny: ApprovalDecision = { decision: "deny" };
  // 샌드박스 밖 쓰기 승인: 이번만(주 동작) · 이 대화에서 계속 허용 · 거부(L2.workspace §4.3.1, DP-204)
  const writeAccess = writeAccessViewOf(request);
  if (writeAccess !== null) {
    const choices = writeAccessDecisionsOf(writeAccess);
    return { primary: choices.once, deny: choices.deny, thread: choices.thread };
  }
  if (body.kind === "tool") {
    return {
      primary: { decision: "allow", remember: "once" },
      deny,
      thread: null,
    };
  }
  if (body.kind === "question") {
    const answer = answerOf(body.question.questions, state.draft);
    return {
      primary: answer === null ? null : { decision: "answer", answer },
      deny,
      thread: null,
    };
  }
  return {
    primary: { decision: "answer", answer: APPROVE_ALL_ANSWER },
    deny,
    thread: null,
  };
}

const ApprovalCard = memo(function ApprovalCard(props: {
  readonly id: EventId;
  readonly within: ThreadId | null;
}): ReactNode {
  const approval = useApproval(props.id);
  if (approval === undefined) return null;
  return (
    <PendingCard
      id={props.id}
      threadId={approval.threadId}
      request={approval.request}
      within={props.within}
    />
  );
});

/** 승인 카드 목록. 트랜스크립트 끝과 끝 영역 받은 요청이 같은 카드를 그린다. `within`은 그 트랜스크립트의 대화(밖이면 null) */
export function ApprovalCardList(props: {
  readonly ids: readonly EventId[];
  readonly label?: string;
  readonly within?: ThreadId | null;
}): ReactNode {
  const within = props.within ?? null;
  return (
    <ul className="m-0 grid gap-2 p-0" aria-label={props.label}>
      {props.ids.map((id) => (
        <ApprovalCard key={id} id={id} within={within} />
      ))}
    </ul>
  );
}
