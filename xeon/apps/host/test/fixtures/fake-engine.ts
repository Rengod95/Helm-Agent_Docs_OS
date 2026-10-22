import { err, ok } from "@xeon/contracts";
import type { IdFactory, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  DurableEventEnvelope,
  EventKind,
  ReadFailure,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import type { LoopError } from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { StoreId, StreamPosition } from "@xeon/contracts/wire";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { matchesFilter } from "../../src/handlers/events.ts";
import type {
  CommitBatch,
  Engine,
  EnginePorts,
  HostMode,
  LockOutcome,
  OwnerKind,
  SubmitOutcome,
} from "../../src/types.ts";

// 아래 층 패키지 없이 호스트의 연결·처리기·전송을 시험하려는 가짜 엔진. 이벤트 로그는 메모리이고 커밋 알림은 커밋 직후 같은 턴에서
// 동기로 간다(TX-09). 실제 엔진으로 도는 시험은 real-engine.ts를 쓴다.

export const FAKE_STORE_ID: StoreId = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";

interface FakeLog {
  readonly errors: {
    readonly message: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }[];
  readonly infos: {
    readonly message: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }[];
}

export interface FakeEngineOptions {
  readonly mode?: HostMode;
  readonly storeId?: StoreId;
  /** 이 owner가 모든 thread를 쥐고 있다 */
  readonly lockedBy?: OwnerKind;
  /** 다시 보낼 수 있는 가장 오래된 seq. 기본 0 */
  readonly oldestReplayable?: number;
  /** feed.read가 불릴 때마다(0부터 센 호출 번호) 먼저 부른다. 재전송 중 커밋을 끼워 넣을 때 쓴다 */
  readonly onRead?: (call: number) => void;
  /** 값이 있으면 feed.read가 이 읽기 실패로 끝난다(호출 번호는 onRead와 같다) */
  readonly readFault?: (call: number) => ReadFailure | undefined;
  /** 값이 있으면 feed.headSeq가 이 읽기 실패로 끝난다 */
  readonly headFault?: ReadFailure;
  /** settings.get이 보는 범위 층 */
  readonly layers?: ScopeStack;
}

export interface FakeEngine {
  readonly engine: Engine;
  readonly ids: IdFactory;
  readonly log: FakeLog;
  readonly events: readonly DurableEventEnvelope[];
  /** 이벤트를 커밋한다. 하나의 커밋 배치로 한 번에 알린다 */
  commit(
    entries: readonly {
      readonly kind: EventKind;
      readonly threadId: ThreadId;
      readonly payload?: unknown;
    }[],
  ): CommitBatch;
  emitVolatile(event: Pick<VolatileEventEnvelope, "threadId" | "turnId" | "n" | "afterSeq">): void;
  /** 다음 turn.start가 turn.busy가 되게 한다 */
  setRunningTurn(turnId: TurnId | undefined): void;
  /** 다음 turn.start를 루프가 거부한 것으로 만든다 */
  setRejection(error: LoopError | undefined): void;
  readonly submitted: { readonly threadId: ThreadId; readonly requestId: string | undefined }[];
  readonly held: ReadonlySet<ThreadId>;
  /** tryAcquire가 불린 기록 */
  readonly acquisitions: { readonly threadId: ThreadId; readonly kind: OwnerKind }[];
  /** 연결을 거치지 않고 thread를 만든다(다른 프로세스가 만든 thread를 흉내 낸다) */
  seedThread(): ThreadId;
}

const RECORDED_AT = 1_767_571_200_000;

export function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const ids = fixedIdFactory();
  const events: DurableEventEnvelope[] = [];
  const commitListeners = new Set<(batch: CommitBatch) => void>();
  const volatileListeners = new Set<(event: VolatileEventEnvelope) => void>();
  const threads = new Set<ThreadId>();
  const held = new Set<ThreadId>();
  const submitted: { threadId: ThreadId; requestId: string | undefined }[] = [];
  const acquisitions: { threadId: ThreadId; kind: OwnerKind }[] = [];
  const log: FakeLog = { errors: [], infos: [] };
  const state: { running: TurnId | undefined; rejection: LoopError | undefined } = {
    running: undefined,
    rejection: undefined,
  };
  const storeId = options.storeId ?? FAKE_STORE_ID;
  const counters = { reads: 0 };

  function commit(
    entries: readonly { kind: EventKind; threadId: ThreadId; payload?: unknown }[],
  ): CommitBatch {
    const firstSeq = events.length + 1;
    const batch: DurableEventEnvelope[] = entries.map((entry, index) => ({
      id: ids.next("evt"),
      kind: entry.kind,
      version: 1,
      durable: true,
      seq: firstSeq + index,
      parentId: null,
      threadId: entry.threadId,
      turnId: null,
      stepId: null,
      causationId: null,
      correlationId: null,
      recordedAt: RECORDED_AT + firstSeq + index,
      payload: entry.payload ?? {},
    }));
    events.push(...batch);
    const result: CommitBatch = { firstSeq, lastSeq: events.length, events: batch };
    for (const listener of Array.from(commitListeners)) listener(result);
    return result;
  }

  const ports: EnginePorts = {
    threads: {
      create() {
        const threadId = ids.next("thr");
        threads.add(threadId);
        commit([{ kind: "thread.started", threadId }]);
        return Promise.resolve({ threadId, position: position() });
      },
      exists: (threadId) => ok(threads.has(threadId)),
      list: () => Promise.resolve({ threads: [], nextCursor: null }),
      fork: () => Promise.reject(new Error("fork is not part of the fake")),
      revert: () => Promise.reject(new Error("revert is not part of the fake")),
      remove: () => Promise.reject(new Error("remove is not part of the fake")),
      position: () => ok(position()),
    },
    turns: {
      submit(threadId, _input, requestId): Promise<SubmitOutcome> {
        submitted.push({ threadId, requestId });
        if (state.rejection !== undefined) {
          return Promise.resolve({ ok: false, reason: "rejected", error: state.rejection });
        }
        if (state.running !== undefined) {
          return Promise.resolve({ ok: false, reason: "busy", turnId: state.running });
        }
        const turnId = ids.next("trn");
        commit([{ kind: "turn.started", threadId }]);
        return Promise.resolve({ ok: true, turnId });
      },
      interrupt: () => Promise.resolve(false),
      stopAtSafeBoundary: () => Promise.resolve(true),
    },
    feed: {
      headSeq: () => (options.headFault === undefined ? ok(events.length) : err(options.headFault)),
      oldestReplayableSeq: () => options.oldestReplayable ?? 0,
      read(after, upto, filter, limit, scanLimit) {
        options.onRead?.(counters.reads);
        const fault = options.readFault?.(counters.reads);
        counters.reads += 1;
        if (fault !== undefined) return err(fault);
        const rows = events.filter((event) => event.seq > after && event.seq <= upto);
        const scanned = rows.slice(0, scanLimit);
        const matched: DurableEventEnvelope[] = [];
        let scannedTo = after;
        for (const row of scanned) {
          scannedTo = row.seq;
          if (matchesFilter(row, filter)) matched.push(row);
          if (matched.length >= limit) return ok({ events: matched, scannedTo });
        }
        return ok({ events: matched, scannedTo: scanned.length < scanLimit ? upto : scannedTo });
      },
      onCommit(listener) {
        commitListeners.add(listener);
        return () => {
          commitListeners.delete(listener);
        };
      },
      onVolatile(listener) {
        volatileListeners.add(listener);
        return () => {
          volatileListeners.delete(listener);
        };
      },
    },
    locks: {
      tryAcquire(threadId, kind): Promise<LockOutcome> {
        acquisitions.push({ threadId, kind });
        if (options.lockedBy !== undefined) {
          return Promise.resolve({ ok: false, ownerKind: options.lockedBy });
        }
        held.add(threadId);
        return Promise.resolve({
          ok: true,
          token: { resource: `session:${threadId}`, holderId: "fake", epoch: 1 },
          release() {
            held.delete(threadId);
            return Promise.resolve();
          },
        });
      },
      holds: (threadId) => held.has(threadId),
    },
    settings: {
      layers: () => options.layers ?? [],
      write: () => Promise.reject(new Error("write is not part of the fake")),
      reset: () => Promise.reject(new Error("reset is not part of the fake")),
      onChange: () => () => undefined,
    },
    approvals: { respond: () => Promise.resolve({ applied: false }) },
    activity: {
      snapshot: () => ({ liveTurns: 0, liveTasks: 0, waitingApprovals: 0, pendingSchedules: 0 }),
      onChange: () => () => undefined,
    },
    notify: { show: () => Promise.resolve() },
    log: {
      error: (message, fields) => {
        log.errors.push({ message, fields });
      },
      info: (message, fields) => {
        log.infos.push({ message, fields });
      },
    },
    ids,
    clock: { now: () => RECORDED_AT },
  };

  function position(): StreamPosition {
    return { storeId, seq: events.length };
  }

  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const engine: Engine = {
    mode: options.mode ?? "in-process",
    storeId,
    catalog: built.catalog,
    startedAt: RECORDED_AT,
    ports,
    close: () => Promise.resolve(),
  };

  return {
    engine,
    ids,
    log,
    events,
    commit,
    emitVolatile(partial) {
      const event: VolatileEventEnvelope = {
        id: ids.next("evt"),
        kind: "item.updated",
        version: 1,
        durable: false,
        threadId: partial.threadId,
        turnId: partial.turnId,
        stepId: null,
        recordedAt: RECORDED_AT,
        causationId: null,
        correlationId: null,
        payload: { delta: "x" },
        n: partial.n,
        afterSeq: partial.afterSeq,
      };
      for (const listener of Array.from(volatileListeners)) listener(event);
    },
    setRunningTurn(turnId) {
      state.running = turnId;
    },
    setRejection(error) {
      state.rejection = error;
    },
    submitted,
    held,
    acquisitions,
    seedThread() {
      const threadId = ids.next("thr");
      threads.add(threadId);
      commit([{ kind: "thread.started", threadId }]);
      return threadId;
    },
  };
}
