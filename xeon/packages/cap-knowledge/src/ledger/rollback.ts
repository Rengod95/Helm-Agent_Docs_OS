import { err, ok, type Result } from "@xeon/contracts";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { SCAN_RULESET_VERSION } from "../scan/rules.ts";
import type { Tree } from "../skills/tree.ts";
import type { WritePlan } from "../write/pipeline.ts";
import type { LedgerDeps } from "./change.ts";
import { readTree } from "./manifest.ts";
import { findById } from "./rows.ts";
import { hashOfTarget, readTarget, type ChangeTarget } from "./target.ts";

// L2.knowledge.spec §4.7.2 롤백. 되돌릴 내용을 계산해 `WritePlan`으로 돌려준다. 롤백은 파괴적 연산이라 쓰기 승인 게이트
// (3단계)와 안전 캡처 이후 단계는 쓰기 경로(`write/pipeline.ts`)가 맡는다.

export interface RollbackRequest {
  readonly ledgerId: string;
  readonly reason: string | undefined;
}

export async function planRollback(
  deps: LedgerDeps,
  request: RollbackRequest,
): Promise<Result<WritePlan, KnowledgeFailure>> {
  const found = deps.db.read((tx) => findById(tx, request.ledgerId));
  if (!found.ok) return err(fromStoreError(found.error, "ledger lookup"));
  if (!found.value.ok) return found.value;
  const record = found.value.value;
  if (record === undefined) {
    return err(failure("not_found", `ledger entry ${request.ledgerId} does not exist`));
  }
  const { entry } = record;
  if (record.status !== "applied") {
    return err(failure("invalid_input", "only an applied ledger entry can be rolled back"));
  }
  if (entry.rolledBackBy !== undefined) {
    return err(
      failure("invalid_input", "this ledger entry was already rolled back", {
        detail: { rolledBackBy: entry.rolledBackBy },
      }),
    );
  }

  const target: ChangeTarget = {
    kind: entry.target.kind,
    name: entry.target.name,
    ...(entry.target.scope === undefined ? {} : { scope: entry.target.scope }),
    path: record.targetPath,
  };
  // 2단계: 뒤에 다른 변경이 없어야 한다
  const current = await readTarget(deps.fs, target);
  if (!current.ok) return current;
  const currentHash = hashOfTarget(target.kind, current.value);
  if (currentHash !== entry.afterHash) {
    return err(
      failure(
        "rollback_conflict",
        "the target changed after this entry; roll back the later changes first",
        {
          detail: { expected: entry.afterHash, current: currentHash },
        },
      ),
    );
  }

  // 되돌릴 내용: 이전 내용이 없던 항목(생성)은 대상을 보관함으로 옮긴다
  let next: Tree | null = null;
  if (entry.beforeHash !== null) {
    if (record.beforeManifest === null) {
      return err(
        failure(
          "unsupported",
          "this entry did not keep the previous content, so it cannot be rolled back",
        ),
      );
    }
    const restored = readTree(deps.blobs, record.beforeManifest);
    if (!restored.ok) return restored;
    if (hashOfTarget(target.kind, restored.value) !== entry.beforeHash) {
      return err(failure("internal", "the stored previous content does not match its hash"));
    }
    next = restored.value;
  }

  return ok({
    method: "ledger.rollback",
    input: {
      ledgerId: request.ledgerId,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    },
    target,
    op: "rollback",
    destructive: true,
    baseHash: entry.afterHash,
    current: current.value,
    next,
    removal: "archive",
    scan: { rulesetVersion: SCAN_RULESET_VERSION, findings: [] },
    reason: request.reason,
    rollbackOf: entry.ledgerId,
    captureFailure: "rollback_unsafe",
  });
}
