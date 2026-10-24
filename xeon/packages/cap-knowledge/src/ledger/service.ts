import { err, ok, type Result } from "@xeon/contracts";
import type {
  CallOptions,
  DecideInput,
  DecideOutput,
  LedgerIdRef,
  LedgerListInput,
  LedgerListOutput,
  LedgerRollbackInput,
  LedgerScanInput,
  LedgerShowOutput,
  ProposalsInput,
  ProposalsOutput,
  ScanSummary,
  WriteOutcome,
} from "@xeon/contracts/capabilities";
import { actorOf } from "../actor.ts";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { scanText } from "../scan/rules.ts";
import type { ChangeExecutor, LedgerDeps } from "./change.ts";
import { rollbackEntry } from "./rollback.ts";
import { findById, listRecords } from "./rows.ts";
import { showEntry } from "./show.ts";

// knowledge.ledger 서비스. proposals·decide(제안 대기열)는 KN.2(K6)가 채운다.

export interface LedgerRuntime {
  list(input: LedgerListInput): Result<LedgerListOutput, KnowledgeFailure>;
  show(input: LedgerIdRef): Result<LedgerShowOutput, KnowledgeFailure>;
  rollback(
    input: LedgerRollbackInput,
    options?: CallOptions,
  ): Promise<Result<WriteOutcome, KnowledgeFailure>>;
  scan(input: LedgerScanInput): ScanSummary;
  proposals(input: ProposalsInput): ProposalsOutput;
  decide(input: DecideInput): Result<DecideOutput, KnowledgeFailure>;
}

export interface LedgerServiceDeps extends LedgerDeps {
  readonly executor: ChangeExecutor;
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

  const rollback: LedgerRuntime["rollback"] = async (input, options) => {
    const actor = actorOf(options?.context);
    if (!actor.ok) return actor;
    // 롤백은 파괴적 연산이라 승인 게이트(spec §4.5.1)를 거친다. 게이트와 제안 대기열은 KN.2다.
    // 그 전에는 닫힌 실패로 사용자(host 호출자)만 허용한다.
    if (actor.value.kind !== "user") {
      return err(
        failure(
          "denied",
          "only the user can roll back a change until the approval gate is available",
        ),
      );
    }
    return rollbackEntry(deps, deps.executor, {
      ledgerId: input.ledgerId,
      reason: input.reason,
      requestId: options?.requestId,
      actor: actor.value,
    });
  };

  return {
    list,
    show: (input) => showEntry(deps, input.ledgerId),
    rollback,
    scan: (input) => scanText(input.kind, input.text, { containsKnown: deps.containsKnown }),
    proposals: () => ({ proposals: [] }),
    decide: () =>
      err(failure("unsupported", "the proposal queue is not available yet (L2.knowledge.plan K6)")),
  };
}
