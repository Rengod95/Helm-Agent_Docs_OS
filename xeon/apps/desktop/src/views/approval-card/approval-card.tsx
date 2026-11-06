import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import { AgentRequest, Button } from "@caustic/react";
import { memo, useState, type KeyboardEvent, type ReactNode } from "react";
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
import { PlanBody, QuestionBody, ReviewBody, ToolBody } from "./bodies.tsx";
import { useClockNow } from "./clock.ts";
import {
  approvalAgeOf,
  approvalExpiryOf,
  approvalKeyOf,
  cardTitleViewOf,
  clockTextOf,
  feedbackTextOf,
  threadLinkVisibleOf,
  type ApprovalAge,
} from "./card-model.ts";
import { useGoToThread } from "../thread-link.ts";

// 승인 카드. 트랜스크립트 끝, 끝 영역 받은 요청(InboxApprovals), P-03 목록이 같은 카드를 쓴다(FS-02).
// 카드는 거울의 approvals를 읽고 응답 직후 표시는 UI 스토어가 가진다. 대기열에서 빠지는 일은 approval.resolved가 한다.
// 머리의 대화 이름은 트랜스크립트 밖에서만 누를 수 있다(threadLinkVisibleOf).
// 부품: caustic AgentRequest(머리, 종류별 아이콘), 본문 ChoiceGroup·Input·Textarea·MessageCode·Alert, 단추 Button.

type ApprovalBodyKind = ApprovalRequestedPayload["body"]["kind"];

const KIND_LEAD: Readonly<Record<ApprovalBodyKind, MessageId>> = {
  tool: "desktop.approvals.kind.tool",
  question: "desktop.approvals.kind.question",
  plan: "desktop.approvals.kind.plan",
  review: "desktop.approvals.kind.review",
};

/** AgentRequest의 종류. 도구는 방패 아이콘, 질문은 말풍선, 계획은 orb, 검토는 검토 패널이다 */
const AGENT_KIND = {
  tool: "permission",
  question: "question",
  plan: "proposal",
  review: "review",
} as const;

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

/** 카드가 보내는 답들. primary는 Y, deny는 N, edit는 계획의 수정 요청이다. null이면 그 동작을 끈다 */
type Decisions = {
  readonly primary: ApprovalDecision | null;
  readonly deny: ApprovalDecision;
  readonly edit: ApprovalDecision | null;
};

type Action = {
  readonly id: string;
  readonly label: MessageId;
  readonly decision: ApprovalDecision | null;
  readonly look: "solid" | "soft" | "ghost";
};

/** 단추 크기: 도구·질문 카드는 xs, 계획·검토 카드는 sm (caustic AgentRequest의 단추 크기와 같다) */
type ActionSize = "xs" | "sm";

function ActionButton(props: {
  readonly action: Action;
  readonly size: ActionSize;
  readonly disabled: boolean;
  readonly onRespond: (decision: ApprovalDecision) => void;
}): ReactNode {
  const { action } = props;
  const decision = action.decision;
  return (
    <Button
      type="button"
      data-action={action.id}
      size={props.size}
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
  readonly request: ApprovalRequestedPayload;
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
  const [mode, setMode] = useState("");
  const [feedback, setFeedback] = useState("");
  const { body } = request;
  const busy = sendState === "sending";

  const decisions: Decisions = decisionsOf(request, { draft, mode, feedback });
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (busy || isTypingTarget(event.target)) return;
    const action = approvalKeyOf(event);
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
        : titleView.id === "desktop.approvals.title.plan"
          ? t(titleView.id)
          : titleView.id === "desktop.approvals.title.web"
            ? t(titleView.id, titleView.params)
            : t(titleView.id, { name: titleView.params.name, op: t(titleView.params.opId) });
  const origin = approvalOriginView(request.origin.caller, request.origin.source);
  const expiry = approvalExpiryOf(request);
  const actionSize: ActionSize = body.kind === "plan" || body.kind === "review" ? "sm" : "xs";
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
  const subtitle: ReactNode =
    linkTo === null ? (
      [`${threadLabel}: ${threadName}`, ...meta].join(" · ")
    ) : (
      <>
        {`${threadLabel}: `}
        <Button
          type="button"
          data-action="thread"
          variant="ghost"
          size="xs"
          onClick={() => {
            linkTo(props.threadId);
          }}
        >
          {threadName}
        </Button>
        {meta.map((part) => ` · ${part}`)}
      </>
    );

  const leading: Action[] = [
    { id: "deny", label: denyLabelOf(body.kind), decision: decisions.deny, look: "ghost" },
  ];
  if (body.kind === "plan") {
    leading.push({
      id: "edit",
      label: "desktop.approvals.plan.edit.button",
      decision: decisions.edit,
      look: "soft",
    });
  }
  const trailing: Action[] = [];
  trailing.push({
    id: "primary",
    label: primaryLabelOf(body.kind),
    decision: decisions.primary,
    look: "solid",
  });

  const bodyNode =
    body.kind === "tool" ? (
      <ToolBody body={body.tool} />
    ) : body.kind === "question" ? (
      <QuestionBody
        questions={body.question.questions}
        draft={draft}
        disabled={busy}
        onChange={setDraft}
      />
    ) : body.kind === "plan" ? (
      <PlanBody
        plan={body.plan}
        mode={mode}
        onMode={setMode}
        feedback={feedback}
        onFeedback={setFeedback}
        disabled={busy}
      />
    ) : (
      <ReviewBody review={body.review} />
    );

  return (
    <li data-slot="approval-card-item" data-approval-id={id} className="list-none">
      <AgentRequest
        data-approval-kind={body.kind}
        kind={AGENT_KIND[body.kind]}
        lead={t(KIND_LEAD[body.kind])}
        title={cardTitle}
        subtitle={subtitle}
        badge={origin === null ? undefined : originTextOf(origin)}
        actions={[]}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {body.kind === "plan" ? (
          // 긴 계획은 본문만 최대 높이 안에서 스크롤하고 단추 줄은 아래에 늘 보인다. 초점 순서는 본문 → 단추
          <div
            data-slot="approval-plan-scroll"
            role="region"
            aria-label={t("desktop.approvals.plan.scrollLabel")}
            // 키보드로 방향키 스크롤을 하려면 스크롤 영역이 초점을 받아야 한다
            tabIndex={0}
            // 자식(코드 블록의 overflow-auto)이 flex 축소로 min-height 0까지 눌리지 않게 shrink-0이다. 최대 높이는 대기열 띠(40dvh)에서 카드 머리·단추 줄·띠 머리를 뺀 몫이라 단추 줄이 띠 밖으로 밀리지 않는다(rtE R-1)
            className="flex max-h-[clamp(6rem,calc(40dvh-10rem),20rem)] flex-col gap-2 overflow-y-auto [&>*]:shrink-0"
          >
            {bodyNode}
          </div>
        ) : (
          bodyNode
        )}
        {/* 대기열 띠 안에서 카드 본문이 스크롤될 때 응답 단추 줄이 바닥에 붙어 늘 닿는다(sticky, 배경은 카드 면과 같다) */}
        <div
          data-slot="approval-actions"
          className="sticky bottom-0 flex flex-wrap items-center gap-1.5 bg-surface-base pt-1.5"
        >
          {leading.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              size={actionSize}
              disabled={busy}
              onRespond={respond}
            />
          ))}
          {body.kind === "review" ? (
            <Button
              type="button"
              data-action="open"
              size={actionSize}
              variant="outline"
              disabled={busy}
              onClick={openReview}
            >
              {t("desktop.approvals.review.open.button")}
            </Button>
          ) : null}
          <span aria-hidden className="flex-1" />
          {trailing.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              size={actionSize}
              disabled={busy}
              onRespond={respond}
            />
          ))}
          {busy ? (
            <span className="text-ui-sm text-text-secondary">
              {t("desktop.approvals.sendingStatus")}
            </span>
          ) : null}
          {sendState === undefined || sendState === "sending" ? null : (
            <span className="text-ui-sm text-danger-text" role="alert" data-failure={sendState}>
              {t(APPROVAL_FAILURE_ID[sendState])}
              {detail === undefined ? null : ` (${detail})`}
            </span>
          )}
          {sendState === "gone" ? (
            <Button
              type="button"
              data-action="dismiss"
              size={actionSize}
              variant="ghost"
              onClick={dismiss}
            >
              {t("desktop.approvals.failure.gone.dismiss")}
            </Button>
          ) : null}
        </div>
      </AgentRequest>
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
    case "plan":
      return "desktop.approvals.plan.approve.button";
    case "review":
      return "desktop.approvals.review.approveAll.button";
    default:
      return assertNever(kind, "approval primary label");
  }
}

/** 종류와 입력 상태에서 보낼 답을 만든다. 질문은 모든 문항에 답이 있어야 기본 답이 생긴다 */
function decisionsOf(
  request: ApprovalRequestedPayload,
  state: { readonly draft: QuestionDraft; readonly mode: string; readonly feedback: string },
): Decisions {
  const { body } = request;
  const deny: ApprovalDecision = { decision: "deny" };
  if (body.kind === "tool") {
    return {
      primary: { decision: "allow", remember: "once" },
      deny,
      edit: null,
    };
  }
  if (body.kind === "question") {
    const answer = answerOf(body.question.questions, state.draft);
    return {
      primary: answer === null ? null : { decision: "answer", answer },
      deny,
      edit: null,
    };
  }
  if (body.kind === "plan") {
    const text = feedbackTextOf(state.feedback);
    return {
      primary: {
        decision: "allow",
        remember: "once",
        ...(state.mode === "" ? {} : { answer: { mode: state.mode } }),
      },
      deny,
      edit: text === null ? null : { decision: "deny", answer: { feedback: text } },
    };
  }
  return {
    primary: { decision: "answer", answer: APPROVE_ALL_ANSWER },
    deny,
    edit: null,
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
