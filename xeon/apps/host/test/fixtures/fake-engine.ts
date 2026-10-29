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
import type { ScheduleService } from "@xeon/cap-schedule";
import { partial } from "./unsafe.ts";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { matchesFilter } from "../../src/handlers/events.ts";
import { createFakeSecrets, type FakeSecrets } from "./fake-secrets.ts";
import { createProcessShutdown } from "@xeon/platform-process";
import { createManualScheduler, type ManualScheduler } from "./manual-scheduler.ts";
import type {
  CommitBatch,
  Engine,
  EnginePorts,
  ApprovalPort,
  HostMode,
  LockOutcome,
  OwnerKind,
  SettingsChange,
  SettingsStorePort,
  SubmitOutcome,
  CommandPort,
  EngineDiagnostics,
  WebPort,
  ThreadPort,
  ProposalPort,
  TrustPort,
  TurnPort,
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
  /** 값이 있으면 tryAcquire가 이 약속이 풀릴 때까지 기다린다. 획득을 기다리는 동안의 연결 종료를 만들 때 쓴다 */
  readonly acquireGate?: Promise<void>;
  /** settings.get이 보는 범위 층 */
  readonly layers?: ScopeStack;
  /** 코어 카탈로그에 더하는 앱 설정 그룹(예약 키 시험 등) */
  readonly settingGroups?: Parameters<typeof buildEngineCatalog>[0];
  /** 진단 함수를 바꿔 끼운다(`host.status`의 `includeBinaries`). 생략하면 필수 바이너리가 모두 있는 빈 점검이다 */
  readonly diagnose?: (signal: AbortSignal) => Promise<EngineDiagnostics>;
  /** 포트 일부를 바꿔 끼운다. 처리기가 오류를 어떻게 옮기는지, 어떤 순서로 부르는지 볼 때 쓴다 */
  readonly overrides?: {
    readonly threads?: Partial<ThreadPort>;
    readonly turns?: Partial<TurnPort>;
    readonly settings?: Partial<SettingsStorePort>;
    readonly approvals?: Partial<ApprovalPort>;
    readonly trust?: Partial<TrustPort>;
    readonly commands?: Partial<CommandPort>;
    readonly web?: Partial<WebPort>;
    readonly proposals?: Partial<ProposalPort>;
  };
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
  /** 다른 프로세스의 커밋을 흉내 낸다: 저장소에는 들어가지만 이 프로세스의 커밋 알림은 오지 않는다 */
  commitForeign(
    entries: readonly {
      readonly kind: EventKind;
      readonly threadId: ThreadId;
      readonly payload?: unknown;
    }[],
  ): CommitBatch;
  /** 호스트가 쓰는 스케줄러. 관찰 폴링과 종료 시한이 여기에 타이머를 건다 */
  readonly scheduler: ManualScheduler;
  /** 종료 협조 시한을 넘겨 불린 exit의 종료코드. 대역의 exit는 프로세스를 끝내지 않고 던진다 */
  readonly exits: number[];
  emitVolatile(event: Pick<VolatileEventEnvelope, "threadId" | "turnId" | "n" | "afterSeq">): void;
  /** 설정 변경 신호를 낸다(`SettingsStorePort.onChange` 구독자에게). 실제 엔진에서는 설정 저장소와 신뢰 결정이 낸다 */
  emitSettingsChange(change: SettingsChange): void;
  /** 진단 함수가 불린 횟수 */
  readonly diagnoseCalls: () => number;
  /** 다음 turn.start가 turn.busy가 되게 한다 */
  setRunningTurn(turnId: TurnId | undefined): void;
  /** 다음 turn.start를 루프가 거부한 것으로 만든다 */
  setRejection(error: LoopError | undefined): void;
  /** 비밀 관리 서비스 대역과 맡긴 수단 저장소 */
  readonly secrets: FakeSecrets;
  readonly submitted: { readonly threadId: ThreadId; readonly requestId: string | undefined }[];
  readonly held: ReadonlySet<ThreadId>;
  /** release가 불린 thread */
  readonly released: readonly ThreadId[];
  /** tryAcquire가 불린 기록 */
  readonly acquisitions: { readonly threadId: ThreadId; readonly kind: OwnerKind }[];
  /** 연결을 거치지 않고 thread를 만든다(다른 프로세스가 만든 thread를 흉내 낸다) */
  seedThread(): ThreadId;
  /** `thread.rename`과 첫 입력 자동 제목이 정한 제목 */
  readonly titles: ReadonlyMap<ThreadId, string>;
}

const RECORDED_AT = 1_767_571_200_000;

export function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const ids = fixedIdFactory();
  const events: DurableEventEnvelope[] = [];
  const commitListeners = new Set<(batch: CommitBatch) => void>();
  const volatileListeners = new Set<(event: VolatileEventEnvelope) => void>();
  const settingsListeners = new Set<(change: SettingsChange) => void>();
  const threads = new Set<ThreadId>();
  const held = new Set<ThreadId>();
  const titles = new Map<ThreadId, string>();
  const submitted: { threadId: ThreadId; requestId: string | undefined }[] = [];
  const acquisitions: { threadId: ThreadId; kind: OwnerKind }[] = [];
  const released: ThreadId[] = [];
  const log: FakeLog = { errors: [], infos: [] };
  const state: { running: TurnId | undefined; rejection: LoopError | undefined } = {
    running: undefined,
    rejection: undefined,
  };
  const storeId = options.storeId ?? FAKE_STORE_ID;
  const secrets = createFakeSecrets();
  const scheduler = createManualScheduler();
  const exits: number[] = [];
  const shutdown = createProcessShutdown({
    timeoutMs: 3000,
    clock: { now: () => RECORDED_AT },
    scheduler,
    exit: (code) => {
      exits.push(code);
      throw new Error(`exit(${String(code)})`);
    },
  });
  const counters = { reads: 0, diagnoses: 0 };

  function commit(
    entries: readonly { kind: EventKind; threadId: ThreadId; payload?: unknown }[],
    notify = true,
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
    if (notify) for (const listener of Array.from(commitListeners)) listener(result);
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
      read: () => Promise.reject(new Error("read is not part of the fake")),
      rename(threadId, title) {
        // 제목 변경은 쓰기 소유자만 한다(SessionService.threads.setTitle)
        if (!held.has(threadId)) return err({ kind: "not_owner", threadId });
        titles.set(threadId, title);
        commit([{ kind: "thread.updated", threadId, payload: { title } }]);
        return ok({ position: position() });
      },
      compact: () => Promise.reject(new Error("compact is not part of the fake")),
      hasTitle: (threadId) => ok((titles.get(threadId) ?? "") !== ""),
      position: () => ok(position()),
      ...options.overrides?.threads,
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
      resume: () => Promise.reject(new Error("resume is not part of the fake")),
      stopAtSafeBoundary: () => Promise.resolve(true),
      isLive: () => state.running !== undefined,
      ...options.overrides?.turns,
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
      async tryAcquire(threadId, kind): Promise<LockOutcome> {
        acquisitions.push({ threadId, kind });
        await options.acquireGate;
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
      release(threadId) {
        held.delete(threadId);
        released.push(threadId);
        return Promise.resolve();
      },
    },
    settings: {
      layers: () => options.layers ?? [],
      prepare: () => Promise.resolve(),
      write: () => Promise.reject(new Error("write is not part of the fake")),
      reset: () => Promise.reject(new Error("reset is not part of the fake")),
      onChange(listener) {
        settingsListeners.add(listener);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      ...options.overrides?.settings,
    },
    approvals: {
      locate: () => Promise.resolve(ok(undefined)),
      respond: () => Promise.resolve({ applied: false }),
      list: () => Promise.reject(new Error("list is not part of the fake")),
      ...options.overrides?.approvals,
    },
    commands: {
      list: () => Promise.reject(new Error("command.list is not part of the fake")),
      run: () => Promise.reject(new Error("command.run is not part of the fake")),
      ...options.overrides?.commands,
    },
    web: {
      providers: () => Promise.reject(new Error("web.providers is not part of the fake")),
      ...options.overrides?.web,
    },
    proposals: {
      list: () => Promise.reject(new Error("proposal.list is not part of the fake")),
      decide: () => Promise.reject(new Error("proposal.decide is not part of the fake")),
      ...options.overrides?.proposals,
    },
    trust: {
      get: () => Promise.reject(new Error("trust.get is not part of the fake")),
      decide: () => Promise.reject(new Error("trust.decide is not part of the fake")),
      ...options.overrides?.trust,
    },
    activity: {
      snapshot: () => ({ liveTurns: 0, liveTasks: 0, waitingApprovals: 0, pendingSchedules: 0 }),
      onChange: () => () => undefined,
    },
    // 예약 서비스는 이 가짜가 쓰지 않는다(활동은 위 가짜가 낸다). 부르면 undefined라 시험이 바로 실패한다
    schedule: partial<ScheduleService>({}),
    notify: { show: () => Promise.resolve() },
    log: {
      error: (message, fields) => {
        log.errors.push({ message, fields });
      },
      info: (message, fields) => {
        log.infos.push({ message, fields });
      },
    },
    secrets: secrets.port,
    models: { modelIds: (provider) => (provider === "tape" ? ["tape-1"] : []) },
    ids,
    clock: { now: () => RECORDED_AT },
    scheduler,
  };

  function position(): StreamPosition {
    return { storeId, seq: events.length };
  }

  const built = buildEngineCatalog(options.settingGroups);
  if (!built.ok) throw new Error("the core catalog must build");
  const engine: Engine = {
    mode: options.mode ?? "in-process",
    storeId,
    catalog: built.catalog,
    safeMode: false,
    startedAt: RECORDED_AT,
    ports,
    shutdown,
    diagnose: (signal) => {
      counters.diagnoses += 1;
      if (options.diagnose !== undefined) return options.diagnose(signal);
      return Promise.resolve({
        binaries: ok({ platform: "linux", items: [], ready: true, blocking: [], degraded: [] }),
      });
    },
    close: () => Promise.resolve(),
  };

  return {
    engine,
    ids,
    log,
    events,
    commit: (entries) => commit(entries),
    commitForeign: (entries) => commit(entries, false),
    scheduler,
    exits,
    released,
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
    emitSettingsChange(change) {
      for (const listener of Array.from(settingsListeners)) listener(change);
    },
    setRunningTurn(turnId) {
      state.running = turnId;
    },
    setRejection(error) {
      state.rejection = error;
    },
    diagnoseCalls: () => counters.diagnoses,
    secrets,
    titles,
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
