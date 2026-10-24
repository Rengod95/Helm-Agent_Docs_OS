import { err, ok, type Result } from "@xeon/contracts";
import type { WriteOutcome } from "@xeon/contracts/capabilities";
import type { BlobRef } from "@xeon/contracts/records";
import { fromStoreError, type KnowledgeFailure } from "../errors.ts";
import { SCAN_RULESET_VERSION } from "../scan/rules.ts";
import { updateDocsAfterChange } from "../search/docs-index.ts";
import { upsertFileState } from "../skills/store.ts";
import { treeBytes, type Tree } from "../skills/tree.ts";
import type { LedgerDeps } from "./change.ts";
import { putTree } from "./manifest.ts";
import { insertRecord, manifestForHash } from "./rows.ts";
import { hashOfTarget, type ChangeTarget } from "./target.ts";

// L2.knowledge.spec §4.3.5 바깥 편집. 이 능력 밖에서 파일이 바뀐 것을 원장에 `external` 항목으로 남기고 파일 상태를 새 내용으로
// 맞춘다. 행위자는 `external`이다. 스킬 재색인(`skills/reindex.ts`)은 같은 항목을 자기 트랜잭션 안에서 직접 만든다.

export interface ExternalChange {
  readonly target: ChangeTarget;
  /** 이 능력이 마지막으로 확인한 해시. 처음 보는 파일이면 null */
  readonly previousHash: string | null;
  /** 지금 내용. 파일이 없어졌으면 null */
  readonly current: Tree | null;
}

/** 바깥 편집 하나를 기록한다. 새 내용을 먼저 blob으로 저장하고(트랜잭션 밖) 항목과 파일 상태를 한 트랜잭션에 쓴다 */
export function recordExternalChange(
  deps: LedgerDeps,
  change: ExternalChange,
): Result<void, KnowledgeFailure> {
  const { target, previousHash, current } = change;
  let afterManifest: BlobRef | null = null;
  if (current !== null) {
    const stored = putTree(deps.blobs, current);
    // 새 내용을 보관하지 못하면 되돌림 기준이 없다. 기록은 하되 목록 없이 남긴다
    if (stored.ok) afterManifest = stored.value;
    else {
      deps.logger.warn("knowledge.external.capture_failed", {
        target: target.name,
        cause: stored.error.message,
      });
    }
  }
  const afterHash = hashOfTarget(target.kind, current);
  const now = deps.clock.now();
  const ledgerId = deps.ids.next("knl");
  const written = deps.db.write((tx) => {
    const scan = { rulesetVersion: SCAN_RULESET_VERSION, findings: [] };
    const outcome: WriteOutcome = {
      status: "applied",
      ledgerId,
      ...(afterHash === null ? {} : { afterHash }),
      scan,
      indexChanged: false,
    };
    insertRecord(tx, {
      ledgerId,
      at: now,
      actor: { kind: "external" },
      target,
      op: "external",
      beforeHash: previousHash,
      afterHash,
      beforeManifest:
        previousHash === null
          ? null
          : manifestForHash(tx, target.kind, target.name, target.scope, previousHash),
      afterManifest,
      requestId: undefined,
      approvedBy: undefined,
      evidence: undefined,
      scan,
      reason: undefined,
      proposalId: undefined,
      rollbackOf: undefined,
      status: "applied",
      indexChanged: false,
      outcome,
    });
    if (deps.docsFts === true) {
      updateDocsAfterChange(tx, {
        kind: target.kind,
        name: target.name,
        scope: target.scope,
        next: current,
      });
    }
    if (current === null || afterHash === null) {
      tx.run("DELETE FROM cap_knowledge_files WHERE path = ?", [target.path]);
    } else {
      upsertFileState(tx, {
        path: target.path,
        kind: target.kind,
        target: target.name,
        scope: target.scope ?? "",
        hash: afterHash,
        size: treeBytes(current),
        mtimeMs: now,
        checkedAt: now,
      });
    }
  });
  return written.ok ? ok(undefined) : err(fromStoreError(written.error, "external change"));
}
