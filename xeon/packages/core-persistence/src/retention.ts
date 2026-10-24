// 보관 정리(L1.persistence.spec §6.1, PS-18). 엔진 열기 때 한 번 돌린다(호출은 조립 루트 몫).
// 기간(maxAgeDays)이 지난 thread를 먼저 고르고, 그래도 수(maxCount)를 넘으면 오래된 것부터 더 고른다.
// 빼는 것: 표식이 남은 thread, 열린 turn이 있는 thread, 다른 thread가 포크로 가리키는 thread, 지금 쓰기 소유 중인 thread.
// 삭제는 threads.remove와 같은 행 삭제 경로다(deleteThreadRows).
import { Bug, err, ok, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { LeaseService, ReadFailure, StoreDb, StoreError } from "@xeon/contracts/records";
import type { PersistenceSettings } from "./deps.ts";
import { sessionResource } from "./ids.ts";
import { deleteThreadRows } from "./lifecycle-admin.ts";
import type { GuardState, OpenSessions } from "./ownership.ts";
import { columns, readResult } from "./rows.ts";
import { writeResult } from "./tx-result.ts";

const DAY_MS = 86_400_000;

export interface RetentionApi {
  /** 지금 설정으로 지워질 thread. 지우지 않는다(설정 화면의 삭제 대상 수 미리보기) */
  preview(): Result<readonly ThreadId[], ReadFailure>;
  /** 지울 thread를 지우고 지운 목록을 돌려준다 */
  prune(): Result<readonly ThreadId[], StoreError>;
}

export interface RetentionDeps {
  readonly db: StoreDb;
  readonly leases: LeaseService;
  readonly sessions: OpenSessions;
  readonly guard: GuardState;
  readonly clock: Clock;
  readonly settings: () => PersistenceSettings;
  readonly projectorTables: () => readonly string[];
  readonly onRemoved: (threadId: ThreadId) => void;
  readonly logger: Logger | undefined;
}

interface Row {
  readonly threadId: ThreadId;
  readonly updatedAt: number;
}

export function createRetention(deps: RetentionDeps): RetentionApi {
  const { db, leases, sessions } = deps;

  const owned = (threadId: ThreadId): boolean => {
    if (sessions.stateOf(threadId)?.role === "owner") return true;
    const info = leases.inspect(sessionResource(threadId));
    return info.ok && info.value !== null;
  };

  const candidates = (): Result<readonly ThreadId[], ReadFailure> => {
    const settings = deps.settings();
    if (settings.retentionMaxAgeDays === 0 && settings.retentionMaxCount === 0) return ok([]);
    const read = readResult(db, (tx) => {
      const rows: Row[] = [];
      const eligible = new Set<ThreadId>();
      const all = tx.all(
        `SELECT thread_id, updated_at, open_turn_id,
           EXISTS (SELECT 1 FROM p_threads f WHERE f.forked_from_thread = p.thread_id) AS forked
         FROM p_threads p ORDER BY updated_at, thread_id`,
      );
      for (const row of all) {
        const c = columns(row, "p_threads");
        const threadId = c.id("thr", "thread_id");
        if (!threadId.ok) return threadId;
        const updatedAt = c.int("updated_at");
        if (!updatedAt.ok) return updatedAt;
        const open = c.nullableString("open_turn_id");
        if (!open.ok) return open;
        const forked = c.bool("forked");
        if (!forked.ok) return forked;
        rows.push({ threadId: threadId.value, updatedAt: updatedAt.value });
        if (open.value === null && !forked.value) eligible.add(threadId.value);
      }
      return ok({ rows, eligible });
    });
    if (!read.ok) return read;
    const { rows, eligible } = read.value;
    const chosen = new Set<ThreadId>();
    const now = deps.clock.now();
    if (settings.retentionMaxAgeDays > 0) {
      const cutoff = now - settings.retentionMaxAgeDays * DAY_MS;
      for (const row of rows) {
        if (row.updatedAt < cutoff && eligible.has(row.threadId) && !owned(row.threadId)) {
          chosen.add(row.threadId);
        }
      }
    }
    if (settings.retentionMaxCount > 0) {
      let remaining = rows.length - chosen.size;
      for (const row of rows) {
        if (remaining <= settings.retentionMaxCount) break;
        if (chosen.has(row.threadId) || !eligible.has(row.threadId) || owned(row.threadId)) {
          continue;
        }
        chosen.add(row.threadId);
        remaining -= 1;
      }
    }
    return ok(rows.filter((row) => chosen.has(row.threadId)).map((row) => row.threadId));
  };

  return {
    preview: candidates,
    prune(): Result<readonly ThreadId[], StoreError> {
      const planned = candidates();
      if (!planned.ok) return planned;
      if (deps.guard.writing || deps.guard.notifying) {
        throw new Bug("store.nested_write: prune was called inside a commit or a commit listener");
      }
      const removed: ThreadId[] = [];
      for (const threadId of planned.value) {
        deps.guard.writing = true;
        let outcome;
        try {
          outcome = writeResult(db, (tx) => deleteThreadRows(tx, threadId, deps.projectorTables()));
        } finally {
          deps.guard.writing = false;
        }
        if (outcome.ok) {
          removed.push(threadId);
          deps.onRemoved(threadId);
        } else if (outcome.error.kind === "has_forks") {
          // 이번 라운드에 포크가 생겼다. 다음 정리 때 다시 본다
          deps.logger?.info("session.retention_skipped", { threadId, reason: "has_forks" });
        } else if (
          outcome.error.kind === "busy" ||
          outcome.error.kind === "disk_full" ||
          outcome.error.kind === "io"
        ) {
          return err(outcome.error);
        } else {
          deps.logger?.warn("session.retention_skipped", {
            threadId,
            reason: outcome.error.kind,
          });
        }
      }
      return ok(removed);
    },
  };
}
