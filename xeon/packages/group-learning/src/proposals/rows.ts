import { assertNever } from "@xeon/contracts";
import { renderDiff } from "./diff.ts";
import type { LearningEvent } from "./events.ts";
import type { Proposal } from "./proposal.ts";
import { transition, type ProposalEvent } from "./queue.ts";
import type { ReviewRow } from "./reader.ts";

// 투영 규칙. 이벤트 하나가 후보 행과 검토 행에 하는 일이다. 순수하고 동기다(eng.events.design EV-06). 후보 행의 전이는 결정 경로가 쓰는 `transition`과 같은 함수라
// 이벤트로 접은 행과 결정 경로가 만든 행이 어긋나지 않는다. SQL 구현(`sql.ts`)과 시험의 메모리 구현이 같은 규칙을 쓴다.

export interface ProjectionRows {
  getProposal(id: string): Proposal | undefined;
  putProposal(proposal: Proposal): void;
  getReview(threadId: string, requestId: string): ReviewRow | undefined;
  putReview(review: ReviewRow): void;
}

function proposalEventOf(event: LearningEvent, row: Proposal): ProposalEvent | undefined {
  switch (event.kind) {
    case "proposal.edited":
      return {
        kind: "edit",
        revision: row.revision,
        body: event.body,
        bodyHash: event.bodyHash,
        diff: renderDiff(row.op, row.target, event.body),
      };
    case "proposal.decided":
      if (event.status === "approved") {
        return { kind: "approve", revision: event.revision, scope: event.scope };
      }
      return event.reason === "scan_failed" ? { kind: "scanBlocked" } : { kind: "reject" };
    case "proposal.applied":
      return {
        kind: "apply",
        transition: { kind: "applied", ledgerId: event.ledgerId, afterHash: event.afterHash },
      };
    case "proposal.apply_failed":
      if (event.nextStatus === "pending") {
        return { kind: "apply", transition: { kind: "backToPending", reason: "base_stale" } };
      }
      if (event.nextStatus === "applied") return { kind: "revertRefused" };
      return {
        kind: "apply",
        transition: {
          kind: "rejected",
          reason: event.reason === "scan_failed" ? "scan_failed" : "apply_failed",
        },
      };
    case "proposal.reverted":
      return { kind: "revertDone" };
    case "proposal.expired":
      return { kind: "expire" };
    case "fork.started":
    case "fork.finished":
    case "proposal.created":
      return undefined;
    default:
      return assertNever(event, "LearningEvent");
  }
}

function atOf(event: LearningEvent): number {
  return event.kind === "proposal.created" ? event.proposal.updatedAt : event.at;
}

/** 이벤트 하나를 행에 반영한다. 순서가 어긋나 전이를 받을 수 없는 이벤트는 건너뛴다 */
export function applyLearningEvent(rows: ProjectionRows, event: LearningEvent): void {
  if (event.kind === "fork.started") {
    if (rows.getReview(event.parentThreadId, event.requestId) !== undefined) return;
    rows.putReview({
      requestId: event.requestId,
      threadId: event.parentThreadId,
      childThreadId: event.childThreadId,
      epoch: event.epoch,
      startedAt: event.at,
      finishedAt: null,
      outcome: null,
      inputTokens: 0,
      outputTokens: 0,
    });
    return;
  }
  if (event.kind === "fork.finished") {
    const row = rows.getReview(event.parentThreadId, event.requestId);
    rows.putReview({
      requestId: event.requestId,
      threadId: event.parentThreadId,
      childThreadId: row?.childThreadId ?? "",
      epoch: row?.epoch ?? 0,
      startedAt: row?.startedAt ?? event.at,
      finishedAt: row?.finishedAt ?? event.at,
      outcome: row?.outcome ?? event.outcome,
      inputTokens:
        row?.finishedAt === null || row === undefined ? event.inputTokens : row.inputTokens,
      outputTokens:
        row?.finishedAt === null || row === undefined ? event.outputTokens : row.outputTokens,
    });
    return;
  }
  if (event.kind === "proposal.created") {
    const { proposal } = event;
    rows.putProposal({
      ...proposal,
      diff: proposal.body === "" ? "" : renderDiff(proposal.op, proposal.target, proposal.body),
    });
    return;
  }
  const row = rows.getProposal(event.id);
  if (row === undefined) return;
  const mapped = proposalEventOf(event, row);
  if (mapped === undefined) return;
  const next = transition(row, mapped, atOf(event));
  if (!next.ok) return;
  // 적용 실패로 되돌아온 사유는 전이가 정한 사유 대신 이벤트가 적은 사유다(`rollback_refused`, `apply_failed`)
  rows.putProposal(
    event.kind === "proposal.apply_failed" ? { ...next.value, reason: event.reason } : next.value,
  );
}
