import { t, type MessageId } from "@fresnel/client/i18n";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import {
  Alert,
  Badge,
  ChoiceGroup,
  ChoiceGroupItem,
  Input,
  ListDescription,
  ListDescriptionRow,
  MessageCode,
  Textarea,
} from "@caustic/react";
import type { ReactNode } from "react";
import {
  QUESTION_TEXT_MAX,
  REVIEW_CHANGE_ID,
  fileChangeViewOf,
  setPickText,
  toolApprovalView,
  toolReplaceView,
  togglePick,
  type FileChangeView,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalBody,
  type ToolApprovalView,
  type ToolReplaceView,
} from "../approval-form.ts";
import {
  FEEDBACK_MAX,
  PLAN_FOLD_LINES,
  foldPlanLines,
  modeLabelIdOf,
  reviewTotalsOf,
} from "./card-model.ts";
import { FileChangeDiff } from "../file-change-view.tsx";

/** 승인 뒤 모드의 화면 글. 모르는 모드는 원시값이다 */
function modeLabelOf(mode: string): string {
  const id = modeLabelIdOf(mode);
  return id === null ? mode : t(id);
}

// 승인 카드 본문(종류별). 상태와 단추는 approval-card.tsx가 맡는다. 본문은 값만 받고 응답을 보내지 않는다.

type ApprovalBody = ApprovalRequestedPayload["body"];
type PlanView = Extract<ApprovalBody, { kind: "plan" }>["plan"];
type ReviewView = Extract<ApprovalBody, { kind: "review" }>["review"];

const BLOCK_CODE = "block max-h-40 overflow-auto whitespace-pre-wrap break-words";

const RISK_TEXT: Readonly<Record<string, MessageId>> = {
  read: "desktop.approvals.risk.read",
  write: "desktop.approvals.risk.write",
  exec: "desktop.approvals.risk.exec",
  execute: "desktop.approvals.risk.exec",
};

/** 위험도 값(read·write·exec)을 카탈로그 문구로 바꾼다. 모르는 값은 그대로 보인다 (rtE R-10) */
function riskLabelOf(risk: string): string {
  const id = RISK_TEXT[risk];
  return id === undefined ? risk : t(id);
}

const TRUST_TEXT: Readonly<Record<NonNullable<ToolReplaceView["trust"]>, MessageId>> = {
  builtin: "desktop.approvals.replace.trust.builtin",
  user: "desktop.approvals.replace.trust.user",
  project: "desktop.approvals.replace.trust.project",
  untrusted: "desktop.approvals.replace.trust.untrusted",
};

/** 내장 도구 대체 승인(`tool_replace`). 누가 어떤 도구를 어떤 신뢰로 대체하는지와 경로 보호가 빠진다는 안내를 먼저 보인다 */
function ReplaceDetails(props: { readonly view: ToolReplaceView }): ReactNode {
  const { view } = props;
  return (
    <div className="grid gap-1.5">
      <div>{t("desktop.approvals.replace.heading")}</div>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.approvals.replace.heading")}
      >
        <ListDescriptionRow term={t("desktop.approvals.replace.extension")}>
          <code>{view.extension}</code>
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.approvals.replace.tool")}>
          <code>{view.tool}</code>
        </ListDescriptionRow>
        {view.trust === null ? null : (
          <ListDescriptionRow term={t("desktop.approvals.replace.trust")}>
            {t(TRUST_TEXT[view.trust])}
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={t("desktop.approvals.replace.risk")}>
          {view.originalRisk === view.effectiveRisk
            ? riskLabelOf(view.effectiveRisk)
            : t("desktop.approvals.replace.risk.value", {
                originalRisk: riskLabelOf(view.originalRisk),
                effectiveRisk: riskLabelOf(view.effectiveRisk),
              })}
        </ListDescriptionRow>
      </ListDescription>
      <Alert tone="warning" layout="inline">
        {t("desktop.approvals.replace.pathProtection")}
      </Alert>
      <div className="text-ui-sm text-text-secondary">{t("desktop.approvals.replace.effect")}</div>
    </div>
  );
}

function ArgsFold(props: { readonly view: ToolApprovalView }): ReactNode {
  const { view } = props;
  if (view.argsStored)
    return (
      <div className="text-ui-sm text-text-secondary">
        {t("desktop.approvals.args.storedElsewhere")}
      </div>
    );
  return (
    <details className="mt-1.5">
      <summary>{t("desktop.approvals.args.label")}</summary>
      <MessageCode className={BLOCK_CODE}>
        {view.argsText}
        {view.argsTruncated ? `\n${t("desktop.approvals.args.truncationNotice")}` : ""}
      </MessageCode>
    </details>
  );
}

/** 파일 변경 승인의 머리(수정 또는 파일 쓰기 글과 경로)와 그림 */
function FileChangeBlock(props: { readonly view: FileChangeView }): ReactNode {
  const { view } = props;
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-ui-sm text-text-secondary">
          {view.kind === "edit"
            ? t("desktop.approvals.diff.editLabel")
            : t("desktop.approvals.diff.writeLabel")}
        </span>
        <code className="min-w-0 break-all">{view.path}</code>
      </div>
      <FileChangeDiff view={view} />
    </div>
  );
}

export function ToolBody(props: { readonly body: ToolApprovalBody }): ReactNode {
  const view = toolApprovalView(props.body);
  const replace = toolReplaceView(props.body);
  const change = fileChangeViewOf(props.body);
  const { ruleId } = props.body;
  return (
    <>
      {replace === null ? null : <ReplaceDetails view={replace} />}
      {/* 시안 tool-approval: 명령, 위험도, 시크릿 참조를 한 목록(ListDescription)으로 보인다 */}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.approvals.tool.summary", {
          toolName: view.toolName,
          risk: riskLabelOf(view.risk),
        })}
        className="rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
      >
        {view.command === null ? null : (
          <ListDescriptionRow term={t("desktop.approvals.command.label")} mono>
            <span className="whitespace-pre-wrap break-all">{view.command}</span>
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={t("desktop.approvals.replace.risk")}>
          <Badge size="xs">{riskLabelOf(view.risk)}</Badge>
        </ListDescriptionRow>
        {view.secrets.map((secret) => (
          <ListDescriptionRow key={secret.name} term={t("desktop.approvals.secret.term")} mono>
            <span className="break-all">
              {secret.name}
              {secret.handle === null
                ? ` ${t("desktop.approvals.secret.invalidHandle")}`
                : ` ← ${secret.handle}`}
            </span>
          </ListDescriptionRow>
        ))}
      </ListDescription>
      {ruleId === null ? null : (
        <div className="text-ui-sm text-text-secondary">
          {t("desktop.approvals.rule", { id: ruleId })}
        </div>
      )}
      {change === null ? null : <FileChangeBlock view={change} />}
      <ArgsFold view={view} />
    </>
  );
}

function QuestionField(props: {
  readonly question: QuestionItem;
  readonly draft: QuestionDraft;
  readonly disabled: boolean;
  readonly onChange: (next: (prev: QuestionDraft) => QuestionDraft) => void;
}): ReactNode {
  const { question, draft, disabled, onChange } = props;
  const pick = draft[question.id];
  const selected = pick?.selected ?? [];
  const questionText =
    question.header === undefined ? question.text : `${question.header} · ${question.text}`;
  const choose = (optionId: string): void => {
    onChange((prev) => togglePick(prev, question, optionId));
  };
  return (
    <div className="flex flex-col gap-1.5">
      {question.options.length === 0 ? (
        <div>{questionText}</div>
      ) : (
        <ChoiceGroup
          appearance="answer"
          type={question.multiSelect ? "multiple" : "single"}
          value={question.multiSelect ? [...selected] : (selected[0] ?? "")}
          disabled={disabled}
          question={questionText}
          onValueChange={(value) => {
            // 한 줄 선택지는 화살표 키로 옮길 때 이 값으로 온다. 클릭은 아래 onClick이 받는다
            if (!question.multiSelect && typeof value === "string" && value !== "") choose(value);
          }}
        >
          {question.options.map((option) => (
            <ChoiceGroupItem
              key={option.id}
              value={option.id}
              title={
                <>
                  {option.label}
                  {option.recommended === true ? (
                    <span className="text-ui-sm text-text-secondary">
                      {" "}
                      {t("desktop.approvals.option.recommended")}
                    </span>
                  ) : null}
                </>
              }
              description={option.description}
              onClick={(event) => {
                // 선택 상태는 draft가 정한다. 그래서 기본 선택 동작을 막고 토글만 한다
                event.preventDefault();
                choose(option.id);
              }}
            />
          ))}
        </ChoiceGroup>
      )}
      {question.allowFreeText ? (
        <Input
          type="text"
          aria-label={
            question.options.length === 0 ? question.text : t("cli.render.approval.how.freeText")
          }
          placeholder={question.options.length === 0 ? "" : t("cli.render.approval.how.freeText")}
          maxLength={QUESTION_TEXT_MAX}
          disabled={disabled}
          value={pick?.text ?? ""}
          onValueChange={(value) => {
            onChange((prev) => setPickText(prev, question.id, value));
          }}
        />
      ) : null}
    </div>
  );
}

export function QuestionBody(props: {
  readonly questions: readonly QuestionItem[];
  readonly draft: QuestionDraft;
  readonly disabled: boolean;
  readonly onChange: (next: (prev: QuestionDraft) => QuestionDraft) => void;
}): ReactNode {
  return (
    <>
      {props.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          draft={props.draft}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      ))}
    </>
  );
}

export function PlanBody(props: {
  readonly plan: PlanView;
  readonly mode: string;
  readonly onMode: (mode: string) => void;
  readonly feedback: string;
  readonly onFeedback: (text: string) => void;
  readonly disabled: boolean;
}): ReactNode {
  const { plan } = props;
  const text = typeof plan.plan === "string" ? plan.plan : null;
  const fold = text === null ? null : foldPlanLines(text, PLAN_FOLD_LINES);
  return (
    <>
      {fold === null ? (
        <div className="text-ui-sm text-text-secondary">
          {t("desktop.approvals.plan.storageNote")}
        </div>
      ) : (
        <>
          <MessageCode className={BLOCK_CODE}>{fold.head}</MessageCode>
          {fold.rest === null ? null : (
            <details>
              <summary>{t("desktop.approvals.plan.more")}</summary>
              <MessageCode className={BLOCK_CODE}>{fold.rest}</MessageCode>
            </details>
          )}
        </>
      )}
      {plan.nextModes.length === 0 ? null : (
        <ChoiceGroup
          appearance="answer"
          question={t("desktop.approvals.plan.mode")}
          value={props.mode}
          disabled={props.disabled}
          onValueChange={(value) => {
            if (typeof value === "string") props.onMode(value);
          }}
        >
          {plan.nextModes.map((mode) => (
            <ChoiceGroupItem key={mode} value={mode} title={modeLabelOf(mode)} />
          ))}
        </ChoiceGroup>
      )}
      <Textarea
        aria-label={t("desktop.approvals.plan.feedback")}
        rows={2}
        maxLength={FEEDBACK_MAX}
        value={props.feedback}
        disabled={props.disabled}
        onValueChange={props.onFeedback}
      />
    </>
  );
}

/** 검토 본문: 파일 합계와 파일마다 변경 종류, hunk 수. hunk 본문은 싣지 않는다(검토 열기는 P-04가 맡는다) */
export function ReviewBody(props: { readonly review: ReviewView }): ReactNode {
  const { review } = props;
  const totals = reviewTotalsOf(review.files);
  return (
    <>
      <div className="text-ui-sm text-text-secondary">
        {t("desktop.approvals.review.totals", { files: totals.files, hunks: totals.hunks })}
      </div>
      <div
        role="list"
        aria-label={t("desktop.approvals.review.files.label")}
        className="flex max-h-48 flex-col gap-1 overflow-y-auto"
      >
        {review.files.map((file) => (
          <div key={file.path} role="listitem" className="flex flex-wrap items-baseline gap-2">
            <span className="text-ui-sm text-text-secondary">
              {t(REVIEW_CHANGE_ID[file.change])}
            </span>
            <MessageCode>{file.path}</MessageCode>
            <span className="text-ui-sm text-text-secondary">
              {file.binary
                ? t("desktop.approvals.review.binary")
                : t("desktop.approvals.review.hunks", { count: file.hunks })}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
