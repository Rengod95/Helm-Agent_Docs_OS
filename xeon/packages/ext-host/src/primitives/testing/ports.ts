// L0·L1을 import하지 않는 인메모리 포트 대역(review.decisions-2 D-05). F 인터페이스로만 만든다.
import { canonicalJson, err, ok } from "@xeon/contracts";
import { fixedIdFactory } from "./ids.ts";
import type { EventId, ThreadId, Usage } from "@xeon/contracts/conversation";
import type {
  EnqueueRequest,
  EnqueueResult,
  ExtCommitRequest,
  ExtCommitResult,
  ExtRecordQuery,
  ExtRecordRow,
  ExtThreadSnapshot,
  InputQueuePort,
  LoopPort,
  LoopSpawnRequest,
  LoopSpawnResult,
  LoopTurnRequest,
  LoopTurnResult,
  OpenLease,
  ProjectorRegistryPort,
  RecordCommitPort,
  ScopedStorePort,
  SpawnOutcome,
  StoredScopeState,
  TurnOutcome,
} from "@xeon/contracts/extensions";
import type {
  DurableEventDraft,
  ExtensionEventKind,
  Projector,
  ProjectorFailure,
  StoreDb,
} from "@xeon/contracts/records";

// ── LoopPort ──────────────────────────────────────────────────────────────

export function fakeUsage(totalTokens: number): Usage {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export interface MemoryLoopOptions {
  /** turn 하나를 실행한다. 기본은 곧바로 completed와 usage 10토큰 */
  readonly runTurn?: (request: LoopTurnRequest) => Promise<{
    readonly outcome: TurnOutcome;
    readonly usage: Usage | null;
  }>;
  readonly runSpawn?: (request: LoopSpawnRequest) => Promise<{
    readonly outcome: SpawnOutcome;
    readonly usage: Usage | null;
  }>;
}

export interface MemoryLoopPort extends LoopPort {
  /** 실행된(재생이 아닌) turn 요청 */
  readonly turns: readonly LoopTurnRequest[];
  readonly spawns: readonly LoopSpawnRequest[];
  /** thread를 실행 중으로 표시한다. 사용자 turn이 도는 것을 흉내 낸다 */
  setRunning(threadId: ThreadId, running: boolean): void;
  /** whenIdle 안에 있는가 */
  isLocked(threadId: ThreadId): boolean;
}

const NOOP = (): void => {};

/** runTurn은 (scopeId, requestId)로 멱등이고 leaseEpoch가 작아진 요청은 거부한다. whenIdle 동안 새 turn은 기다린다 */
export function memoryLoopPort(options: MemoryLoopOptions = {}): MemoryLoopPort {
  const ids = fixedIdFactory(1000);
  const running = new Set<ThreadId>();
  const locked = new Map<ThreadId, Promise<void>>();
  const idleWaiters = new Map<ThreadId, (() => void)[]>();
  const turnResults = new Map<string, LoopTurnResult>();
  const spawnResults = new Map<string, LoopSpawnResult>();
  const epochs = new Map<string, number>();
  const turns: LoopTurnRequest[] = [];
  const spawns: LoopSpawnRequest[] = [];

  async function waitUnlocked(threadId: ThreadId): Promise<void> {
    const lock = locked.get(threadId);
    if (lock === undefined) return;
    await lock;
    await waitUnlocked(threadId);
  }

  function setRunning(threadId: ThreadId, value: boolean): void {
    if (value) {
      running.add(threadId);
      return;
    }
    running.delete(threadId);
    for (const wake of idleWaiters.get(threadId)?.splice(0) ?? []) wake();
  }

  function whenNotRunning(threadId: ThreadId): Promise<void> {
    if (!running.has(threadId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const list = idleWaiters.get(threadId) ?? [];
      list.push(resolve);
      idleWaiters.set(threadId, list);
    });
  }

  /** 유휴이고 잠기지 않은 순간에 잠금을 잡는다 */
  async function acquire(threadId: ThreadId): Promise<() => void> {
    await waitUnlocked(threadId);
    await whenNotRunning(threadId);
    if (locked.has(threadId) || running.has(threadId)) return acquire(threadId);
    let release = NOOP;
    locked.set(
      threadId,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      locked.delete(threadId);
      release();
    };
  }

  function fence(scopeId: string, leaseEpoch: number): void {
    const seen = epochs.get(scopeId) ?? 0;
    if (leaseEpoch < seen) {
      throw Object.assign(new Error(`stale lease epoch ${leaseEpoch} < ${seen}`), {
        kind: "stale_lease",
        scopeId,
        leaseEpoch,
      });
    }
    epochs.set(scopeId, leaseEpoch);
  }

  return {
    turns,
    spawns,
    setRunning,
    isLocked: (threadId) => locked.has(threadId),
    status: (threadId) => (running.has(threadId) ? "running" : "idle"),
    async runTurn(request) {
      const key = `${request.threadId}|${request.scopeId}|${request.requestId}`;
      const stored = turnResults.get(key);
      if (stored !== undefined) return { ...stored, replayed: true };
      fence(request.scopeId, request.leaseEpoch);
      await waitUnlocked(request.threadId);
      const again = turnResults.get(key);
      if (again !== undefined) return { ...again, replayed: true };
      turns.push(request);
      running.add(request.threadId);
      try {
        const done = await (options.runTurn?.(request) ??
          Promise.resolve({
            outcome: { turnId: ids.next("trn"), status: "completed" as const },
            usage: fakeUsage(10),
          }));
        const result: LoopTurnResult = {
          outcome: done.outcome,
          replayed: false,
          usage: done.usage,
        };
        turnResults.set(key, result);
        return result;
      } finally {
        setRunning(request.threadId, false);
      }
    },
    async spawn(request) {
      const key = `${request.threadId}|${request.scopeId}|${request.requestId}`;
      const stored = spawnResults.get(key);
      if (stored !== undefined) return { ...stored, replayed: true };
      fence(request.scopeId, request.leaseEpoch);
      spawns.push(request);
      const done = await (options.runSpawn?.(request) ??
        Promise.resolve({
          outcome: { childThreadId: ids.next("thr"), status: "completed" as const },
          usage: fakeUsage(5),
        }));
      const result: LoopSpawnResult = { outcome: done.outcome, replayed: false, usage: done.usage };
      spawnResults.set(key, result);
      return result;
    },
    async whenIdle(threadId, fn) {
      const release = await acquire(threadId);
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

// ── InputQueuePort ────────────────────────────────────────────────────────

export interface MemoryInputQueue extends InputQueuePort {
  readonly items: readonly EnqueueRequest[];
}

export function memoryInputQueue(): MemoryInputQueue {
  const items: EnqueueRequest[] = [];
  const seen = new Set<string>();
  return {
    items,
    enqueue(request): Promise<EnqueueResult> {
      const key = `${request.threadId}|${request.scopeId}|${request.requestId}`;
      if (seen.has(key)) return Promise.resolve({ duplicate: true });
      seen.add(key);
      items.push(request);
      return Promise.resolve({ duplicate: false });
    },
  };
}

// ── RecordCommitPort ──────────────────────────────────────────────────────

interface StoredEvent {
  readonly draft: DurableEventDraft;
  readonly seq: number;
  readonly parentId: EventId | null;
  readonly visibility: "public" | "private";
}

interface StoredThread {
  readonly events: StoredEvent[];
  leaf: EventId | null;
  readonly results: Map<string, { readonly fingerprint: string; readonly result: ExtCommitResult }>;
}

export interface MemoryRecordStore extends RecordCommitPort {
  /** 저장된 내구 이벤트 전체(커밋 순서) */
  events(threadId: ThreadId): readonly DurableEventDraft[];
  /** 활성 가지 위 이벤트(루트 → leaf) */
  branch(threadId: ThreadId): readonly DurableEventDraft[];
  /** 활성 leaf를 옮긴다(되감기). 이후 새 이벤트는 그 이벤트에 붙는다 */
  rewindTo(threadId: ThreadId, eventId: EventId | null): void;
  /** 다음 commit 하나를 거부하게 한다 */
  failNext(code: InjectedFault): void;
  /** 임대 사용량. loadThread의 openLease.used에 실린다 */
  setLeaseUsage(leaseId: string, used: OpenLease["used"]): void;
  /** commit 호출 수(재생 포함) */
  readonly commitCalls: number;
}

const STATE_KIND = /^(x|grp)\.[a-z][a-z0-9-]*\.state\.committed$/;

type InjectedFault = "state_conflict" | "lease_lost" | "invalid" | "busy" | "storage";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExtensionKind(kind: string): kind is ExtensionEventKind {
  return kind.startsWith("x.") || kind.startsWith("grp.");
}

function ownerOf(kind: string): string | undefined {
  const parts = kind.split(".");
  return parts[0] === "x" || parts[0] === "grp" ? parts[1] : undefined;
}

function kindMatches(kind: string, query: ExtRecordQuery): boolean {
  return query.kind.endsWith("*") ? kind.startsWith(query.kind.slice(0, -1)) : kind === query.kind;
}

function stateOf(branch: readonly StoredEvent[], scopeId: string): StoredScopeState | undefined {
  let found: StoredScopeState | undefined;
  for (const event of branch) {
    if (!STATE_KIND.test(event.draft.kind)) continue;
    const payload = event.draft.payload;
    if (!isRecord(payload) || payload["scopeId"] !== scopeId) continue;
    found = {
      scopeId,
      eventId: event.draft.id,
      rev: Number(payload["rev"]),
      version: Number(payload["version"]),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 상태 이벤트의 doc은 X가 만든 JSON이다
      doc: payload["doc"] as StoredScopeState["doc"],
    };
  }
  return found;
}

function fingerprintOf(request: ExtCommitRequest): string {
  return canonicalJson(
    request.fingerprintSource ?? request.drafts.map((draft) => [draft.kind, draft.payload]),
  );
}

function branchOf(thread: StoredThread): StoredEvent[] {
  const byId = new Map(thread.events.map((event) => [event.draft.id, event]));
  const out: StoredEvent[] = [];
  let cursor = thread.leaf;
  while (cursor !== null) {
    const event = byId.get(cursor);
    if (event === undefined) break;
    out.push(event);
    cursor = event.parentId;
  }
  return out.toReversed();
}

export function memoryRecordStore(): MemoryRecordStore {
  const threads = new Map<ThreadId, StoredThread>();
  const usage = new Map<string, OpenLease["used"]>();
  let seq = 0;
  let calls = 0;
  const fault: { next: InjectedFault | undefined } = { next: undefined };

  function threadOf(threadId: ThreadId): StoredThread {
    let found = threads.get(threadId);
    if (found === undefined) {
      found = { events: [], leaf: null, results: new Map() };
      threads.set(threadId, found);
    }
    return found;
  }

  function snapshotOf(thread: StoredThread): ExtThreadSnapshot {
    const branch = branchOf(thread);
    const enabled = new Set<string>();
    const scopeIds = new Set<string>();
    const epochs: Record<string, number> = {};
    let open: OpenLease | null = null;
    for (const event of branch) {
      const payload = event.draft.payload;
      if (!isRecord(payload)) continue;
      if (event.draft.kind === "scope.changed") {
        const id = String(payload["scopeId"]);
        if (payload["status"] === "enabled") enabled.add(id);
        else enabled.delete(id);
      } else if (event.draft.kind === "lease.acquired") {
        const id = String(payload["scopeId"]);
        epochs[id] = (epochs[id] ?? 0) + 1;
        const limits = isRecord(payload["limits"]) ? payload["limits"] : {};
        const leaseId = String(payload["leaseId"]);
        open = {
          leaseId,
          scopeId: id,
          leaseEpoch: epochs[id] ?? 1,
          limits: {
            ...(typeof limits["maxTurns"] === "number" ? { maxTurns: limits["maxTurns"] } : {}),
            ...(typeof limits["maxSpawns"] === "number" ? { maxSpawns: limits["maxSpawns"] } : {}),
            ...(typeof limits["maxTokens"] === "number" ? { maxTokens: limits["maxTokens"] } : {}),
          },
          used: usage.get(leaseId) ?? { turns: 0, spawns: 0, tokens: 0 },
        };
      } else if (event.draft.kind === "lease.released") {
        open = null;
      } else if (STATE_KIND.test(event.draft.kind)) {
        scopeIds.add(String(payload["scopeId"]));
      }
    }
    const states = [...scopeIds].flatMap((id) => {
      const state = stateOf(branch, id);
      return state === undefined ? [] : [state];
    });
    return { enabled: [...enabled], states, openLease: open, leaseEpochs: epochs };
  }

  function replayedOf(thread: StoredThread, request: ExtCommitRequest): ExtCommitResult {
    const expect = request.expectStateRev;
    if (expect === undefined) return { status: "replayed" };
    const stored = stateOf(branchOf(thread), expect.scopeId);
    return stored === undefined ? { status: "replayed" } : { status: "replayed", stored };
  }

  return {
    get commitCalls() {
      return calls;
    },
    events: (threadId) => (threads.get(threadId)?.events ?? []).map((event) => event.draft),
    branch: (threadId) => {
      const thread = threads.get(threadId);
      return thread === undefined ? [] : branchOf(thread).map((event) => event.draft);
    },
    rewindTo(threadId, eventId) {
      threadOf(threadId).leaf = eventId;
    },
    failNext(code) {
      fault.next = code;
    },
    setLeaseUsage(leaseId, used) {
      usage.set(leaseId, used);
    },
    commit(request): Promise<ExtCommitResult> {
      calls += 1;
      const thread = threadOf(request.threadId);
      const fingerprint = fingerprintOf(request);
      const previous = thread.results.get(request.requestId);
      if (previous !== undefined) {
        if (previous.fingerprint !== fingerprint) {
          return Promise.resolve({ status: "rejected", code: "invalid" });
        }
        return Promise.resolve(replayedOf(thread, request));
      }
      const injected = fault.next;
      if (injected !== undefined) {
        fault.next = undefined;
        return Promise.resolve({ status: "rejected", code: injected });
      }
      const expect = request.expectStateRev;
      if (expect !== undefined) {
        const current = stateOf(branchOf(thread), expect.scopeId)?.rev ?? 0;
        if (current !== expect.rev) {
          return Promise.resolve({ status: "rejected", code: "state_conflict" });
        }
      }
      for (const draft of request.drafts) {
        seq += 1;
        thread.events.push({
          draft,
          seq,
          parentId: thread.leaf,
          visibility: request.visibility ?? "public",
        });
        thread.leaf = draft.id;
      }
      const result: ExtCommitResult = { status: "committed" };
      thread.results.set(request.requestId, { fingerprint, result });
      return Promise.resolve(result);
    },
    loadThread(threadId) {
      return Promise.resolve(snapshotOf(threadOf(threadId)));
    },
    queryRecords(threadId, query, reader): Promise<readonly ExtRecordRow[]> {
      const thread = threadOf(threadId);
      const rows: ExtRecordRow[] = [];
      for (const event of branchOf(thread)) {
        const kind = event.draft.kind;
        if (!kindMatches(kind, query) || !isExtensionKind(kind)) continue;
        if (event.visibility === "private" && ownerOf(kind) !== reader) continue;
        const payload = event.draft.payload;
        if (!isRecord(payload)) continue;
        if (event.visibility === "private") {
          rows.push({
            groupId: ownerOf(kind) ?? "",
            kind,
            version: event.draft.version,
            subject: { type: "thread", id: event.draft.threadId },
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 비공개 기록의 payload는 JSON이다
            payload: payload as ExtRecordRow["payload"],
          });
          continue;
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 공개 기록의 payload는 X가 만든 GroupRecord다
        rows.push(payload as unknown as ExtRecordRow);
      }
      const subject = query.subject;
      const filtered =
        subject === undefined
          ? rows
          : rows.filter(
              (row) => row.subject.type === subject.type && row.subject.id === subject.id,
            );
      return Promise.resolve(query.limit === undefined ? filtered : filtered.slice(0, query.limit));
    },
  };
}

// ── ProjectorRegistryPort, ScopedStorePort ────────────────────────────────

export interface MemoryProjectorRegistry extends ProjectorRegistryPort {
  /** 등록된 투영기. 해제되면 빠진다 */
  readonly registered: () => readonly Projector[];
  /** 투영기 apply 예외를 흉내 낸다 */
  failProjector(failure: ProjectorFailure): void;
}

/** 이름 중복만 거부하는 투영기 등록 대역. 재생성·소유 검사는 L1.persistence와 L0.store 몫이라 흉내 내지 않는다 */
export function memoryProjectorRegistry(): MemoryProjectorRegistry {
  const projectors = new Map<string, Projector>();
  const listeners = new Set<(failure: ProjectorFailure) => void>();
  return {
    register(projector) {
      if (projectors.has(projector.name)) {
        return err({ kind: "name_taken", name: projector.name });
      }
      projectors.set(projector.name, projector);
      return ok({
        dispose: () => {
          if (projectors.get(projector.name) === projector) projectors.delete(projector.name);
        },
      });
    },
    onFailure(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    registered: () => [...projectors.values()],
    failProjector(failure) {
      for (const listener of listeners) listener(failure);
    },
  };
}

/** 소유자마다 테스트가 만든 StoreDb를 돌려주는 ScopedStorePort 대역 */
export function memoryScopedStore(factory: (owner: string) => StoreDb): ScopedStorePort & {
  readonly owners: () => readonly string[];
} {
  const dbs = new Map<string, StoreDb>();
  return {
    scoped(owner) {
      let db = dbs.get(owner);
      if (db === undefined) {
        db = factory(owner);
        dbs.set(owner, db);
      }
      return db;
    },
    owners: () => [...dbs.keys()],
  };
}
