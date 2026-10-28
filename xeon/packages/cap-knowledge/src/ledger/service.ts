import { err, ok, parse, type Result } from "@xeon/contracts";
import {
  LedgerRollbackInputSchema,
  type CallContext,
  type CallOptions,
  type DecideInput,
  type DecideOutput,
  type KnowledgeActor,
  type LedgerIdRef,
  type LedgerListInput,
  type LedgerListOutput,
  type LedgerRollbackInput,
  type LedgerScanInput,
  type LedgerShowOutput,
  type ProposalsInput,
  type ProposalsOutput,
  type ScanSummary,
  type WriteOutcome,
} from "@xeon/contracts/capabilities";
import { actorOf } from "../actor.ts";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { ProposalQueue, Replayer } from "../approval/queue.ts";
import { scanText } from "../scan/rules.ts";
import type { Writer } from "../write/pipeline.ts";
import type { LedgerDeps } from "./change.ts";
import { planRollback } from "./rollback.ts";
import { findById, listRecords } from "./rows.ts";
import { showEntry } from "./show.ts";

// knowledge.ledger 서비스: 원장 조회, 롤백(쓰기 승인 게이트를 거친다), 위협 검사, 제안 대기열(proposals, decide).

export interface LedgerRuntime {
  list(input: LedgerListInput): Result<LedgerListOutput, KnowledgeFailure>;
  show(input: LedgerIdRef): Result<LedgerShowOutput, KnowledgeFailure>;
  rollback(
    input: LedgerRollbackInput,
    options?: CallOptions,
  ): Promise<Result<WriteOutcome, KnowledgeFailure>>;
  scan(input: LedgerScanInput): ScanSummary;
  proposals(input: ProposalsInput): Result<ProposalsOutput, KnowledgeFailure>;
  decide(
    input: DecideInput,
    options?: CallOptions,
  ): Promise<Result<DecideOutput, KnowledgeFailure>>;
  /** 제안 대기열이 승인된 롤백 제안을 다시 실행하는 함수 */
  readonly replayRollback: Replayer;
}

export interface LedgerServiceDeps extends LedgerDeps {
  readonly writer: Writer;
  readonly queue: ProposalQueue;
  /** `xeon.secrets` 마스킹 등록부 판정(값을 노출하지 않는다). 서비스가 없으면 undefined */
  readonly containsKnown: ((text: string) => boolean) | undefined;
}

export function createLedgerRuntime(deps: LedgerServiceDeps): LedgerRuntime {
  const list: LedgerRuntime["list"] = (input) => {
    let beforeSeq: number | undefined;
    if (input.before !== undefined) {
      const before = input.before;
      const anchor = deps.db.read((tx) => findById(tx, before));
      if (!anchor.ok) return err(fromStoreError(anchor.error, "ledger lookup"));
      if (!anchor.value.ok) return anchor.value;
      if (anchor.value.value === undefined) {
        return err(failure("not_found", `ledger entry ${before} does not exist`));
      }
      beforeSeq = anchor.value.value.seq;
    }
    const read = deps.db.read((tx) =>
      listRecords(tx, {
        ...(input.target === undefined
          ? {}
          : {
              kind: input.target.kind,
              name: input.target.name,
              ...(input.target.scope === undefined ? {} : { scope: input.target.scope }),
            }),
        ...(input.actorKind === undefined ? {} : { actorKind: input.actorKind }),
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        limit: input.limit ?? 50,
      }),
    );
    if (!read.ok) return err(fromStoreError(read.error, "ledger list"));
    if (!read.value.ok) return read.value;
    return ok({ entries: read.value.value.map((record) => record.entry) });
  };

  /** 롤백 하나를 계산해 쓰기 경로에 태운다. 승인한 제안(`decided`)이면 게이트를 건너뛴다 */
  const rollbackWith = async (
    input: LedgerRollbackInput,
    request: {
      readonly actor: KnowledgeActor;
      readonly context: CallContext | undefined;
      readonly requestId: string | undefined;
      readonly signal: AbortSignal | undefined;
      readonly decided: { readonly proposalId: string } | undefined;
    },
  ): Promise<Result<WriteOutcome, KnowledgeFailure>> => {
    const known = deps.writer.recall(request.requestId);
    if (!known.ok) return known;
    if (known.value !== undefined) return ok(known.value);
    const plan = await planRollback(deps, { ledgerId: input.ledgerId, reason: input.reason });
    if (!plan.ok) return plan;
    return deps.writer.run({
      plan: plan.value,
      actor: request.actor,
      context: request.context,
      requestId: request.requestId,
      evidence: undefined,
      signal: request.signal,
      decided: request.decided,
    });
  };

  const rollback: LedgerRuntime["rollback"] = async (input, options) => {
    const actor = actorOf(options?.context);
    if (!actor.ok) return actor;
    return rollbackWith(input, {
      actor: actor.value,
      context: options?.context,
      requestId: options?.requestId,
      signal: options?.signal,
      decided: undefined,
    });
  };

  const replayRollback: Replayer = (call) => {
    const parsed = parse(LedgerRollbackInputSchema, call.input);
    if (!parsed.ok)
      return Promise.resolve(err(failure("internal", "the stored rollback input is malformed")));
    return rollbackWith(
      { ...parsed.value, ...(call.note === undefined ? {} : { reason: call.note }) },
      {
        actor: call.actor,
        context: undefined,
        requestId: undefined,
        signal: call.signal,
        decided: { proposalId: call.proposalId },
      },
    );
  };

  return {
    list,
    show: (input) => showEntry(deps, input.ledgerId),
    rollback,
    scan: (input) => scanText(input.kind, input.text, { containsKnown: deps.containsKnown }),
    proposals: (input) => deps.queue.proposals(input),
    decide: (input, options) => deps.queue.decide(input, options),
    replayRollback,
  };
}
