import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { EventFeed, ReadFailure, StoreDb } from "@xeon/contracts/records";
import { columns, readResult } from "./rows.ts";

// L1.persistence.spec §4.13.1 `replayFrom`의 뜻(M3-REQ-80). 재개한 연결이 이어 받을 이벤트의 출발 위치를 정한다.
// - "none": 재개 뒤의 실시간 이벤트만. `from: "head"`.
// - { storeId, seq }: 클라이언트가 마지막으로 받은 위치 뒤부터.
// - "all": 그 thread의 첫 이벤트부터. `from: { storeId, seq: first_seq - 1 }`, 필터는 그 thread 하나.
// 결과는 `events.subscribe`의 `from`·`filter.threadIds`에 그대로 넘길 수 있다. 위치 검사는 `events.subscribe`와 같다(F wire §3.4.3).

export type ReplayFrom = "none" | "all" | { readonly storeId: string; readonly seq: number };

export interface ReplayStart {
  readonly from: "head" | { readonly storeId: string; readonly seq: number };
  readonly threadIds: readonly [ThreadId];
}

export type ReplayFromError =
  | {
      readonly kind: "out_of_range";
      readonly reason: "storeMismatch" | "aheadOfHead" | "beforeOldest";
    }
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | ReadFailure;

export interface ReplayResolverDeps {
  readonly db: Pick<StoreDb, "read">;
  readonly feed: Pick<EventFeed, "headSeq" | "oldestReplayableSeq">;
  readonly storeId: string;
}

export interface ReplayResolver {
  resolve(threadId: ThreadId, replayFrom: ReplayFrom): Result<ReplayStart, ReplayFromError>;
}

export function createReplayResolver(deps: ReplayResolverDeps): ReplayResolver {
  const { db, feed, storeId } = deps;
  return {
    resolve(threadId, replayFrom) {
      const threadIds: readonly [ThreadId] = [threadId];
      if (replayFrom === "none") return ok({ from: "head", threadIds });
      const head = feed.headSeq();
      if (!head.ok) return head;
      const oldest = feed.oldestReplayableSeq();
      let seq: number;
      if (replayFrom === "all") {
        const first = readResult(db, (tx) => {
          const row = tx.get("SELECT first_seq FROM p_threads WHERE thread_id = ?", [threadId]);
          if (row === undefined) return ok(undefined);
          return columns(row, "p_threads").int("first_seq");
        });
        if (!first.ok) return first;
        if (first.value === undefined) return err({ kind: "thread_not_found", threadId });
        seq = first.value - 1;
      } else {
        if (replayFrom.storeId !== storeId) {
          return err({ kind: "out_of_range", reason: "storeMismatch" });
        }
        seq = replayFrom.seq;
      }
      if (seq > head.value) return err({ kind: "out_of_range", reason: "aheadOfHead" });
      if (seq < oldest) return err({ kind: "out_of_range", reason: "beforeOldest" });
      return ok({ from: { storeId, seq }, threadIds });
    },
  };
}
