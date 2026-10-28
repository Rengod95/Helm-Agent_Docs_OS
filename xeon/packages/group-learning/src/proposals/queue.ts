import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type { ApplyTransition, LearningError } from "../results.ts";
import type { Proposal, ProposalReason } from "./proposal.ts";

// L3.learning.spec §4.5 상태 전이 표. 순수 함수만 둔다: I/O, 시계, 난수를 쓰지 않는다(시각은 호출하는 쪽이 넘긴다).

export type ProposalEvent =
  /** 사용자 수정. 새 본문 해시와 diff를 호출하는 쪽이 계산해 넘긴다 */
  | {
      readonly kind: "edit";
      readonly revision: number;
      readonly body: string;
      readonly bodyHash: string;
      readonly diff: string;
    }
  /** 수정 뒤 사전 스캔이 막음 */
  | { readonly kind: "scanBlocked" }
  | {
      readonly kind: "approve";
      readonly revision: number;
      readonly scope: "user" | "project" | undefined;
    }
  /** 승인 불요 정책(비파괴 연산, approval.required = false) */
  | { readonly kind: "policyApprove" }
  | { readonly kind: "reject" }
  | { readonly kind: "expire" }
  | { readonly kind: "apply"; readonly transition: ApplyTransition }
  | { readonly kind: "revertDone" }
  | { readonly kind: "revertRefused" };

export type TransitionRefusal = Extract<
  LearningError,
  | { kind: "learning.closed" }
  | { kind: "learning.revisionMismatch" }
  | { kind: "learning.scopeNotAllowed" }
>;

const TERMINAL: ReadonlySet<Proposal["status"]> = new Set(["rejected", "expired", "reverted"]);

/** 종료 상태이거나 이 사건을 받을 수 없는 상태다 */
function closed(proposal: Proposal): TransitionRefusal {
  return { kind: "learning.closed", proposalId: proposal.id, status: proposal.status };
}

function withStatus(
  proposal: Proposal,
  status: Proposal["status"],
  reason: ProposalReason | null,
  now: number,
): Proposal {
  return { ...proposal, status, reason, updatedAt: now };
}

/** 표에 없는 (현재, 사건) 쌍은 `learning.closed`로 거부한다 */
export function transition(
  proposal: Proposal,
  event: ProposalEvent,
  now: number,
): Result<Proposal, TransitionRefusal> {
  if (TERMINAL.has(proposal.status)) return err(closed(proposal));
  switch (event.kind) {
    case "edit": {
      if (proposal.status !== "pending") return err(closed(proposal));
      if (event.revision !== proposal.revision) {
        return err({
          kind: "learning.revisionMismatch",
          proposalId: proposal.id,
          current: proposal.revision,
        });
      }
      return ok({
        ...withStatus(proposal, "pending", null, now),
        body: event.body,
        bodyHash: event.bodyHash,
        diff: event.diff,
        revision: proposal.revision + 1,
      });
    }
    case "scanBlocked":
      if (proposal.status !== "pending") return err(closed(proposal));
      // 막힌 본문은 본문과 diff 어디에도 남기지 않는다(§4.5 표, §4.6 3)
      return ok({ ...withStatus(proposal, "rejected", "scan_failed", now), body: "", diff: "" });
    case "approve": {
      if (proposal.status !== "pending") return err(closed(proposal));
      if (event.revision !== proposal.revision) {
        return err({
          kind: "learning.revisionMismatch",
          proposalId: proposal.id,
          current: proposal.revision,
        });
      }
      const scope = event.scope ?? proposal.scope;
      if (scope === "project" && proposal.kind !== "skill") {
        return err({ kind: "learning.scopeNotAllowed", proposalId: proposal.id });
      }
      return ok({ ...withStatus(proposal, "approved", null, now), scope });
    }
    case "policyApprove":
      if (proposal.status !== "pending") return err(closed(proposal));
      return ok(withStatus(proposal, "approved", null, now));
    case "reject":
      if (proposal.status !== "pending") return err(closed(proposal));
      return ok(withStatus(proposal, "rejected", "user_rejected", now));
    case "expire":
      if (proposal.status !== "pending") return err(closed(proposal));
      return ok({ ...withStatus(proposal, "expired", "ttl", now), body: "" });
    case "apply":
      return applyEvent(proposal, event.transition, now);
    case "revertDone":
      if (proposal.status !== "applied") return err(closed(proposal));
      return ok(withStatus(proposal, "reverted", null, now));
    case "revertRefused":
      if (proposal.status !== "applied") return err(closed(proposal));
      return ok(withStatus(proposal, "applied", "rollback_refused", now));
    default:
      return assertNever(event, "ProposalEvent");
  }
}

function applyEvent(
  proposal: Proposal,
  result: ApplyTransition,
  now: number,
): Result<Proposal, TransitionRefusal> {
  if (proposal.status !== "approved") return err(closed(proposal));
  switch (result.kind) {
    case "applied":
      return ok({ ...withStatus(proposal, "applied", null, now), ledgerId: result.ledgerId });
    case "rejected":
      return ok({ ...withStatus(proposal, "rejected", result.reason, now), body: "", diff: "" });
    case "backToPending":
      // 새 diff는 호출하는 쪽이 다시 계산해 edit 없이 넣는다. 이전 승인은 이 판에 걸리지 않게 판을 올린다
      return ok({
        ...withStatus(proposal, "pending", result.reason, now),
        revision: proposal.revision + 1,
      });
    case "retry":
      return ok(withStatus(proposal, "approved", null, now));
    default:
      return assertNever(result, "ApplyTransition");
  }
}

/** 승인 대기 시간이 만료 일수를 넘었는가 */
export function isExpired(proposal: Proposal, now: number, expiryDays: number): boolean {
  return proposal.status === "pending" && now - proposal.createdAt >= expiryDays * 86_400_000;
}

/** 승인 없이 적용 단계로 갈 수 있는 후보인가(§4.1 끝): 설정이 승인을 끄고 연산이 파괴적이지 않다 */
export function needsApproval(
  proposal: Pick<Proposal, "destructive">,
  approvalRequired: boolean,
): boolean {
  return approvalRequired || proposal.destructive;
}
