import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import type { LiveApprovalRequest } from "../../state/engine/input.ts";
import { Badge, Button, ScrollArea } from "@caustic/react";
import { ChevronRight, FileText, MessageCircleQuestion, ShieldCheck } from "@caustic/react/icons";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
  questionAutoAdvanceOf,
  questionPageKeyOf,
  questionPageOf,
  questionPagedOf,
  questionPrimaryOf,
  questionStepsOf,
} from "./question-pages.ts";
import { QuestionPager } from "./question-pager.tsx";
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
import { AttendGlow } from "../effects/attention-mark.tsx";

// 승인 카드. 트랜스크립트 끝, 끝 영역 받은 요청(InboxApprovals), P-03 목록이 같은 카드를 쓴다(FS-02).
// 카드는 거울의 approvals를 읽고 응답 직후 표시는 UI 스토어가 가진다. 대기열에서 빠지는 일은 approval.resolved가 한다.
// 머리의 대화 이름은 트랜스크립트 밖에서만 누를 수 있다(threadLinkVisibleOf).
// 카드 틀은 세 종류가 같다(L4.desktop-ux DP-134 [결정: 2026-11-12 사용자]): 안쪽 16, 머리(아이콘 칸 28 + 사이 12 + 제목·곁 줄),
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

/** 카드가 보내는 답들. primary는 Y, deny는 N. primary가 null이면 그 동작을 끈다 */
type Decisions = {
  readonly primary: ApprovalDecision | null;
  readonly deny: ApprovalDecision;
};

type Action = {
  readonly id: string;
  readonly label: MessageId;
  readonly decision: ApprovalDecision | null;
  readonly look: "solid" | "soft" | "ghost";
  /** 답을 보내지 않는 동작(질문 넘김의 "다음"). 있으면 decision 대신 이것을 부른다 */
  readonly onPress?: () => void;
};

/** 질문 선택지를 눌러 고른 뒤 다음 질문으로 넘기기까지(고른 표시가 눈에 들어올 만큼) */
const AUTO_ADVANCE_MS = 220;

/** 단추 크기: 세 종류 모두 폼 표준 sm(28)이다 */
const ACTION_SIZE = "sm";

function ActionButton(props: {
  readonly action: Action;
  readonly disabled: boolean;
  readonly onRespond: (decision: ApprovalDecision) => void;
}): ReactNode {
  const { action } = props;
  const decision = action.decision;
  const press = action.onPress;
  return (
    <Button
      type="button"
      data-action={action.id}
      size={ACTION_SIZE}
      variant={action.look}
      disabled={props.disabled || (press === undefined && decision === null)}
      onClick={() => {
        if (press !== undefined) press();
        else if (decision !== null) props.onRespond(decision);
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
  const argsId = useId();
  const titleId = useId();
  const { body } = request;
  const busy = sendState === "sending";

  // 질문 넘김(DP-224): 지금 보이는 질문과 사용자가 넘긴 횟수(새 질문으로 초점을 옮길 때를 안다)
  const questions = body.kind === "question" ? body.question.questions : [];
  const paged = questionPagedOf(questions.length);
  const [pageWanted, setPageWanted] = useState(0);
  const page = questionPageOf(pageWanted, questions.length);
  const [focusTick, setFocusTick] = useState(0);
  const lastPage = questionPrimaryOf(page, questions.length) === "answer";
  const goToPage = (next: number): void => {
    const target = questionPageOf(next, questions.length);
    if (target === page) return;
    setPageWanted(target);
    setFocusTick((n) => n + 1);
  };
  // 선택지를 눌러 고르면 잠깐(선택이 눈에 보이게) 뒤 다음 질문으로 간다. 그 사이 사용자가 넘겼으면 하지 않는다
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (advance.current !== null) clearTimeout(advance.current);
    },
    [],
  );
  const onPointerPick = (index: number): void => {
    const question = questions[index];
    if (question === undefined || index !== page) return;
    if (!questionAutoAdvanceOf({ question, picked: true, page, count: questions.length })) return;
    if (advance.current !== null) clearTimeout(advance.current);
    advance.current = setTimeout(() => {
      advance.current = null;
      setPageWanted((shown) => (shown === index ? index + 1 : shown));
      setFocusTick((n) => n + 1);
    }, AUTO_ADVANCE_MS);
  };

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
    // 넘기는 질문 카드에서 기본 답 글쇠(Y, 카드의 Enter)는 주 단추와 같다: 마지막 질문 전에는 "다음"이다
    if (action === "primary" && paged && !lastPage) {
      event.preventDefault();
      goToPage(page + 1);
      return;
    }
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

  // 오른쪽 아래 단추 묶음, 읽는 순서대로: [거부] [주 동작 | (질문 넘김) 다음]. 주 동작만 채움이다
  const answers: Action[] = [
    { id: "deny", label: denyLabelOf(body.kind), decision: decisions.deny, look: "ghost" },
    paged && !lastPage
      ? {
          id: "next",
          label: "desktop.approvals.question.next",
          decision: null,
          look: "solid",
          onPress: () => {
            goToPage(page + 1);
          },
        }
      : {
          id: "primary",
          label: primaryLabelOf(body.kind),
          decision: decisions.primary,
          look: "solid",
        },
  ];
  const tool = body.kind === "tool" ? body.tool : null;
  const hasArgs = tool !== null && toolHasArgs(tool);

  const bodyNode =
    body.kind === "tool" ? (
      <ToolBody body={body.tool} argsOpen={argsOpen} argsId={argsId} />
    ) : body.kind === "question" ? (
      <QuestionBody
        questions={body.question.questions}
        draft={draft}
        disabled={busy}
        onChange={setDraft}
        page={page}
        focusTick={focusTick}
        onPointerPick={onPointerPick}
      />
    ) : (
      <ReviewBody review={body.review} />
    );

  const tile = KIND_TILE[body.kind];
  const steps = paged ? questionStepsOf(questions, draft, page) : [];
  const pager = paged ? <QuestionPager steps={steps} disabled={busy} onPage={goToPage} /> : null;
  /** ←·→는 질문을 넘긴다. 선택지 묶음이 화살표로 선택을 옮기기 전에(잡기 단계에서) 받는다. 입력 칸 안의 글쇠는 그대로 둔다 */
  const onPageKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (!paged || busy || isTypingTarget(event.target)) return;
    const delta = questionPageKeyOf(event);
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    goToPage(page + delta);
  };
  return (
    <li
      data-slot="approval-card-item"
      data-approval-id={id}
      className="flex min-h-0 list-none flex-col"
    >
      <article
        data-slot="approval-card"
        data-approval-kind={body.kind}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onKeyDownCapture={onPageKey}
        // 주의 면(DP-190): 대기 중인 카드는 위 변 가운데의 빛과 안쪽으로 옅은 번짐이 깔린다(종류마다 빛깔 조합, 답을 보내는 동안은 걷는다)
        // 높이: 쌓임 띠가 준 상한(`--approval-card-max`) 안에서 본문만 스크롤하고 머리와 단추 줄은 늘 보인다(DP-225)
        className="fx-attend-card flex max-h-(--approval-card-max) min-h-0 flex-col gap-3 rounded-xl bg-surface-base p-4 text-ui text-text-primary shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle),var(--cs-focus)]"
      >
        <AttendGlow pending={!busy} kind={body.kind} />
        {/* 머리: 아이콘 칸 28, 제목 13/600, 곁 줄 12 tertiary(종류 · 대화 · 시각). 위험도·출처는 오른쪽 끝 */}
        <header data-slot="approval-head" className="flex min-w-0 shrink-0 items-start gap-3">
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
        {/* 본문이 비면(웹 승인처럼 접힌 인자뿐이면) 칸째 숨겨 머리와 단추 줄 사이가 12 하나로 남는다.
            본문은 카드 높이 상한 안에서 혼자 스크롤한다(가장자리 흐림이 더 있음을 알린다).
            스크롤 상자는 사방 4px 넓히고 본문이 같은 만큼 안쪽 여백을 가져, 선택지의 초점 고리(바깥 3px)가 상자에 잘리지 않고 글 자리는 그대로다 */}
        <ScrollArea
          fade
          label={t("desktop.approvals.body.label")}
          className="-m-1 h-auto min-h-0 w-[calc(100%+0.5rem)] shrink [&:not(:has([data-slot=approval-body]>:not(:empty)))]:hidden"
        >
          <div data-slot="approval-body" className="grid min-w-0 gap-2 p-1 pl-11">
            {bodyNode}
            {sendState === undefined || sendState === "sending" ? null : (
              <p className="m-0 text-ui text-danger-text" role="alert" data-failure={sendState}>
                {t(APPROVAL_FAILURE_ID[sendState])}
                {detail === undefined ? null : ` (${detail})`}
              </p>
            )}
          </div>
        </ScrollArea>
        {/* 단추 줄: 본문 스크롤 밖이라 늘 보인다. 넘기는 질문 카드는 왼쪽에 넘김 표시를 둔다(DP-224) */}
        <div
          data-slot="approval-actions"
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 pl-10"
        >
          {pager}
          {paged ? (
            <span className="sr-only" aria-live="polite">
              {t("desktop.approvals.question.position", { n: page + 1, total: questions.length })}
            </span>
          ) : null}
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
  if (body.kind === "tool") {
    return {
      primary: { decision: "allow", remember: "once" },
      deny,
    };
  }
  if (body.kind === "question") {
    const answer = answerOf(body.question.questions, state.draft);
    return {
      primary: answer === null ? null : { decision: "answer", answer },
      deny,
    };
  }
  return {
    primary: { decision: "answer", answer: APPROVE_ALL_ANSWER },
    deny,
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
    <ul className="m-0 flex min-h-0 flex-col gap-2 p-0" aria-label={props.label}>
      {props.ids.map((id) => (
        <ApprovalCard key={id} id={id} within={within} />
      ))}
    </ul>
  );
}
