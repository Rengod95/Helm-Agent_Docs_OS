import type { EventId } from "@xeon/contracts/conversation";
import { memo, useState, type ReactNode } from "react";
import { useApproval, useApprovalIds } from "../state/engine/index.ts";
import { useApprovalSend } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";

// 승인 대기열. 항목은 거울의 approvals를 읽고, 응답을 보낸 직후의 표시는 UI 스토어가 가진다(FS-02).
// 대기열에서 빠지는 일은 approval.resolved 이벤트가 한다.

const ApprovalCard = memo(function ApprovalCard(props: { readonly id: EventId }): ReactNode {
  const commands = useCommands();
  const approval = useApproval(props.id);
  const send = useApprovalSend(props.id);
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  if (approval === undefined) return null;
  const { request } = approval;
  const busy = send === "sending";
  const body = request.body;
  return (
    <li className="approval">
      <div className="approval-title">{request.title}</div>
      {body.kind === "tool" ? (
        <div className="dim">
          도구 {body.tool.toolName} · 위험도 {body.tool.risk}
        </div>
      ) : null}
      {body.kind === "plan" ? (
        <pre className="code">
          {typeof body.plan.plan === "string" ? body.plan.plan : "(계획 본문은 별도 저장)"}
        </pre>
      ) : null}
      {body.kind === "question"
        ? body.question.questions.map((q) => (
            <label key={q.id} className="question">
              <span>{q.text}</span>
              <input
                type="text"
                value={answers[q.id] ?? ""}
                disabled={busy}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setAnswers((prev) => ({ ...prev, [q.id]: value }));
                }}
              />
            </label>
          ))
        : null}
      <div className="approval-actions">
        {body.kind === "question" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void commands.respondApproval(props.id, { decision: "answer", answer: answers });
            }}
          >
            답하기
          </button>
        ) : (
          <>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                void commands.respondApproval(props.id, { decision: "allow", remember: "once" });
              }}
            >
              허용
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void commands.respondApproval(props.id, { decision: "deny" });
              }}
            >
              거부
            </button>
          </>
        )}
        {busy ? <span className="dim">보내는 중…</span> : null}
        {send === "failed" ? (
          <span className="error" role="alert">
            보내지 못했습니다. 다시 눌러 보세요.
          </span>
        ) : null}
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
