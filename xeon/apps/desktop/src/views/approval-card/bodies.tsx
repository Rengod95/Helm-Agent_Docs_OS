import { t, type MessageId } from "@fresnel/client/i18n";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import { Alert, ChoiceGroup, ChoiceGroupItem, Input, MessageCode, Textarea } from "@caustic/react";
import type { ReactNode } from "react";
import {
  QUESTION_TEXT_MAX,
  setPickText,
  toolApprovalView,
  toolReplaceView,
  togglePick,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalBody,
  type ToolApprovalView,
  type ToolReplaceView,
} from "../approval-form.ts";
import { FEEDBACK_MAX, PLAN_FOLD_LINES, foldPlanLines, reviewTotalsOf } from "./card-model.ts";

// 승인 카드 본문(종류별). 상태와 단추는 approval-card.tsx가 맡는다. 본문은 값만 받고 응답을 보내지 않는다.

type ApprovalBody = ApprovalRequestedPayload["body"];
type PlanView = Extract<ApprovalBody, { kind: "plan" }>["plan"];
type ReviewView = Extract<ApprovalBody, { kind: "review" }>["review"];

const BLOCK_CODE = "block max-h-40 overflow-auto whitespace-pre-wrap break-words";

const TRUST_TEXT: Readonly<Record<NonNullable<ToolReplaceView["trust"]>, MessageId>> = {
  builtin: "desktop.approvals.replace.trust.builtin",
  user: "desktop.approvals.replace.trust.user",
  project: "desktop.approvals.replace.trust.project",
  untrusted: "desktop.approvals.replace.trust.untrusted",
};

const CHANGE_TEXT: Readonly<Record<ReviewView["files"][number]["change"], MessageId>> = {
  added: "desktop.approvals.review.change.added",
  modified: "desktop.approvals.review.change.modified",
  deleted: "desktop.approvals.review.change.deleted",
  renamed: "desktop.approvals.review.change.renamed",
};

/** 내장 도구 대체 승인(`tool_replace`). 누가 어떤 도구를 어떤 신뢰로 대체하는지와 경로 보호가 빠진다는 안내를 먼저 보인다 */
function ReplaceDetails(props: { readonly view: ToolReplaceView }): ReactNode {
  const { view } = props;
  return (
    <div>
      <div>{t("desktop.approvals.replace.heading")}</div>
      <dl>
        <dt>{t("desktop.approvals.replace.extension")}</dt>
        <dd>
          <code>{view.extension}</code>
        </dd>
        <dt>{t("desktop.approvals.replace.tool")}</dt>
        <dd>
          <code>{view.tool}</code>
        </dd>
        {view.trust === null ? null : (
          <>
            <dt>{t("desktop.approvals.replace.trust")}</dt>
            <dd>{t(TRUST_TEXT[view.trust])}</dd>
          </>
        )}
        <dt>{t("desktop.approvals.replace.risk")}</dt>
        <dd>
          {view.originalRisk === view.effectiveRisk
            ? view.effectiveRisk
            : t("desktop.approvals.replace.risk.value", {
                originalRisk: view.originalRisk,
                effectiveRisk: view.effectiveRisk,
              })}
        </dd>
      </dl>
      <Alert tone="warning" layout="inline">
        {t("desktop.approvals.replace.pathProtection")}
      </Alert>
      <div className="dim">{t("desktop.approvals.replace.effect")}</div>
    </div>
  );
}

function SecretsNote(props: { readonly secrets: ToolApprovalView["secrets"] }): ReactNode {
  if (props.secrets.length === 0) return null;
  return (
    <div role="note" className="mt-1.5">
      <div>{t("desktop.approvals.secrets.title")}</div>
      <ul className="mt-0.5 list-disc pl-5">
        {props.secrets.map((secret) => (
          <li key={secret.name}>
            <code>{secret.name}</code>
            {secret.handle === null ? (
              <> {t("desktop.approvals.secret.invalidHandle")}</>
            ) : (
              <>
                {" "}
                ← <code>{secret.handle}</code>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArgsFold(props: { readonly view: ToolApprovalView }): ReactNode {
  const { view } = props;
  if (view.argsStored)
    return <div className="dim">{t("desktop.approvals.args.storedElsewhere")}</div>;
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

export function ToolBody(props: { readonly body: ToolApprovalBody }): ReactNode {
  const view = toolApprovalView(props.body);
  const replace = toolReplaceView(props.body);
  const { ruleId } = props.body;
  return (
    <>
      {replace === null ? null : <ReplaceDetails view={replace} />}
      <div className="dim">
        {t("desktop.approvals.tool.summary", { toolName: view.toolName, risk: view.risk })}
      </div>
      {ruleId === null ? null : (
        <div className="dim">{t("desktop.approvals.rule", { id: ruleId })}</div>
      )}
      {view.command === null ? null : (
        <MessageCode aria-label={t("desktop.approvals.command.label")} className={BLOCK_CODE}>
          {view.command}
        </MessageCode>
      )}
      <SecretsNote secrets={view.secrets} />
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
                    <span className="dim"> {t("desktop.approvals.option.recommended")}</span>
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
        <div className="dim">{t("desktop.approvals.plan.storageNote")}</div>
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
            <ChoiceGroupItem key={mode} value={mode} title={mode} />
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
      <div className="dim">
        {t("desktop.approvals.review.totals", { files: totals.files, hunks: totals.hunks })}
      </div>
      <div
        role="list"
        aria-label={t("desktop.approvals.review.files.label")}
        className="flex max-h-48 flex-col gap-1 overflow-y-auto"
      >
        {review.files.map((file) => (
          <div key={file.path} role="listitem" className="flex flex-wrap items-baseline gap-2">
            <span className="dim">{t(CHANGE_TEXT[file.change])}</span>
            <MessageCode>{file.path}</MessageCode>
            <span className="dim">
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
