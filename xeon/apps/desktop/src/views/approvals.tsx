import { detach, rethrow } from "@xeon/contracts";
import type { EventId } from "@xeon/contracts/conversation";
import { memo, useState, type ReactNode } from "react";
import { useApproval, useApprovalIds } from "../state/engine/index.ts";
import { useApprovalDetail, useApprovalSend } from "../state/ui/index.ts";
import type { ApprovalSend } from "../state/ui/index.ts";
import {
  answerOf,
  QUESTION_TEXT_MAX,
  setPickText,
  toolApprovalView,
  togglePick,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalView,
} from "./approval-form.ts";
import { useCommands } from "./commands.ts";

// 승인 대기열. 항목은 거울의 approvals를 읽고, 응답을 보낸 직후의 표시는 UI 스토어가 가진다(FS-02).
// 대기열에서 빠지는 일은 approval.resolved 이벤트가 한다.
// 도구 승인은 실행될 명령, 인자, 쓸 비밀 핸들을 보이고(M2 검토 M2: 승인이 비밀 사용의 증거가 되므로 사용자가 내용을 알고 허용해야 한다),
// 질문은 선택지를 그리고 `allowFreeText`를 따르며 서비스가 받는 모양의 답만 보낸다.

const FAILURE_TEXT: Readonly<Record<Exclude<ApprovalSend, "sending">, string>> = {
  failed: "보내지 못했습니다. 다시 눌러 보세요.",
  invalid: "답이 올바르지 않아 적용되지 않았습니다. 선택을 확인한 뒤 다시 보내세요.",
  closed: "다른 곳에서 이미 처리된 요청입니다. 곧 목록에서 사라집니다.",
  unapplied:
    "적용되지 않았습니다. 이미 처리됐다면 곧 사라집니다. 아니면 내용을 확인한 뒤 다시 보내세요.",
};

function ToolDetails(props: { readonly view: ToolApprovalView }): ReactNode {
  const { view } = props;
  return (
    <>
      <div className="dim">
        도구 {view.toolName} · 위험도 {view.risk}
      </div>
      {view.command === null ? null : (
        <pre className="code" aria-label="실행할 명령">
          {view.command}
        </pre>
      )}
      {view.secrets.length === 0 ? null : (
        <div className="approval-secrets" role="note">
          <div>이 호출이 사용할 비밀</div>
          <ul>
            {view.secrets.map((secret) => (
              <li key={secret.name}>
                <code>{secret.name}</code>
                {secret.handle === null ? (
                  " (참조 형식이 올바르지 않음)"
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
        <div className="dim">인자가 커서 별도 저장소에 있습니다.</div>
      ) : (
        <details>
          <summary>인자</summary>
          <pre className="code">
            {view.argsText}
            {view.argsTruncated ? "\n…(이하 생략)" : ""}
          </pre>
        </details>
      )}
    </>
  );
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
            {option.recommended === true ? <span className="dim"> (추천)</span> : null}
            {option.description === undefined ? null : (
              <span className="dim"> - {option.description}</span>
            )}
          </span>
        </label>
      ))}
      {question.allowFreeText ? (
        <input
          type="text"
          aria-label={question.options.length === 0 ? question.text : "직접 입력"}
          placeholder={question.options.length === 0 ? "" : "직접 입력"}
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
      거부
    </button>
  );
  return (
    <li className="approval">
      <div className="approval-title">{request.title}</div>
      {body.kind === "tool" ? <ToolDetails view={toolApprovalView(body.tool)} /> : null}
      {body.kind === "plan" ? (
        <pre className="code">
          {typeof body.plan.plan === "string" ? body.plan.plan : "(계획 본문은 별도 저장)"}
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
              답하기
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
              허용
            </button>
            {deny}
          </>
        )}
        {busy ? <span className="dim">보내는 중…</span> : null}
        {send === undefined || send === "sending" ? null : (
          <span className="error" role="alert" data-failure={send}>
            {FAILURE_TEXT[send]}
            {detail === undefined ? null : ` (${detail})`}
          </span>
        )}
      </div>
    </li>
  );
});

export function ApprovalQueue(): ReactNode {
  const ids = useApprovalIds();
  if (ids.length === 0) return null;
  return (
    <section className="approvals" aria-label="승인 대기열">
      <h2>승인 대기 {ids.length}</h2>
      <ul>
        {ids.map((id) => (
          <ApprovalCard key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}
