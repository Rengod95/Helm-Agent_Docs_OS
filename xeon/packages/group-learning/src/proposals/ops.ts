import { assertNever, eachAsync, err, ok, type Clock, type Result } from "@xeon/contracts";
import { proposedRecordOf, skillDecisionRecordOf, type RecordDraft } from "../records.ts";
import {
  applyOutcome,
  type ApplyTransition,
  type DecisionResult,
  type LearningError,
  type QueueSweep,
} from "../results.ts";
import type { LearningSettings } from "../settings.ts";
import { sha256Hex } from "../hash.ts";
import { renderDiff } from "./diff.ts";
import type { LearningEvent } from "./events.ts";
import type { KnowledgeFailure, KnowledgePort } from "./knowledge.ts";
import { isExpired, transition, type ProposalEvent } from "./queue.ts";
import { preScan } from "./scan.ts";
import { proposalView, type Proposal, type ProposalView } from "./proposal.ts";
import type { LearningQueueReader, ProposalFilter } from "./reader.ts";

// L3.learning.spec §4.5 승인 대기열의 결정 경로. 명령 처리기에서 돈다(재실행되는 코드가 아니고 ambient가 있다, §4.5 규칙 6). 상태 변화는 모두 비공개 기록(`LearningWriter.event`)으로 남기고
// 투영기가 행을 만든다. 같은 전이 함수(`transition`)가 여기와 투영기에서 쓰이므로 여기서 계산한 다음 행과 투영된 행이 같다.

/** 사용자 결정(§3.6). `edit`에 판(`revision`)을 더했다: F wire가 approve와 edit에 판을 필수로 둔다(M3-REQ-18) */
export type ProposalDecision =
  | {
      readonly kind: "approve";
      readonly proposalId: string;
      readonly revision: number;
      readonly scope?: "user" | "project";
    }
  | { readonly kind: "reject"; readonly proposalId: string; readonly note?: string }
  | {
      readonly kind: "edit";
      readonly proposalId: string;
      readonly revision: number;
      readonly body: string;
    }
  | { readonly kind: "revert"; readonly proposalId: string };

/** 그룹의 쓰기 면. `g.recordPrivate`와 `g.record`다. 실패는 던진다(X 오류) */
export interface LearningWriter {
  event(event: LearningEvent): Promise<void>;
  record(draft: RecordDraft): Promise<void>;
}

export interface QueueOpsDeps {
  readonly reader: LearningQueueReader;
  readonly writer: LearningWriter;
  readonly clock: Clock;
  /** 설정 읽기. 실패는 fail-closed(§4.1) */
  readonly settings: () => Result<
    LearningSettings,
    { readonly kind: "learning.settingsUnavailable" }
  >;
  /** 지식 저장소 면. 없으면 `learning.knowledgeUnavailable` */
  readonly knowledge: () => Result<KnowledgePort, KnowledgeFailure>;
}

export interface QueueOps {
  list(filter: ProposalFilter): Promise<Result<readonly ProposalView[], LearningError>>;
  decide(decision: ProposalDecision, signal: AbortSignal): Promise<DecisionResult>;
  /** 방금 만든 후보를 대기열에 올린다(`proposal.created`와 알림 레코드). 승인 불요 정책이면 바로 승인하고 적용한다 */
  enqueue(proposal: Proposal, policyApproved: boolean, signal: AbortSignal): Promise<Proposal>;
  /** 명령 진입 지연 정리(§4.5 규칙 7): 만료와 승인된 미적용 재적용 */
  sweep(signal: AbortSignal): Promise<Result<QueueSweep, LearningError>>;
}

function applyKey(proposal: Pick<Proposal, "id" | "revision">): string {
  return `learning:apply:${proposal.id}:${String(proposal.revision)}`;
}

function revertKey(proposal: Pick<Proposal, "id">): string {
  return `learning:revert:${proposal.id}`;
}

export function createQueueOps(deps: QueueOpsDeps): QueueOps {
  const { reader, writer, clock } = deps;

  async function get(id: string): Promise<Result<Proposal, LearningError>> {
    const found = await reader.getProposal(id);
    if (!found.ok) return found;
    if (found.value === undefined) return err({ kind: "learning.notFound", proposalId: id });
    return ok(found.value);
  }

  async function announce(
    next: Proposal,
    decision: "approved" | "rejected" | "applied",
  ): Promise<void> {
    const draft = skillDecisionRecordOf(next, decision);
    if (draft !== undefined) await writer.record(draft);
  }

  /** 승인된 행을 L2 쓰기 API로 적용하고 결과를 기록한다 */
  async function applyRow(
    proposal: Proposal,
    signal: AbortSignal,
  ): Promise<
    Result<{ readonly proposal: Proposal; readonly transition: ApplyTransition }, LearningError>
  > {
    const knowledge = deps.knowledge();
    if (!knowledge.ok) return knowledge;
    const applied = await knowledge.value.apply(proposal, {
      signal,
      idempotencyKey: applyKey(proposal),
      decidedAt: proposal.updatedAt,
    });
    const outcome = applyOutcome(applied);
    const at = clock.now();
    const next = transition(proposal, { kind: "apply", transition: outcome }, at);
    if (!next.ok) return next;
    switch (outcome.kind) {
      case "applied":
        await writer.event({
          kind: "proposal.applied",
          id: proposal.id,
          ledgerId: outcome.ledgerId,
          afterHash: outcome.afterHash,
          at,
        });
        await announce(next.value, "applied");
        break;
      case "rejected":
        await writer.event({
          kind: "proposal.apply_failed",
          id: proposal.id,
          reason: outcome.reason,
          nextStatus: "rejected",
          at,
        });
        break;
      case "backToPending":
        await writer.event({
          kind: "proposal.apply_failed",
          id: proposal.id,
          reason: "base_stale",
          nextStatus: "pending",
          at,
        });
        break;
      case "retry":
        // approved 유지: 기록하지 않는다. 다음 명령 진입의 정리가 같은 키로 다시 적용한다
        break;
      default:
        return assertNever(outcome, "ApplyTransition");
    }
    return ok({ proposal: next.value, transition: outcome });
  }

  async function approve(
    row: Proposal,
    decision: Extract<ProposalDecision, { kind: "approve" }>,
    signal: AbortSignal,
  ): Promise<DecisionResult> {
    const settings = deps.settings();
    if (!settings.ok) return { ok: false, error: settings.error };
    const knowledge = deps.knowledge();
    if (!knowledge.ok) return { ok: false, error: knowledge.error };
    const at = clock.now();
    const approved = transition(
      row,
      { kind: "approve", revision: decision.revision, scope: decision.scope },
      at,
    );
    if (!approved.ok) return { ok: false, error: approved.error };
    await writer.event({
      kind: "proposal.decided",
      id: row.id,
      revision: row.revision,
      status: "approved",
      reason: null,
      scope: approved.value.scope,
      at,
    });
    await announce(approved.value, "approved");
    const applied = await applyRow(approved.value, signal);
    if (!applied.ok) return { ok: false, error: applied.error };
    return {
      ok: true,
      proposal: proposalView(applied.value.proposal),
      applied: applied.value.proposal.status === "applied",
    };
  }

  async function edit(
    row: Proposal,
    decision: Extract<ProposalDecision, { kind: "edit" }>,
    signal: AbortSignal,
  ): Promise<DecisionResult> {
    const settings = deps.settings();
    if (!settings.ok) return { ok: false, error: settings.error };
    const at = clock.now();
    const bodyHash = sha256Hex(decision.body);
    const edited = transition(
      row,
      {
        kind: "edit",
        revision: decision.revision,
        body: decision.body,
        bodyHash,
        diff: renderDiff(row.op, row.target, decision.body),
      },
      at,
    );
    if (!edited.ok) return { ok: false, error: edited.error };
    // 수정한 본문도 다시 사전 스캔한다(§4.5 표). 스캔을 쓸 수 없으면 수정을 받지 않는다
    const knowledge = deps.knowledge();
    if (!knowledge.ok && settings.value.scanEnabled) return { ok: false, error: knowledge.error };
    const scanned = knowledge.ok
      ? await preScan(
          {
            kind: row.kind,
            op: row.op,
            target: row.target,
            body: decision.body,
            baseHash: row.baseHash,
          },
          knowledge.value,
          settings.value.scanEnabled,
          { signal },
        )
      : ok({ kind: "clean" } as const);
    if (!scanned.ok) return { ok: false, error: scanned.error };
    if (scanned.value.kind === "refused") {
      return {
        ok: false,
        error: { kind: "learning.invalidBody", proposalId: row.id, detail: scanned.value.detail },
      };
    }
    if (scanned.value.kind === "blocked") {
      // 막힌 본문은 기록하지 않는다. 수정 전 행이 거절로 닫힌다
      const blocked = transition(row, { kind: "scanBlocked" }, at);
      if (!blocked.ok) return { ok: false, error: blocked.error };
      await writer.event({
        kind: "proposal.decided",
        id: row.id,
        revision: row.revision,
        status: "rejected",
        reason: "scan_failed",
        scope: row.scope,
        at,
      });
      await announce(blocked.value, "rejected");
      return {
        ok: true,
        proposal: proposalView({ ...blocked.value, findings: [...scanned.value.rules] }),
        applied: false,
      };
    }
    await writer.event({
      kind: "proposal.edited",
      id: row.id,
      revision: edited.value.revision,
      body: decision.body,
      bodyHash,
      at,
    });
    return { ok: true, proposal: proposalView(edited.value), applied: false };
  }

  async function revert(row: Proposal, signal: AbortSignal): Promise<DecisionResult> {
    if (row.status !== "applied" || row.ledgerId === null) {
      return {
        ok: false,
        error: { kind: "learning.closed", proposalId: row.id, status: row.status },
      };
    }
    const knowledge = deps.knowledge();
    if (!knowledge.ok) return { ok: false, error: knowledge.error };
    const rolled = await knowledge.value.rollback(row.ledgerId, {
      signal,
      idempotencyKey: revertKey(row),
    });
    const at = clock.now();
    const event: ProposalEvent = rolled.ok ? { kind: "revertDone" } : { kind: "revertRefused" };
    const next = transition(row, event, at);
    if (!next.ok) return { ok: false, error: next.error };
    await writer.event(
      rolled.ok
        ? { kind: "proposal.reverted", id: row.id, ledgerId: row.ledgerId, at }
        : {
            kind: "proposal.apply_failed",
            id: row.id,
            reason: "rollback_refused",
            nextStatus: "applied",
            at,
          },
    );
    return {
      ok: true,
      proposal: proposalView(next.value),
      applied: next.value.status === "applied",
    };
  }

  return {
    async list(filter) {
      const rows = await reader.listProposals(filter);
      return rows.ok ? ok(rows.value.map(proposalView)) : rows;
    },
    async decide(decision, signal) {
      const row = await get(decision.proposalId);
      if (!row.ok) return { ok: false, error: row.error };
      switch (decision.kind) {
        case "approve":
          return approve(row.value, decision, signal);
        case "edit":
          return edit(row.value, decision, signal);
        case "revert":
          return revert(row.value, signal);
        case "reject": {
          const at = clock.now();
          const next = transition(row.value, { kind: "reject" }, at);
          if (!next.ok) return { ok: false, error: next.error };
          await writer.event({
            kind: "proposal.decided",
            id: row.value.id,
            revision: row.value.revision,
            status: "rejected",
            reason: "user_rejected",
            scope: row.value.scope,
            at,
          });
          await announce(next.value, "rejected");
          return { ok: true, proposal: proposalView(next.value), applied: false };
        }
        default:
          return assertNever(decision, "ProposalDecision");
      }
    },
    async enqueue(proposal, policyApproved, signal) {
      await writer.event({ kind: "proposal.created", proposal });
      if (proposal.status === "pending" || proposal.status === "approved") {
        const created = proposedRecordOf(proposal);
        if (created !== undefined) await writer.record(created);
      } else {
        await announce(proposal, "rejected");
      }
      if (!policyApproved) return proposal;
      // 승인 불요 정책(§4.1 끝): 스캔을 통과한 비파괴 연산은 바로 적용 단계로 간다
      const at = clock.now();
      const approved = transition(
        proposal,
        { kind: "approve", revision: proposal.revision, scope: undefined },
        at,
      );
      if (!approved.ok) return proposal;
      await writer.event({
        kind: "proposal.decided",
        id: proposal.id,
        revision: proposal.revision,
        status: "approved",
        reason: null,
        scope: approved.value.scope,
        at,
      });
      await announce(approved.value, "approved");
      const applied = await applyRow(approved.value, signal);
      return applied.ok ? applied.value.proposal : approved.value;
    },
    async sweep(signal) {
      const settings = deps.settings();
      if (!settings.ok) return err(settings.error);
      const pending = await reader.listProposals({ statuses: ["pending"] });
      if (!pending.ok) return pending;
      const now = clock.now();
      const expired: string[] = [];
      await eachAsync(pending.value, async (row) => {
        if (!isExpired(row, now, settings.value.expiryDays)) return undefined;
        await writer.event({ kind: "proposal.expired", id: row.id, at: now });
        expired.push(row.id);
        return undefined;
      });
      const approved = await reader.listProposals({ statuses: ["approved"] });
      if (!approved.ok) return approved;
      const retried: { id: string; transition: ApplyTransition }[] = [];
      const failure = await eachAsync(approved.value, async (row) => {
        const applied = await applyRow(row, signal);
        if (!applied.ok) return { value: applied.error };
        retried.push({ id: row.id, transition: applied.value.transition });
        return undefined;
      });
      if (failure !== undefined) return err(failure.value);
      return ok({ expired, retried });
    },
  };
}
