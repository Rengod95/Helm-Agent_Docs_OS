import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type {
  ApprovalEvidence,
  CallContext,
  CapabilityId,
  KnowledgeActor,
  LedgerOp,
  ScanSummary,
  WriteOutcome,
} from "@xeon/contracts/capabilities";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import {
  decideGate,
  isEvidenceValid,
  type GateDecision,
  type WritingActor,
} from "../approval/gate.ts";
import {
  findProposalByRequestId,
  insertProposal,
  type ProposalMethod,
  type ProposalRecord,
} from "../approval/proposals.ts";
import { utf8Encode } from "../hash.ts";
import type { ChangeExecutor, ChangeSpec, LedgerDeps } from "../ledger/change.ts";
import { findByRequestId } from "../ledger/rows.ts";
import type { ChangeTarget } from "../ledger/target.ts";
import { approvalRequestKey, type WriteApprovals } from "../ports/approvals.ts";
import type { KnowledgeSettings } from "../settings.ts";
import type { Tree } from "../skills/tree.ts";
import { previewDiff } from "./preview.ts";

// L2.knowledge.spec §4.4.1 쓰기 경로의 6단계(쓰기 승인 게이트)와 그 앞의 멱등 확인. 새 내용을 이미 계산한 변경(`WritePlan`) 하나를
// 게이트에 걸어 바로 적용, 사람에게 승인 요청, 제안 대기열 중 하나로 보낸다. 적용은 원장 실행기(7~11단계)가 한다.

export interface WritePlan {
  /** 대기열이 저장하고 `decide`가 다시 실행하는 메서드 */
  readonly method: ProposalMethod;
  /** 그 메서드의 입력(`approval`, `overrideScan`을 뺀 것). 대기열 blob에 JSON으로 저장한다 */
  readonly input: unknown;
  readonly target: ChangeTarget;
  readonly op: LedgerOp;
  /** 파괴적 연산인가(spec §4.4.2) */
  readonly destructive: boolean;
  /** 지금 해시가 이 값이어야 한다. 대상이 없어야 하면 null, 검사하지 않으면 undefined */
  readonly baseHash: string | null | undefined;
  /** 계산할 때 읽은 현재 내용(승인 미리보기의 기준) */
  readonly current: Tree | null;
  /** 적용 뒤 내용. 대상을 없애면 null */
  readonly next: Tree | null;
  readonly removal: "archive" | "delete";
  readonly scan: ScanSummary;
  readonly reason: string | undefined;
  readonly rollbackOf: string | undefined;
  readonly captureFailure: ChangeSpec["captureFailure"];
}

export interface WriteRequest {
  readonly plan: WritePlan;
  readonly actor: KnowledgeActor;
  readonly context: CallContext | undefined;
  /** `CallOptions.requestId`. 같은 키의 두 번째 호출은 첫 결과를 돌려받는다 */
  readonly requestId: string | undefined;
  /** 호출 확장이 낸 증거(모양만 검사한 것). 유효성은 게이트가 판정한다 */
  readonly evidence: ApprovalEvidence | undefined;
  readonly signal: AbortSignal | undefined;
  /** 제안 결정으로 사람이 이미 승인했다. 게이트를 건너뛰고 원장에 제안 id를 남긴다 */
  readonly decided: { readonly proposalId: string } | undefined;
}

export interface Writer {
  /** 같은 `requestId`로 이미 처리한 쓰기가 있으면 그 첫 결과(2단계 멱등 확인). 계산 앞에서 부른다 */
  recall(requestId: string | undefined): Result<WriteOutcome | undefined, KnowledgeFailure>;
  run(request: WriteRequest): Promise<Result<WriteOutcome, KnowledgeFailure>>;
}

export interface WriterDeps extends LedgerDeps {
  readonly executor: ChangeExecutor;
  readonly settings: (threadId: string | undefined) => KnowledgeSettings;
  /** 사람에게 쓰기 승인을 묻는 포트. 없으면 묻는 대신 대기열로 보낸다 */
  readonly approvals: WriteApprovals | undefined;
}

interface ToolIdentity {
  readonly name: string;
  readonly capability: CapabilityId;
  readonly method: string;
}

function toolOf(method: ProposalMethod): ToolIdentity {
  switch (method) {
    case "skills.create":
    case "skills.edit":
    case "skills.patch":
    case "skills.writeFile":
    case "skills.remove":
      return { name: "skill_manage", capability: "knowledge.skills", method: method.slice(7) };
    case "memory.add":
    case "memory.replace":
    case "memory.remove":
    case "memory.manage":
      return { name: "memory_manage", capability: "knowledge.memory", method: method.slice(7) };
    case "ledger.rollback":
      return { name: "knowledge.ledger", capability: "knowledge.ledger", method: "rollback" };
    default:
      return assertNever(method, "ProposalMethod");
  }
}

function queuedOutcome(record: ProposalRecord): WriteOutcome {
  return {
    status: "queued",
    proposalId: record.proposal.proposalId,
    scan: record.proposal.scan,
    indexChanged: false,
  };
}

function writingActorOf(actor: KnowledgeActor): WritingActor | undefined {
  switch (actor.kind) {
    case "user":
    case "agent":
    case "extension":
      return actor;
    case "external":
    case "system":
      return undefined;
    default:
      return assertNever(actor, "KnowledgeActor");
  }
}

export function createWriter(deps: WriterDeps): Writer {
  const { db, blobs, clock, ids, executor } = deps;

  function recall(
    requestId: string | undefined,
  ): Result<WriteOutcome | undefined, KnowledgeFailure> {
    if (requestId === undefined) return ok(undefined);
    const ledger = db.read((tx) => findByRequestId(tx, requestId));
    if (!ledger.ok) return err(fromStoreError(ledger.error, "ledger lookup"));
    if (!ledger.value.ok) return ledger.value;
    const applied = ledger.value.value;
    if (applied !== undefined) {
      if (applied.outcome !== null && applied.status === "applied") return ok(applied.outcome);
      return err(
        failure("unavailable", "a request with the same requestId is still being applied", {
          detail: { ledgerId: applied.entry.ledgerId },
        }),
      );
    }
    const queued = db.read((tx) => findProposalByRequestId(tx, requestId));
    if (!queued.ok) return err(fromStoreError(queued.error, "proposal lookup"));
    if (!queued.value.ok) return queued.value;
    return ok(queued.value.value === undefined ? undefined : queuedOutcome(queued.value.value));
  }

  function enqueue(request: WriteRequest): Result<WriteOutcome, KnowledgeFailure> {
    const { plan, actor, requestId } = request;
    const stored = blobs.putBlob(utf8Encode(JSON.stringify(plan.input)), "application/json");
    if (!stored.ok) {
      return err(
        failure("internal", `the proposal input could not be stored: ${stored.error.kind}`, {
          cause: stored.error,
        }),
      );
    }
    const proposalId = ids.next("knp");
    const written = db.write((tx): Result<WriteOutcome, KnowledgeFailure> => {
      if (requestId !== undefined) {
        const duplicate = findProposalByRequestId(tx, requestId);
        if (!duplicate.ok) return duplicate;
        if (duplicate.value !== undefined) return ok(queuedOutcome(duplicate.value));
      }
      insertProposal(tx, {
        proposalId,
        createdAt: clock.now(),
        actor,
        method: plan.method,
        input: stored.value,
        target: {
          kind: plan.target.kind,
          name: plan.target.name,
          ...(plan.target.scope === undefined ? {} : { scope: plan.target.scope }),
        },
        op: plan.op,
        baseHash: plan.baseHash ?? null,
        scan: plan.scan,
        preview: previewDiff(plan.current, plan.next),
        requestId,
      });
      return ok({ status: "queued", proposalId, scan: plan.scan, indexChanged: false });
    });
    if (!written.ok) return err(fromStoreError(written.error, "proposal enqueue"));
    return written.value;
  }

  async function applyNow(
    request: WriteRequest,
    approvedBy: Extract<GateDecision, { action: "apply" }>["approvedBy"],
  ): Promise<Result<WriteOutcome, KnowledgeFailure>> {
    const { plan } = request;
    return executor.apply({
      actor: request.actor,
      target: plan.target,
      op: plan.op,
      requestId:
        request.decided === undefined
          ? request.requestId
          : `proposal:${request.decided.proposalId}`,
      baseHash: plan.baseHash,
      next: plan.next,
      removal: plan.removal,
      scan: plan.scan,
      approvedBy,
      evidence: approvedBy === "evidence" ? request.evidence : undefined,
      reason: plan.reason,
      proposalId: request.decided?.proposalId,
      rollbackOf: plan.rollbackOf,
      captureFailure: plan.captureFailure,
    });
  }

  async function ask(request: WriteRequest): Promise<Result<WriteOutcome, KnowledgeFailure>> {
    const { plan, context, requestId } = request;
    const approvals = deps.approvals;
    const threadId = context?.threadId;
    if (approvals === undefined || context === undefined || threadId === undefined) {
      return enqueue(request);
    }
    const tool = toolOf(plan.method);
    const asked = await approvals.ask(
      {
        threadId,
        context,
        requestKey: requestId === undefined ? ids.next("knp") : approvalRequestKey(requestId),
        toolName: tool.name,
        capability: { id: tool.capability, method: tool.method },
        op: plan.op,
        target: {
          kind: plan.target.kind,
          name: plan.target.name,
          ...(plan.target.scope === undefined ? {} : { scope: plan.target.scope }),
        },
        baseHash: plan.baseHash ?? null,
        preview: previewDiff(plan.current, plan.next),
        scan: plan.scan,
        afterUntrusted: context.caller.afterUntrusted === true,
      },
      request.signal ?? new AbortController().signal,
    );
    if (!asked.ok) return asked;
    if (asked.value.kind === "deny") {
      const { feedback } = asked.value;
      const declined = "the user declined this change";
      return err(
        feedback === undefined
          ? failure("approval_denied", declined)
          : failure("approval_denied", declined, { detail: { feedback } }),
      );
    }
    return applyNow(request, "approval");
  }

  async function run(request: WriteRequest): Promise<Result<WriteOutcome, KnowledgeFailure>> {
    // 제안 결정: 사람이 이미 승인했다. 같은 결정을 두 번 실행해도 원장 `request_id`가 막는다
    if (request.decided !== undefined) return applyNow(request, "approval");

    const known = recall(request.requestId);
    if (!known.ok) return known;
    if (known.value !== undefined) return ok(known.value);
    const actor = writingActorOf(request.actor);
    if (actor === undefined) {
      return err(failure("internal", `${request.actor.kind} cannot write through the gate`));
    }
    const threadId = request.context?.threadId;
    const write = deps.settings(threadId).write;
    const decision = decideGate({
      actor,
      hasSession: threadId !== undefined,
      destructive: request.plan.destructive,
      approvalRequired: write.approval,
      evidenceValid: isEvidenceValid(request.evidence, actor, write.trustedEvidenceSources),
      afterUntrusted: request.context?.caller.afterUntrusted === true,
    });
    switch (decision.action) {
      case "apply":
        return applyNow(request, decision.approvedBy);
      case "ask":
        // 사람이 없는 실행(크론, 헤드리스)에서는 물을 수 없다. 묻지 못하면 대기열로 보낸다(닫힌 쪽)
        return request.context?.interactive === false ? enqueue(request) : ask(request);
      case "queue":
        return enqueue(request);
      default:
        return assertNever(decision, "GateDecision");
    }
  }

  return { recall, run };
}
