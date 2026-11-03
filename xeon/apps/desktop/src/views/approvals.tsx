import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { EventId } from "@fresnel/contracts/conversation";
import { Alert } from "@caustic/react";
import { memo, useState, type ReactNode } from "react";
import { useApproval, useApprovalIds } from "../state/engine/index.ts";
import { useApprovalDetail, useApprovalSend } from "../state/ui/index.ts";
import type { ApprovalSend } from "../state/ui/index.ts";
import {
  answerOf,
  approvalOriginView,
  QUESTION_TEXT_MAX,
  setPickText,
  toolApprovalView,
  toolReplaceView,
  togglePick,
  type ToolApprovalBody,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalView,
  type ToolReplaceView,
} from "./approval-form.ts";
import { useCommands } from "./commands.ts";

// 승인 대기열. 항목은 거울의 approvals를 읽고, 응답을 보낸 직후의 표시는 UI 스토어가 가진다(FS-02).
// 대기열에서 빠지는 일은 approval.resolved 이벤트가 한다.
// 도구 승인은 실행될 명령, 인자, 쓸 시크릿 참조을 보이고(M2 검토 M2: 승인이 시크릿 사용의 증거가 되므로 사용자가 내용을 알고 허용해야 한다),
// 질문은 선택지를 그리고 `allowFreeText`를 따르며 서비스가 받는 모양의 답만 보낸다.

const FAILURE_ID: Readonly<Record<Exclude<ApprovalSend, "sending">, MessageId>> = {
  failed: "desktop.approvals.failure.failed",
  invalid: "desktop.approvals.failure.invalid",
  closed: "desktop.approvals.failure.closed",
  unapplied: "desktop.approvals.failure.unapplied",
  switching: "desktop.approvals.failure.switching",
};

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
    <div className="approval-replace">
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

function ToolDetails(props: {
  readonly view: ToolApprovalView;
  readonly body: ToolApprovalBody;
}): ReactNode {
  const { view } = props;
  const replace = toolReplaceView(props.body);
  return (
    <>
      {replace === null ? null : <ReplaceDetails view={replace} />}
      <div className="dim">
        {t("desktop.approvals.tool.summary", { toolName: view.toolName, risk: view.risk })}
      </div>
      {view.command === null ? null : (
        <pre className="code" aria-label={t("desktop.approvals.command.label")}>
          {view.command}
        </pre>
      )}
      {view.secrets.length === 0 ? null : (
        <div className="approval-secrets" role="note">
          <div>{t("desktop.approvals.secrets.title")}</div>
          <ul>
            {view.secrets.map((secret) => (
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
      )}
      {view.argsStored ? (
        <div className="dim">{t("desktop.approvals.args.storedElsewhere")}</div>
      ) : (
        <details>
          <summary>{t("desktop.approvals.args.label")}</summary>
          <pre className="code">
            {view.argsText}
            {view.argsTruncated ? `\n${t("desktop.approvals.args.truncationNotice")}` : ""}
          </pre>
        </details>
      )}
    </>
  );
}

function OriginLine(props: { readonly caller: string }): ReactNode {
  const origin = approvalOriginView(props.caller);
  if (origin === null) return null;
  const text =
    origin.kind === "background"
      ? t("desktop.approvals.origin.background")
      : origin.kind === "host"
        ? t("desktop.approvals.origin.host")
        : origin.kind === "subagent"
          ? t("desktop.approvals.origin.subagent", { name: origin.name })
          : t("desktop.approvals.origin.group", { name: origin.name });
  return <div className="dim">{`${t("desktop.approvals.origin.label")}: ${text}`}</div>;
}

function QuestionField(props: {
  readonly scope: string;
  readonly question: QuestionItem;
  readonly draft: QuestionDraft;
  readonly disabled: boolean;
  readonly onChange: (next: (prev: QuestionDraft) => QuestionDraft) => void;
}): ReactNode {
  const { question, draft, disabled } = props;
  const pick = draft[question.id];
  const selected = pick?.selected ?? [];
  const name = `${props.scope}:${question.id}`;
  return (
    <fieldset className="question" disabled={disabled}>
      <legend>
        {question.header === undefined ? null : <span className="dim">{question.header} · </span>}
        {question.text}
      </legend>
      {question.options.map((option) => (
        <label key={option.id} className="option">
          <input
            type={question.multiSelect ? "checkbox" : "radio"}
            name={name}
            checked={selected.includes(option.id)}
            onChange={() => {
              props.onChange((prev) => togglePick(prev, question, option.id));
            }}
          />
          <span>
            {option.label}
            {option.recommended === true ? (
              <span className="dim"> {t("desktop.approvals.option.recommended")}</span>
            ) : null}
            {option.description === undefined ? null : (
              <span className="dim"> - {option.description}</span>
            )}
          </span>
        </label>
      ))}
      {question.allowFreeText ? (
        <input
          type="text"
          aria-label={
            question.options.length === 0 ? question.text : t("cli.render.approval.how.freeText")
          }
          placeholder={question.options.length === 0 ? "" : t("cli.render.approval.how.freeText")}
          maxLength={QUESTION_TEXT_MAX}
          value={pick?.text ?? ""}
          onChange={(event) => {
            const value = event.currentTarget.value;
            props.onChange((prev) => setPickText(prev, question.id, value));
          }}
        />
      ) : null}
    </fieldset>
  );
}

const ApprovalCard = memo(function ApprovalCard(props: { readonly id: EventId }): ReactNode {
  const commands = useCommands();
  const approval = useApproval(props.id);
  const send = useApprovalSend(props.id);
  const detail = useApprovalDetail(props.id);
  const [draft, setDraft] = useState<QuestionDraft>({});
  if (approval === undefined) return null;
  const { request } = approval;
  const busy = send === "sending";
  const body = request.body;
  const answer = body.kind === "question" ? answerOf(body.question.questions, draft) : null;
  const deny = (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        detach(commands.respondApproval(props.id, { decision: "deny" }), rethrow);
      }}
    >
      {t("desktop.approvals.deny.button")}
    </button>
  );
  return (
    <li className="approval">
      <div className="approval-title">{request.title}</div>
      <OriginLine caller={request.origin.caller} />
      {body.kind === "tool" ? (
        <ToolDetails view={toolApprovalView(body.tool)} body={body.tool} />
      ) : null}
      {body.kind === "plan" ? (
        <pre className="code">
          {typeof body.plan.plan === "string"
            ? body.plan.plan
            : t("desktop.approvals.plan.storageNote")}
        </pre>
      ) : null}
      {body.kind === "question"
        ? body.question.questions.map((q) => (
            <QuestionField
              key={q.id}
              scope={props.id}
              question={q}
              draft={draft}
              disabled={busy}
              onChange={setDraft}
            />
          ))
        : null}
      <div className="approval-actions">
        {body.kind === "question" ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy || answer === null}
              onClick={() => {
                if (answer === null) return;
                detach(commands.respondApproval(props.id, { decision: "answer", answer }), rethrow);
              }}
            >
              {t("desktop.approvals.answer.button")}
            </button>
            {deny}
          </>
        ) : (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                detach(
                  commands.respondApproval(props.id, { decision: "allow", remember: "once" }),
                  rethrow,
                );
              }}
            >
              {t("desktop.approvals.allow.button")}
            </button>
            {deny}
          </>
        )}
        {busy ? <span className="dim">{t("desktop.approvals.sendingStatus")}</span> : null}
        {send === undefined || send === "sending" ? null : (
          <span className="error" role="alert" data-failure={send}>
            {t(FAILURE_ID[send])}
            {detail === undefined ? null : ` (${detail})`}
          </span>
        )}
      </div>
    </li>
  );
});

/** 끝 영역 받은 요청 탭. 트랜스크립트 아래와 같은 카드 부품을 쓴다(`approval.resolved`로 함께 사라진다) */
export function InboxApprovals(): ReactNode {
  const ids = useApprovalIds();
  if (ids.length === 0) return <div className="dim">{t("desktop.approvals.inbox.empty")}</div>;
  return (
    <ul aria-label={t("desktop.approvals.queue.label")}>
      {ids.map((id) => (
        <ApprovalCard key={id} id={id} />
      ))}
    </ul>
  );
}

export function ApprovalQueue(): ReactNode {
  const ids = useApprovalIds();
  if (ids.length === 0) return null;
  return (
    <section className="approvals" aria-label={t("desktop.approvals.queue.label")}>
      <h2>{t("desktop.approvals.queue.title", { count: ids.length })}</h2>
      <ul>
        {ids.map((id) => (
          <ApprovalCard key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}
