import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type { ApprovalRequestedPayload, ReviewAnswerJson } from "@fresnel/contracts/records";
import { AgentRequest, Button } from "@caustic/react";
import { memo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApproval, useThread } from "../../state/engine/index.ts";
import { useApprovalDetail, useApprovalSend, type ApprovalSend } from "../../state/ui/index.ts";
import {
  answerOf,
  approvalOriginView,
  type ApprovalOriginView,
  type QuestionDraft,
} from "../approval-form.ts";
import { useCommands, type ApprovalDecision } from "../commands.ts";
import { PlanBody, QuestionBody, ReviewBody, ToolBody } from "./bodies.tsx";
import { useClockNow } from "./clock.ts";
import {
  alwaysRememberOf,
  approvalAgeOf,
  approvalExpiryOf,
  approvalKeyOf,
  clockTextOf,
  feedbackTextOf,
  type ApprovalAge,
} from "./card-model.ts";

// 승인 카드. 트랜스크립트 끝, 끝 영역 받은 요청(InboxApprovals), P-03 목록이 같은 카드를 쓴다(FS-02).
// 카드는 거울의 approvals를 읽고 응답 직후 표시는 UI 스토어가 가진다. 대기열에서 빠지는 일은 approval.resolved가 한다.
// 부품: caustic AgentRequest(머리, 종류별 아이콘), 본문 ChoiceGroup·Input·Textarea·MessageCode·Alert, 단추 Button.

type ApprovalBodyKind = ApprovalRequestedPayload["body"]["kind"];

const FAILURE_ID: Readonly<Record<Exclude<ApprovalSend, "sending">, MessageId>> = {
  failed: "desktop.approvals.failure.failed",
  invalid: "desktop.approvals.failure.invalid",
  closed: "desktop.approvals.failure.closed",
  unapplied: "desktop.approvals.failure.unapplied",
  switching: "desktop.approvals.failure.switching",
};

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

/** 검토 "모두 승인": 남은 hunk를 모두 승인하고 제출한다(ReviewAnswer, L2.artifacts §4.2.4) */
const REVIEW_APPROVE_ALL: ReviewAnswerJson = {
  decisions: [],
  comments: [],
  submit: true,
  approveRemaining: true,
};

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

/** 카드가 보내는 답들. primary는 Y, always는 ⇧Y, deny는 N, edit는 계획의 수정 요청이다. null이면 그 동작을 끈다 */
type Decisions = {
  readonly primary: ApprovalDecision | null;
  readonly always: ApprovalDecision | null;
  readonly deny: ApprovalDecision;
  readonly edit: ApprovalDecision | null;
};

type Action = {
  readonly id: string;
  readonly label: MessageId;
  readonly decision: ApprovalDecision | null;
  readonly look: "solid" | "soft" | "ghost";
};

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
}): ReactNode {
  const { id, request } = props;
  const commands = useCommands();
  const sendState = useApprovalSend(id);
  const detail = useApprovalDetail(id);
  const thread = useThread(props.threadId);
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (busy || isTypingTarget(event.target)) return;
    const action = approvalKeyOf(event);
    if (action === null) return;
    const decision =
      action === "primary"
        ? decisions.primary
        : action === "always"
          ? decisions.always
          : decisions.deny;
    if (decision === null) return;
    event.preventDefault();
    respond(decision);
  };

  const origin = approvalOriginView(request.origin.caller);
  const expiry = approvalExpiryOf(request);
  const review = body.kind === "review" ? body.review : null;
  const parts = [
    t("desktop.approvals.card.thread", {
      name: thread?.title ?? t("desktop.approvals.card.thread.untitled"),
    }),
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

  const leading: Action[] = [
    { id: "deny", label: "desktop.approvals.deny.button", decision: decisions.deny, look: "ghost" },
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
  if (decisions.always !== null) {
    trailing.push({
      id: "always",
      label: "desktop.approvals.alwaysThread.button",
      decision: decisions.always,
      look: "ghost",
    });
  }
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
    <li data-slot="approval-card-item" className="list-none">
      <AgentRequest
        data-approval-kind={body.kind}
        kind={AGENT_KIND[body.kind]}
        lead={t(KIND_LEAD[body.kind])}
        title={request.title}
        subtitle={parts.join(" · ")}
        badge={origin === null ? undefined : originTextOf(origin)}
        actions={[]}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {bodyNode}
        <div data-slot="approval-actions" className="mt-2 flex flex-wrap items-center gap-2">
          {leading.map((action) => (
            <ActionButton key={action.id} action={action} disabled={busy} onRespond={respond} />
          ))}
          <span aria-hidden className="flex-1" />
          {trailing.map((action) => (
            <ActionButton key={action.id} action={action} disabled={busy} onRespond={respond} />
          ))}
          {busy ? <span className="dim">{t("desktop.approvals.sendingStatus")}</span> : null}
          {sendState === undefined || sendState === "sending" ? null : (
            <span className="error" role="alert" data-failure={sendState}>
              {t(FAILURE_ID[sendState])}
              {detail === undefined ? null : ` (${detail})`}
            </span>
          )}
        </div>
      </AgentRequest>
    </li>
  );
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
    const remember = alwaysRememberOf(request.remember);
    return {
      primary: { decision: "allow", remember: "once" },
      always: remember === null ? null : { decision: "allow", remember },
      deny,
      edit: null,
    };
  }
  if (body.kind === "question") {
    const answer = answerOf(body.question.questions, state.draft);
    return {
      primary: answer === null ? null : { decision: "answer", answer },
      always: null,
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
      always: null,
      deny,
      edit: text === null ? null : { decision: "deny", answer: { feedback: text } },
    };
  }
  return {
    primary: { decision: "answer", answer: REVIEW_APPROVE_ALL },
    always: null,
    deny,
    edit: null,
  };
}

const ApprovalCard = memo(function ApprovalCard(props: { readonly id: EventId }): ReactNode {
  const approval = useApproval(props.id);
  if (approval === undefined) return null;
  return <PendingCard id={props.id} threadId={approval.threadId} request={approval.request} />;
});

/** 승인 카드 목록. 트랜스크립트 끝과 끝 영역 받은 요청이 같은 카드를 그린다 */
export function ApprovalCardList(props: {
  readonly ids: readonly EventId[];
  readonly label?: string;
}): ReactNode {
  return (
    <ul aria-label={props.label}>
      {props.ids.map((id) => (
        <ApprovalCard key={id} id={id} />
      ))}
    </ul>
  );
}
