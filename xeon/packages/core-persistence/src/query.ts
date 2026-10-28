import { ok, type Result } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  AgentView,
  EffectView,
  InputView,
  ProjectionQuery,
  ReadFailure,
  StoreDb,
  ThreadSummaryRow,
  TurnView,
} from "@xeon/contracts/records";
import { branchItems, itemEvent, kindIn, latestEvent } from "./branch.ts";
import { columns, readResult } from "./rows.ts";
import {
  readChildAgents,
  readThreadSummary,
  readPendingApprovals,
  readOpenEffects,
  readOpenTurn,
  readQueuedInputs,
  readThread,
  readTurn,
  readTurnByRequest,
} from "./views.ts";

/**
 * 다른 컨텍스트가 p_*를 직접 읽지 않게 하는 질의 묶음(CM-02).  */
export function createProjectionQuery(db: StoreDb): ProjectionQuery {
  return {
    thread(threadId: ThreadId): Result<ThreadSummaryRow | undefined, ReadFailure> {
      return readResult(db, (tx) => {
        const row = readThread(tx, threadId);
        if (!row.ok) return row;
        return row.value === undefined ? ok(undefined) : readThreadSummary(tx, row.value);
      });
    },
    turn(_threadId: ThreadId, turnId: TurnId): Result<TurnView | undefined, ReadFailure> {
      return readResult(db, (tx) => readTurn(tx, turnId));
    },
    openTurn(threadId: ThreadId): Result<TurnView | undefined, ReadFailure> {
      return readResult(db, (tx) => readOpenTurn(tx, threadId));
    },
    turnByRequestId(
      threadId: ThreadId,
      scopeId: string | null,
      requestId: string,
    ): Result<TurnView | undefined, ReadFailure> {
      return readResult(db, (tx) => readTurnByRequest(tx, threadId, scopeId, requestId));
    },
    openEffects(threadId: ThreadId): Result<readonly EffectView[], ReadFailure> {
      return readResult(db, (tx) => readOpenEffects(tx, threadId));
    },
    queuedInputs(threadId: ThreadId): Result<readonly InputView[], ReadFailure> {
      return readResult(db, (tx) => readQueuedInputs(tx, threadId));
    },
    pendingApprovals(threadId: ThreadId) {
      return readResult(db, (tx) => readPendingApprovals(tx, threadId));
    },
    childAgents(parentThreadId, options): Result<readonly AgentView[], ReadFailure> {
      return readResult(db, (tx) =>
        readChildAgents(tx, parentThreadId, options?.unsettledOnly === true),
      );
    },
    branchItems: (threadId, options) => readResult(db, (tx) => branchItems(tx, threadId, options)),
    itemEvent: (threadId, itemId) => readResult(db, (tx) => itemEvent(tx, threadId, itemId)),
    latestEvent: (threadId, kind, match, options) =>
      readResult(db, (tx) =>
        latestEvent(tx, threadId, kindIn([kind]), {
          ...(match === undefined ? {} : { match }),
          onActiveBranch: options?.onActiveBranch ?? false,
        }),
      ),
    liveBlobRefs: () =>
      readResult(db, (tx) => {
        const hashes: string[] = [];
        for (const row of tx.all("SELECT DISTINCT sha256 FROM p_blob_refs ORDER BY sha256")) {
          const sha256 = columns(row, "p_blob_refs").string("sha256");
          if (!sha256.ok) return sha256;
          hashes.push(sha256.value);
        }
        return ok(hashes);
      }),
  };
}
