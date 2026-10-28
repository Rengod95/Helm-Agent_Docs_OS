import { err, ok, type Clock, type Logger, type Result } from "@xeon/contracts";
import type {
  ApprovalEvidence,
  ApprovedBy,
  KnowledgeActor,
  LedgerOp,
  ScanSummary,
  WriteOutcome,
} from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type { BlobRef, StoreDb } from "@xeon/contracts/records";
import {
  failure,
  fromStoreError,
  type KnowledgeFailure,
  type KnowledgeFailureKind,
} from "../errors.ts";
import type { KnowledgeFs } from "../fs/port.ts";
import { updateIndexAfterChange } from "../skills/index-update.ts";
import type { Tree } from "../skills/tree.ts";
import { keyReused, type Idem } from "../write/idempotency.ts";
import { putTree, type BlobPort } from "./manifest.ts";
import {
  findByRequestId,
  insertRecord,
  markAborted,
  markApplied,
  setRolledBackBy,
  type LedgerRecord,
  type NewLedgerRecord,
} from "./rows.ts";
import { applyTree, hashOfTarget, readTarget, type ChangeTarget } from "./target.ts";

// L2.knowledge.spec §4.4.1 쓰기 경로의 7~11단계. 새 내용(next)을 이미 계산한 변경 하나를 안전 캡처 → 의도 기록(prepared) →
// 락 안 재확인 → 파일 반영 → applied 기록 순서로 실행한다. 파일 I/O와 blob 쓰기는 트랜잭션 밖에서 한다(TX-01, TX-04).

export interface LedgerDeps {
  readonly fs: KnowledgeFs;
  /** `cap.knowledge` 소유자의 범위 핸들 */
  readonly db: StoreDb;
  readonly blobs: BlobPort;
  readonly clock: Clock;
  readonly ids: LocalIdFactory;
  readonly logger: Logger;
  /** 스킬·메모리 검색 색인(`cap_knowledge_docsfts`)이 있는가. 있으면 쓰기와 같은 트랜잭션에서 문서를 갱신한다(spec §4.4.1 10단계) */
  readonly docsFts?: boolean;
}

export interface ChangeSpec {
  readonly actor: KnowledgeActor;
  readonly target: ChangeTarget;
  readonly op: LedgerOp;
  readonly requestId: Idem | undefined;
  /** 지금 해시가 이 값이어야 한다. 대상이 없어야 하면 null, 검사하지 않으면 undefined */
  readonly baseHash: string | null | undefined;
  /** 적용 뒤 내용. 대상을 없애면 null */
  readonly next: Tree | null;
  /** next가 null일 때 스킬을 보관함으로 옮길지(archive) 지울지(delete) */
  readonly removal: "archive" | "delete";
  readonly scan: ScanSummary;
  readonly approvedBy: ApprovedBy | undefined;
  readonly evidence: ApprovalEvidence | undefined;
  readonly reason: string | undefined;
  readonly proposalId: string | undefined;
  /** 롤백이면 되돌리는 원래 항목의 id */
  readonly rollbackOf: string | undefined;
  /** 이 쓰기를 한 turn에 untrusted 도구 결과를 읽었다. 생략하면 거짓이다 */
  readonly afterUntrusted?: boolean;
  /** 안전 캡처가 실패했을 때의 오류 종류. 일반 쓰기는 internal, 롤백은 rollback_unsafe */
  readonly captureFailure: Extract<KnowledgeFailureKind, "internal" | "rollback_unsafe">;
}

export interface ChangeExecutor {
  apply(spec: ChangeSpec): Promise<Result<WriteOutcome, KnowledgeFailure>>;
}

type Inserted =
  | { readonly kind: "inserted" }
  | { readonly kind: "existing"; readonly record: LedgerRecord };

function existingOutcome(record: LedgerRecord): Result<WriteOutcome, KnowledgeFailure> {
  if (record.outcome !== null && record.status === "applied") return ok(record.outcome);
  return err(
    failure("unavailable", "a request with the same requestId is still being applied", {
      detail: { ledgerId: record.entry.ledgerId },
    }),
  );
}

export function createChangeExecutor(deps: LedgerDeps): ChangeExecutor {
  const { fs, db, blobs, clock, ids, logger } = deps;

  const capture = (
    tree: Tree | null,
    kind: ChangeSpec["captureFailure"],
    what: string,
  ): Result<BlobRef | null, KnowledgeFailure> => {
    if (tree === null) return ok(null);
    const stored = putTree(blobs, tree);
    if (stored.ok) return ok(stored.value);
    return err(
      failure(kind, `safe capture of ${what} failed: ${stored.error.message}`, {
        cause: stored.error,
      }),
    );
  };

  const abort = (ledgerId: string): void => {
    const marked = db.write((tx) => {
      markAborted(tx, ledgerId);
    });
    if (!marked.ok) {
      // 행이 prepared로 남는다. 시작 시 복구가 해시로 aborted를 판정한다
      logger.error("knowledge.ledger.abort_failed", { ledgerId, cause: marked.error.kind });
    }
  };

  async function apply(spec: ChangeSpec): Promise<Result<WriteOutcome, KnowledgeFailure>> {
    const { target } = spec;

    // 2단계 멱등
    if (spec.requestId !== undefined) {
      const idem = spec.requestId;
      const found = db.read((tx) => findByRequestId(tx, idem.key));
      if (!found.ok) return err(fromStoreError(found.error, "ledger lookup"));
      if (!found.value.ok) return found.value;
      const stored = found.value.value;
      if (stored !== undefined) {
        const reused = keyReused(stored.requestFingerprint, idem);
        return reused === undefined ? existingOutcome(stored) : err(reused);
      }
    }

    // 3단계 대상 읽기와 baseHash 비교
    const current = await readTarget(fs, target);
    if (!current.ok) return current;
    const beforeHash = hashOfTarget(target.kind, current.value);
    if (spec.baseHash !== undefined && spec.baseHash !== beforeHash) {
      return err(
        failure("base_stale", "the target changed since it was read; read it again", {
          detail: { currentHash: beforeHash },
        }),
      );
    }
    const afterHash = hashOfTarget(target.kind, spec.next);

    // 7단계 안전 캡처. 실패하면 아무것도 쓰지 않는다(닫힌 실패)
    const beforeManifest = capture(current.value, spec.captureFailure, "the current content");
    if (!beforeManifest.ok) return beforeManifest;
    const afterManifest = capture(spec.next, spec.captureFailure, "the new content");
    if (!afterManifest.ok) return afterManifest;

    // 8단계 의도 기록
    const ledgerId = ids.next("knl");
    const record: NewLedgerRecord = {
      ledgerId,
      at: clock.now(),
      actor: spec.actor,
      target,
      op: spec.op,
      beforeHash,
      afterHash,
      beforeManifest: beforeManifest.value,
      afterManifest: afterManifest.value,
      requestId: spec.requestId?.key,
      requestFingerprint: spec.requestId?.fingerprint,
      approvedBy: spec.approvedBy,
      evidence: spec.evidence,
      scan: spec.scan,
      reason: spec.reason,
      proposalId: spec.proposalId,
      rollbackOf: spec.rollbackOf,
      ...(spec.afterUntrusted === true ? { afterUntrusted: true } : {}),
      status: "prepared",
      indexChanged: false,
      outcome: undefined,
    };
    const inserted = db.write((tx): Result<Inserted, KnowledgeFailure> => {
      if (spec.requestId !== undefined) {
        const duplicate = findByRequestId(tx, spec.requestId.key);
        if (!duplicate.ok) return duplicate;
        if (duplicate.value !== undefined) {
          const reused = keyReused(duplicate.value.requestFingerprint, spec.requestId);
          return reused === undefined
            ? ok({ kind: "existing", record: duplicate.value })
            : err(reused);
        }
      }
      insertRecord(tx, record);
      return ok({ kind: "inserted" });
    });
    if (!inserted.ok) return err(fromStoreError(inserted.error, "ledger prepare"));
    if (!inserted.value.ok) return inserted.value;
    if (inserted.value.value.kind === "existing")
      return existingOutcome(inserted.value.value.record);

    // 9단계 락 안 재확인과 파일 반영
    const applied = await fs.withLock(
      target.path,
      async (): Promise<Result<void, KnowledgeFailure>> => {
        const locked = await readTarget(fs, target);
        if (!locked.ok) return locked;
        if (hashOfTarget(target.kind, locked.value) !== beforeHash) {
          return err(failure("base_stale", "the target changed while the write was waiting"));
        }
        const wrote = await applyTree(fs, target, locked.value, spec.next, spec.removal, clock);
        if (wrote.ok) return wrote;
        // 일부만 쓰였을 수 있다. 캡처해 둔 이전 내용으로 되돌려 본다
        const partial = await readTarget(fs, target);
        const restored = await applyTree(
          fs,
          target,
          partial.ok ? partial.value : null,
          locked.value,
          "delete",
          clock,
        );
        if (!restored.ok) {
          logger.error("knowledge.ledger.restore_failed", {
            ledgerId,
            target: target.path,
            cause: restored.error.message,
          });
        }
        return wrote;
      },
    );
    if (!applied.ok) {
      abort(ledgerId);
      return applied;
    }

    // 10단계 applied 기록과 색인 갱신(한 트랜잭션)
    const now = clock.now();
    const finished = db.write((tx): WriteOutcome => {
      const indexChanged = updateIndexAfterChange(tx, {
        target,
        op: spec.op,
        actor: spec.actor,
        next: spec.next,
        afterHash,
        now,
        docsFts: deps.docsFts === true,
      });
      const outcome: WriteOutcome = {
        status: "applied",
        ledgerId,
        ...(afterHash === null ? {} : { afterHash }),
        ...(spec.approvedBy === undefined ? {} : { approvedBy: spec.approvedBy }),
        scan: spec.scan,
        indexChanged,
      };
      markApplied(tx, ledgerId, outcome, indexChanged);
      if (spec.rollbackOf !== undefined) setRolledBackBy(tx, spec.rollbackOf, ledgerId);
      return outcome;
    });
    if (!finished.ok) {
      // 파일은 이미 바뀌었다. prepared 행이 남고 시작 시 복구가 해시로 applied를 판정한다
      return err(fromStoreError(finished.error, "ledger commit"));
    }
    return ok(finished.value);
  }

  return { apply };
}
