import { Bug, type Logger } from "@xeon/contracts";
import type {
  CommitBatch,
  CommitListener,
  DurableEventEnvelope,
  EventFeed,
  FeedFilter,
  StoreDb,
  Unsubscribe,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { headSeqOf, parseEnvelope } from "./events.ts";
import type { GuardState } from "./ownership.ts";
import { columnInt, columnString } from "./rows.ts";
import type { KindCatalog } from "./upcast.ts";

export interface FeedController {
  readonly feed: EventFeed;
  /** 커밋이 끝난 같은 JS 턴에서 동기로 부른다(TX-09). 리스너 안 commit은 Bug(store.nested_write) */
  publish(batch: CommitBatch): void;
  emitVolatile(event: VolatileEventEnvelope): void;
  subscribe(afterSeq: number, listener: CommitListener, filter?: FeedFilter): Unsubscribe;
}

export interface FeedDeps {
  readonly db: StoreDb;
  readonly catalog: KindCatalog;
  readonly guard: GuardState;
  readonly logger?: Logger | undefined;
}

function matchesFilter(filter: FeedFilter | undefined, event: DurableEventEnvelope): boolean {
  if (filter === undefined) return true;
  if (filter.threadIds !== undefined && !filter.threadIds.includes(event.threadId)) return false;
  const { kindPrefixes, excludeKindPrefixes } = filter;
  if (kindPrefixes !== undefined && !kindPrefixes.some((prefix) => event.kind.startsWith(prefix))) {
    return false;
  }
  if (excludeKindPrefixes?.some((prefix) => event.kind.startsWith(prefix)) === true) return false;
  return true;
}

/** 저장된 envelope를 현재 버전으로 올린다. 못 올리면 저장된 데이터와 코드가 맞지 않는 것이다 */
export function upcastOrBug(
  catalog: KindCatalog,
  event: DurableEventEnvelope,
): DurableEventEnvelope {
  const upcasted = catalog.upcast(event);
  if (!upcasted.ok) {
    throw new Bug(`store.schema_invalid: cannot upcast ${event.kind} v${event.version}`, {
      cause: upcasted.error,
    });
  }
  return upcasted.value;
}

export function createFeed(deps: FeedDeps): FeedController {
  const { db, catalog, guard, logger } = deps;
  const commitListeners = new Set<CommitListener>();
  const volatileListeners = new Set<(event: VolatileEventEnvelope) => void>();

  const headSeq = (): number => {
    const result = db.read((tx) => headSeqOf(tx));
    if (!result.ok) throw new Bug(`store.read_failed: ${result.error.kind}`);
    return result.value;
  };

  const feedRead = (
    after: number,
    upto: number,
    filter: FeedFilter | undefined,
    limit: number,
    scanLimit: number,
  ): { readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number } => {
    const result = db.read((tx) =>
      tx.all("SELECT seq, envelope FROM events WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?", [
        after,
        upto,
        scanLimit,
      ]),
    );
    if (!result.ok) throw new Bug(`store.read_failed: ${result.error.kind}`);
    const events: DurableEventEnvelope[] = [];
    let scannedTo = after;
    for (const row of result.value) {
      scannedTo = columnInt(row, "seq");
      const event = upcastOrBug(catalog, parseEnvelope(columnString(row, "envelope")));
      if (matchesFilter(filter, event)) events.push(event);
      // limit만큼 찼으면 거기서 멈춘다. 다음 읽기는 scannedTo부터 이어간다
      if (events.length >= limit) return { events, scannedTo };
    }
    // 행이 scanLimit보다 적게 돌아왔으면 upto까지 모두 훑은 것이다
    return { events, scannedTo: result.value.length < scanLimit ? upto : scannedTo };
  };

  const feed: EventFeed = {
    headSeq,
    // 로그를 잘라 내지 않으므로 M1은 항상 0이다(보관 정리와 함께 오르는 일은 M3)
    oldestReplayableSeq: () => 0,
    read: feedRead,
    onCommit(listener: CommitListener): Unsubscribe {
      commitListeners.add(listener);
      return () => {
        commitListeners.delete(listener);
      };
    },
    onVolatile(listener): Unsubscribe {
      volatileListeners.add(listener);
      return () => {
        volatileListeners.delete(listener);
      };
    },
  };

  const reportListenerFailure = (what: string, caught: unknown): void => {
    logger?.error("session.listener_failed", {
      what,
      message: caught instanceof Error ? caught.message : String(caught),
    });
  };

  return {
    feed,
    publish(batch: CommitBatch): void {
      guard.notifying = true;
      try {
        // 구독자 예외는 잡아 기록한다. 결과와 다른 구독자에게 영향이 없다
        for (const listener of Array.from(commitListeners)) {
          try {
            listener(batch);
          } catch (caught) {
            reportListenerFailure("commit", caught);
          }
        }
      } finally {
        guard.notifying = false;
      }
    },
    emitVolatile(event: VolatileEventEnvelope): void {
      for (const listener of Array.from(volatileListeners)) {
        try {
          listener(event);
        } catch (caught) {
          reportListenerFailure("volatile", caught);
        }
      }
    },
    subscribe(afterSeq: number, listener: CommitListener, filter?: FeedFilter): Unsubscribe {
      // 따라잡기와 실시간 등록을 같은 동기 구간에서 한다. 사이에 커밋이 끼지 못하므로 빈칸과 중복이 없다
      const upto = headSeq();
      let cursor = afterSeq;
      while (cursor < upto) {
        const page = feedRead(cursor, upto, filter, 500, 2000);
        if (page.events.length > 0) {
          listener({ firstSeq: cursor + 1, lastSeq: page.scannedTo, events: page.events });
        }
        cursor = page.scannedTo;
      }
      return feed.onCommit((batch) => {
        const events = batch.events.filter((event) => matchesFilter(filter, event));
        if (events.length > 0) listener({ ...batch, events });
      });
    },
  };
}
