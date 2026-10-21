import { Bug } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  AgentView,
  ApprovalView,
  EffectView,
  InputView,
  ProjectionQuery,
  StoreDb,
  ThreadSummaryRow,
  TurnView,
} from "@xeon/contracts/records";
import { readOrThrow } from "./read.ts";
import { columnString } from "./rows.ts";
import {
  markerOf,
  readPendingApprovals,
  readOpenEffects,
  readOpenTurn,
  readQueuedInputs,
  readThread,
  readTurn,
  readTurnByRequest,
} from "./views.ts";
import { toEventId } from "./ids.ts";

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
    thread(threadId: ThreadId): ThreadSummaryRow | undefined {
      return readOrThrow(db, (tx) => {
        const row = readThread(tx, threadId);
        if (row === undefined) return undefined;
        return {
          threadId: row.threadId,
          title: row.title,
          status: row.status,
          workspace: row.workspace,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          headSeq: row.headSeq,
          forkedFrom:
            row.forkedFrom === null
              ? null
              : { threadId: row.forkedFrom.threadId, eventId: toEventId(row.forkedFrom.eventId) },
          marker: markerOf(row),
          queuedInputs: readQueuedInputs(tx, threadId).length,
          pendingApprovals: readPendingApprovals(tx, threadId).length,
        };
      });
    },
    turn(_threadId: ThreadId, turnId: TurnId): TurnView | undefined {
      return readOrThrow(db, (tx) => readTurn(tx, turnId));
    },
    openTurn(threadId: ThreadId): TurnView | undefined {
      return readOrThrow(db, (tx) => readOpenTurn(tx, threadId));
    },
    turnByRequestId(
      threadId: ThreadId,
      scopeId: string | null,
      requestId: string,
    ): TurnView | undefined {
      return readOrThrow(db, (tx) => readTurnByRequest(tx, threadId, scopeId, requestId));
    },
    openEffects(threadId: ThreadId): readonly EffectView[] {
      return readOrThrow(db, (tx) => readOpenEffects(tx, threadId));
    },
    queuedInputs(threadId: ThreadId): readonly InputView[] {
      return readOrThrow(db, (tx) => readQueuedInputs(tx, threadId));
    },
    pendingApprovals(threadId: ThreadId): readonly ApprovalView[] {
      return readOrThrow(db, (tx) => readPendingApprovals(tx, threadId));
    },
    childAgents(): readonly AgentView[] {
      return notYet("childAgents", "p_agents (PS-23, M2)");
    },
    branchItems: () => notYet("branchItems", "branch queries (PS-10, M2)"),
    itemEvent: () => notYet("itemEvent", "branch queries (PS-10, M2)"),
    latestEvent: () => notYet("latestEvent", "branch queries (PS-10, M2)"),
    liveBlobRefs: () =>
      readOrThrow(db, (tx) =>
        tx
          .all("SELECT DISTINCT sha256 FROM p_blob_refs ORDER BY sha256")
          .map((row) => columnString(row, "sha256")),
      ),
  };
}
