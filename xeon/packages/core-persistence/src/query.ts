import { ok, type Result } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  AgentView,
  EffectView,
  InputView,
  ProjectionQuery,
  ReadFailure,
  SessionService,
  StoreDb,
  ThreadSummaryRow,
  TurnView,
} from "@fresnel/contracts/records";
import { branchItems, itemEvent, kindIn, latestEvent } from "./branch.ts";
import { columns, readResult, type RowFault } from "./rows.ts";
import {
  readAgentByChild,
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

/** 대화 하나가 참조하는 블롭 수와 바이트 합. 같은 블롭을 두 대화가 참조하면 두 대화에 각각 든다 */
export interface ThreadBlobUsage {
  readonly threadId: string;
  readonly blobs: number;
  readonly bytes: number;
}

/**
 * 대화별 블롭 사용량: 투영의 `p_blob_refs`를 `sys_blobs`의 크기와 잇는다(L1.persistence.spec §4.11).
 * 두 표는 같은 데이터베이스 파일에 있어 한 질의로 된다. 디스크에 행이 없는 참조는 세지 않는다.
 * `StoreService.blobUsage().byThread`는 `sys_blob_refs`(owner = 'thread')를 세는데 L1은 그 참조를 쓰지 않으므로 대화별 값이 비어 있다
 */
function readBlobUsageByThread(db: StoreDb): Result<readonly ThreadBlobUsage[], ReadFailure> {
  return readResult(db, (tx): Result<readonly ThreadBlobUsage[], RowFault> => {
    const usage: ThreadBlobUsage[] = [];
    const rows = tx.all(
      `SELECT r.thread_id AS thread_id, COUNT(*) AS blobs, SUM(b.size) AS bytes
         FROM p_blob_refs AS r JOIN sys_blobs AS b ON b.sha256 = r.sha256
         GROUP BY r.thread_id ORDER BY r.thread_id`,
    );
    for (const row of rows) {
      const cols = columns(row, "p_blob_refs");
      const threadId = cols.string("thread_id");
      if (!threadId.ok) return threadId;
      const blobs = cols.int("blobs");
      if (!blobs.ok) return blobs;
      const bytes = cols.int("bytes");
      if (!bytes.ok) return bytes;
      usage.push({ threadId: threadId.value, blobs: blobs.value, bytes: bytes.value });
    }
    return ok(usage);
  });
}

/**
 * `ProjectionQuery`에 L1이 더한 읽기. F의 `ProjectionQuery`에는 이 메서드가 없어 서비스 객체에 붙이지 않고
 * `persistenceQueryOf(session)`으로 꺼낸다(item-pages.ts `itemPagesOf`와 같은 방식). [제안] F에 넣을지 정한다
 */
export interface PersistenceQuery extends ProjectionQuery {
  blobUsageByThread(): Result<readonly ThreadBlobUsage[], ReadFailure>;
}

const persistenceQueries = new WeakMap<SessionService["query"], PersistenceQuery>();

/** `createSessionService`가 만든 서비스에 딸린 L1 질의. 다른 구현(시험 대역)이면 undefined다 */
export function persistenceQueryOf(session: SessionService): PersistenceQuery | undefined {
  return persistenceQueries.get(session.query);
}

export function registerPersistenceQuery(session: SessionService, query: PersistenceQuery): void {
  persistenceQueries.set(session.query, query);
}

/**
 * 다른 컨텍스트가 p_*를 직접 읽지 않게 하는 질의 묶음(CM-02).
 */
export function createProjectionQuery(db: StoreDb): PersistenceQuery {
  return {
    blobUsageByThread: () => readBlobUsageByThread(db),
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
    agentOfChild(childThreadId): Result<AgentView | undefined, ReadFailure> {
      return readResult(db, (tx) => readAgentByChild(tx, childThreadId));
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
