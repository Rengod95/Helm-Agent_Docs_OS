import { ok, type Logger, type Result } from "@xeon/contracts";
import type {
  CommitBatch,
  CommitListener,
  DurableEventEnvelope,
  EventFeed,
  FeedFilter,
  ReadFailure,
  StoreDb,
  Unsubscribe,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { envelopeOfRow, headSeqOf } from "./events.ts";
import { REPLAY_FLOOR_CONSUMER } from "./replay-floor.ts";
import type { GuardState } from "./ownership.ts";
import { columns, readResult } from "./rows.ts";
import { upcastStored, type KindCatalog } from "./upcast.ts";

export interface FeedController {
  readonly feed: EventFeed;
  /** 커밋이 끝난 같은 JS 턴에서 동기로 부른다(TX-09). 리스너 안 commit은 Bug(store.nested_write) */
  publish(batch: CommitBatch): void;
  emitVolatile(event: VolatileEventEnvelope): void;
  subscribe(
    afterSeq: number,
    listener: CommitListener,
    filter?: FeedFilter,
  ): Result<Unsubscribe, ReadFailure>;
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

export function createFeed(deps: FeedDeps): FeedController {
  const { db, catalog, guard, logger } = deps;
  const commitListeners = new Set<CommitListener>();
  const volatileListeners = new Set<(event: VolatileEventEnvelope) => void>();

  const headSeq = (): Result<number, ReadFailure> => readResult(db, (tx) => headSeqOf(tx));

  const floorCache = { value: 0 };
  const floorOf = (): number => {
    const read = readResult(db, (tx) => {
      const row = tx.get("SELECT seq FROM consumer_cursors WHERE consumer = ?", [
        REPLAY_FLOOR_CONSUMER,
      ]);
      if (row === undefined) return ok(0);
      return columns(row, "consumer_cursors").int("seq");
    });
    if (read.ok) {
      floorCache.value = Math.max(floorCache.value, read.value);
    } else {
      logger?.warn("session.replay_floor_unreadable", { kind: read.error.kind });
    }
    return floorCache.value;
  };

  const feedRead = (
    after: number,
    upto: number,
    filter: FeedFilter | undefined,
    limit: number,
    scanLimit: number,
  ): Result<
    { readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number },
    ReadFailure
  > => {
    const result = db.read((tx) =>
      tx.all("SELECT seq, envelope FROM events WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?", [
        after,
        upto,
        scanLimit,
      ]),
    );
    if (!result.ok) return result;
    const events: DurableEventEnvelope[] = [];
    let scannedTo = after;
    for (const row of result.value) {
      const seq = columns(row, "events").int("seq");
      if (!seq.ok) return seq;
      scannedTo = seq.value;
      const envelope = envelopeOfRow(row);
      if (!envelope.ok) return envelope;
      const event = upcastStored(catalog, envelope.value);
      if (!event.ok) return event;
      if (matchesFilter(filter, event.value)) events.push(event.value);
      // limit만큼 찼으면 거기서 멈춘다. 다음 읽기는 scannedTo부터 이어간다
      if (events.length >= limit) return ok({ events, scannedTo });
    }
    // 행이 scanLimit보다 적게 돌아왔으면 upto까지 모두 훑은 것이다
    return ok({ events, scannedTo: result.value.length < scanLimit ? upto : scannedTo });
  };

  const feed: EventFeed = {
    headSeq,
    // 보관 정리가 로그를 잘라 낼 때 오른다(consumer_cursors의 예약 행, M3-REQ-80). 읽지 못하면 마지막으로 읽은 값을 쓴다
    oldestReplayableSeq: floorOf,
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
    subscribe(
      afterSeq: number,
      listener: CommitListener,
      filter?: FeedFilter,
    ): Result<Unsubscribe, ReadFailure> {
      // 따라잡기와 실시간 등록을 같은 동기 구간에서 한다. 사이에 커밋이 끼지 못하므로 빈칸과 중복이 없다
      const upto = headSeq();
      if (!upto.ok) return upto;
      let cursor = afterSeq;
      while (cursor < upto.value) {
        const page = feedRead(cursor, upto.value, filter, 500, 2000);
        if (!page.ok) return page;
        if (page.value.events.length > 0) {
          listener({
            firstSeq: cursor + 1,
            lastSeq: page.value.scannedTo,
            events: page.value.events,
          });
        }
        cursor = page.value.scannedTo;
      }
      return ok(
        feed.onCommit((batch) => {
          const events = batch.events.filter((event) => matchesFilter(filter, event));
          if (events.length > 0) listener({ ...batch, events });
        }),
      );
    },
  };
}
