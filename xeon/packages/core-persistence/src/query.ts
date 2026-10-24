import { Bug, ok, type Result } from "@xeon/contracts";
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
  readThreadSummary,
  readPendingApprovals,
  readOpenEffects,
  readOpenTurn,
  readQueuedInputs,
  readThread,
  readTurn,
  readTurnByRequest,
} from "./views.ts";

function notYet(member: string, plan: string): never {
  throw new Bug(`session.not_implemented: query.${member} arrives with ${plan}`);
}

/**
 * 다른 컨텍스트가 p_*를 직접 읽지 않게 하는 질의 묶음(CM-02). M1이 투영하는 표만 답한다.
 * 분기 조회(branchItems, itemEvent, latestEvent)와 자식 연결(childAgents)은
 * 해당 투영이 오는 때(PS-10, PS-23)에 더한다. 그때까지는 Bug로 알린다
 */
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
    childAgents(): Result<readonly AgentView[], ReadFailure> {
      return notYet("childAgents", "p_agents (PS-23, M2)");
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
