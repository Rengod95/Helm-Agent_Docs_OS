import { eachAsync, err, ok, type Result } from "@xeon/contracts";
import type { WriteOutcome } from "@xeon/contracts/capabilities";
import { fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { updateIndexAfterChange } from "../skills/index-update.ts";
import type { LedgerDeps } from "./change.ts";
import {
  markAborted,
  markApplied,
  preparedRecords,
  setRolledBackBy,
  type LedgerRecord,
} from "./rows.ts";
import { hashOfTarget, readTarget, type ChangeTarget } from "./target.ts";

// L2.knowledge.spec §4.4.3 시작 시 복구. prepared로 남은 행을 대상의 현재 해시로 판정한다:
// after_hash와 같으면 applied, 그 밖에는 aborted(before_hash와 같으면 쓰기 전에 죽은 것이고, 둘 다 아니면 바깥 편집이라
// 이어지는 재색인이 external 항목으로 남긴다).

export interface RecoverReport {
  readonly applied: number;
  readonly aborted: number;
}

async function recoverOne(
  deps: LedgerDeps,
  record: LedgerRecord,
): Promise<Result<"applied" | "aborted", KnowledgeFailure>> {
  const { entry } = record;
  const target: ChangeTarget = {
    kind: entry.target.kind,
    name: entry.target.name,
    ...(entry.target.scope === undefined ? {} : { scope: entry.target.scope }),
    path: record.targetPath,
  };
  const current = await readTarget(deps.fs, target);
  if (!current.ok) return current;
  const hash = hashOfTarget(target.kind, current.value);
  const now = deps.clock.now();
  const finished = deps.db.write((tx): "applied" | "aborted" => {
    if (hash !== entry.afterHash) {
      markAborted(tx, entry.ledgerId);
      return "aborted";
    }
    const indexChanged = updateIndexAfterChange(tx, {
      target,
      op: entry.op,
      actor: entry.actor,
      next: current.value,
      afterHash: entry.afterHash,
      now,
      docsFts: deps.docsFts === true,
    });
    const outcome: WriteOutcome = {
      status: "applied",
      ledgerId: entry.ledgerId,
      ...(entry.afterHash === null ? {} : { afterHash: entry.afterHash }),
      ...(entry.approvedBy === undefined ? {} : { approvedBy: entry.approvedBy }),
      scan: entry.scan,
      indexChanged,
    };
    markApplied(tx, entry.ledgerId, outcome, indexChanged);
    if (entry.rollbackOf !== undefined) setRolledBackBy(tx, entry.rollbackOf, entry.ledgerId);
    return "applied";
  });
  return finished.ok ? ok(finished.value) : err(fromStoreError(finished.error, "ledger recover"));
}

export async function recoverPrepared(
  deps: LedgerDeps,
): Promise<Result<RecoverReport, KnowledgeFailure>> {
  const listed = deps.db.read((tx) => preparedRecords(tx));
  if (!listed.ok) return err(fromStoreError(listed.error, "ledger recover"));
  if (!listed.value.ok) return listed.value;
  let applied = 0;
  let aborted = 0;
  const stopped = await eachAsync(listed.value.value, async (record) => {
    const result = await recoverOne(deps, record);
    if (!result.ok) return { value: result.error };
    if (result.value === "applied") applied += 1;
    else aborted += 1;
    return undefined;
  });
  return stopped === undefined ? ok({ applied, aborted }) : err(stopped.value);
}
