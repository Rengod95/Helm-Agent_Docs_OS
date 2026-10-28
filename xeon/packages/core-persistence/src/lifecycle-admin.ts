// 수명주기 가운데 조회·종결·삭제·제목(L1.persistence.spec §4.10.5, PS-9): list, close, remove, setTitle.
import { Bug, detach, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  type CommitPlan,
  type LeaseService,
  type LifecycleError,
  type ReadFailure,
  type SqlTx,
  type StoreDb,
  type StoreError,
  type ThreadLifecycle,
  type ThreadListQuery,
  type ThreadPage,
  type ThreadSummaryRow,
} from "@xeon/contracts/records";
import { sha256Hex } from "./hash.ts";
import { releaseOpenSession, type GuardState, type OpenSessions } from "./ownership.ts";
import type { SessionPoints } from "./points.ts";
import { PERSISTENCE_PRODUCER, type ProducerRegistry } from "./producers.ts";
import { columns, readResult, rowInvalid, type RowFault } from "./rows.ts";
import { writeResult } from "./tx-result.ts";
import { readThread, readThreadSummary } from "./views.ts";
import type { SessionWriter } from "./writer.ts";

export interface AdminDeps {
  readonly db: StoreDb;
  readonly leases: LeaseService;
  readonly writer: SessionWriter;
  readonly producers: ProducerRegistry;
  readonly sessions: OpenSessions;
  readonly guard: GuardState;
  readonly ids: IdFactory;
  readonly points: SessionPoints;
  readonly logger: Logger | undefined;
  /** 삭제 때 thread 행을 지울 투영 테이블(등록된 모든 투영기). 호출 때마다 읽는다 */
  readonly projectorTables: () => readonly string[];
  /** thread가 사라졌음을 알리는 캐시 정리 */
  readonly onRemoved: (threadId: ThreadId) => void;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** 쓰기 소유자만 부를 수 있는 호출의 검사. 소유자가 아니면 not_owner, 읽기 전용이면 read_only */
export function ownerError(sessions: OpenSessions, threadId: ThreadId): LifecycleError | null {
  const state = sessions.stateOf(threadId);
  if (state?.role !== "owner") return { kind: "not_owner", threadId };
  if (state.readOnly !== null) return { kind: "read_only", reason: state.readOnly };
  return null;
}

function encodeCursor(row: { readonly updatedAt: number; readonly threadId: string }): string {
  return `${String(row.updatedAt)}:${row.threadId}`;
}

function decodeCursor(
  cursor: string,
): { readonly updatedAt: number; readonly threadId: string } | undefined {
  const at = cursor.indexOf(":");
  if (at < 1) return undefined;
  const updatedAt = Number(cursor.slice(0, at));
  const threadId = cursor.slice(at + 1);
  if (!Number.isSafeInteger(updatedAt) || threadId === "") return undefined;
  return { updatedAt, threadId };
}

/** thread 행이 모양과 다르면 row_invalid를 만든다 */
function hasColumn(tx: SqlTx, table: string, column: string): boolean {
  return (
    tx.get("SELECT 1 AS hit FROM pragma_table_info(?) WHERE name = ?", [table, column]) !==
    undefined
  );
}

/** 이 thread의 모든 행을 지운다(한 트랜잭션 안). 이벤트 삭제 트리거는 표지 행이 있을 때만 통과한다 */
export function deleteThreadRows(
  tx: SqlTx,
  threadId: ThreadId,
  projectorTables: readonly string[],
): Result<void, LifecycleError> {
  const forks = tx.all(
    "SELECT thread_id FROM p_threads WHERE forked_from_thread = ? AND thread_id != ? ORDER BY thread_id",
    [threadId, threadId],
  );
  if (forks.length > 0) {
    const ids: ThreadId[] = [];
    for (const row of forks) {
      const id = columns(row, "p_threads").id("thr", "thread_id");
      if (!id.ok) return err(id.error);
      ids.push(id.value);
    }
    return err({ kind: "has_forks", forks: ids });
  }
  tx.run("INSERT INTO thread_delete_guard (thread_id) VALUES (?)", [threadId]);
  tx.run("DELETE FROM events WHERE thread_id = ?", [threadId]);
  tx.run("DELETE FROM requests WHERE thread_id = ?", [threadId]);
  tx.run("DELETE FROM thread_creation_keys WHERE thread_id = ?", [threadId]);
  for (const table of projectorTables) {
    // 확장 테이블 가운데 thread별이 아닌 것(전역 표)은 thread_id 열이 없다
    if (hasColumn(tx, table, "thread_id")) {
      tx.run(`DELETE FROM "${table}" WHERE thread_id = ?`, [threadId]);
    }
  }
  tx.run("DELETE FROM thread_delete_guard WHERE thread_id = ?", [threadId]);
  return ok(undefined);
}

export function createAdminOps(
  deps: AdminDeps,
): Pick<ThreadLifecycle, "list" | "close" | "remove" | "setTitle"> {
  const { db, writer, producers, sessions, ids, points, logger } = deps;
  const handle = producers.internal(PERSISTENCE_PRODUCER);

  const listPage = (query: ThreadListQuery): Result<ThreadPage, ReadFailure> => {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      return ok({ threads: [], nextCursor: null });
    }
    return readResult(db, (tx): Result<ThreadPage, RowFault> => {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (query.workspace !== undefined) {
        where.push("workspace = ?");
        params.push(query.workspace);
      }
      if (query.includeClosed !== true) where.push("status != 'closed'");
      if (cursor !== undefined) {
        where.push("(updated_at < ? OR (updated_at = ? AND thread_id < ?))");
        params.push(cursor.updatedAt, cursor.updatedAt, cursor.threadId);
      }
      const rows = tx.all(
        `SELECT thread_id FROM p_threads ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
         ORDER BY updated_at DESC, thread_id DESC LIMIT ?`,
        [...params, limit + 1],
      );
      const threads: ThreadSummaryRow[] = [];
      for (const row of rows) {
        const id = columns(row, "p_threads").id("thr", "thread_id");
        if (!id.ok) return id;
        const thread = readThread(tx, id.value);
        if (!thread.ok) return thread;
        if (thread.value === undefined) return err(rowInvalid("p_threads.thread_id"));
        const summary = readThreadSummary(tx, thread.value);
        if (!summary.ok) return summary;
        threads.push(summary.value);
      }
      const page = threads.slice(0, limit);
      const last = page[page.length - 1];
      return ok({
        threads: page,
        nextCursor: threads.length > limit && last !== undefined ? encodeCursor(last) : null,
      });
    });
  };

  return {
    list(query): ThreadPage {
      const page = listPage(query);
      if (page.ok) return page.value;
      // list는 오류 통로가 없다(F 계약). 읽을 수 없으면 빈 쪽을 돌려주고 남긴다
      logger?.error("session.list_unreadable", { reason: page.error.kind });
      return { threads: [], nextCursor: null };
    },

    close(threadId, reason): Result<void, LifecycleError> {
      const denied = ownerError(sessions, threadId);
      if (denied !== null) return err(denied);
      const committed = writer.commit({
        threadId,
        // 종결은 한 번이다: 이유가 달라도 같은 키라 두 번째 호출은 처음 결과를 돌려준다
        requestId: `thread:${threadId}:close`,
        fingerprintSource: {},
        build(view): CommitPlan {
          if (view.threadStatus === "closed") {
            return { kind: "reject", code: "thread_closed", detail: null };
          }
          if (view.threadStatus === "running") {
            return { kind: "reject", code: "turn_running", detail: null };
          }
          return {
            kind: "append",
            drafts: [
              handle.draft({
                id: ids.next("evt"),
                kind: "thread.closed",
                threadId,
                turnId: null,
                stepId: null,
                causationId: null,
                correlationId: null,
                payload: { reason },
              }),
            ],
            checkpoint: null,
          };
        },
      });
      if (!committed.ok) return err(committed.error);
      const result = committed.value;
      if (result.status === "committed") return ok(undefined);
      if (result.status === "key_reused") {
        throw new Bug("store.schema_invalid: the close key has a fixed fingerprint");
      }
      if (result.code === "turn_running") return turnRunning(deps, threadId);
      return err({ kind: "thread_closed", threadId });
    },

    remove(threadId): Result<void, LifecycleError> {
      const denied = ownerError(sessions, threadId);
      if (denied !== null) return err(denied);
      if (deps.guard.writing || deps.guard.notifying) {
        throw new Bug("store.nested_write: remove was called inside a commit or a commit listener");
      }
      deps.guard.writing = true;
      let removed: Result<void, LifecycleError | StoreError>;
      try {
        removed = writeResult(db, (tx): Result<void, LifecycleError> => {
          const thread = readThread(tx, threadId);
          if (!thread.ok) return err(thread.error);
          if (thread.value === undefined) return err({ kind: "thread_not_found", threadId });
          return deleteThreadRows(tx, threadId, deps.projectorTables());
        });
      } finally {
        deps.guard.writing = false;
      }
      if (!removed.ok) return err(removed.error);
      releaseOpenSession(sessions, deps.leases, logger, threadId);
      deps.onRemoved(threadId);
      return ok(undefined);
    },

    setTitle(threadId, title, requestKey): Result<void, LifecycleError> {
      const denied = ownerError(sessions, threadId);
      if (denied !== null) return err(denied);
      const committed = writer.commit({
        threadId,
        requestId: `title:${commitKeyPart(requestKey, sha256Hex)}`,
        fingerprintSource: { title },
        build(view): CommitPlan {
          if (view.threadStatus === "closed") {
            return { kind: "reject", code: "thread_closed", detail: null };
          }
          return {
            kind: "append",
            drafts: [
              handle.draft({
                id: ids.next("evt"),
                kind: "thread.updated",
                threadId,
                turnId: null,
                stepId: null,
                causationId: null,
                correlationId: null,
                payload: { title },
              }),
            ],
            checkpoint: null,
          };
        },
      });
      if (!committed.ok) return err(committed.error);
      const result = committed.value;
      if (result.status === "key_reused") {
        return err({ kind: "key_reused", requestKey });
      }
      if (result.status === "rejected") return err({ kind: "thread_closed", threadId });
      // 재전송(replayed)이면 이미 알렸다
      if (!result.replayed) {
        detach(
          points.infoChanged(
            { threadId, name: title },
            `${threadId}:session.info.after:${String(result.lastSeq)}`,
          ),
          (cause) => {
            logger?.warn("session.point_failed", {
              point: "session.info.after",
              threadId,
              reason: String(cause),
            });
          },
        );
      }
      return ok(undefined);
    },
  };
}

/** 열린 turn이 있다는 거부를 turn id와 함께 오류로 바꾼다 */
function turnRunning(deps: AdminDeps, threadId: ThreadId): Result<void, LifecycleError> {
  const thread = readResult(deps.db, (tx) => readThread(tx, threadId));
  if (!thread.ok) return err(thread.error);
  const turnId = thread.value?.openTurnId ?? null;
  // 같은 동기 구간에서 방금 reject한 상태라 열린 turn이 없을 수 없다
  if (turnId === null) throw new Bug("store.schema_invalid: turn_running without an open turn");
  return err({ kind: "turn_running", turnId });
}
