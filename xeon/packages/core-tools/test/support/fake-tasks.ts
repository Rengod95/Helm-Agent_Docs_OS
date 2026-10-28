import type { TurnId } from "@xeon/contracts/conversation";
import type {
  Limiter,
  LockRequest,
  PoolName,
  ScopeOutcome,
  Slot,
  TaskScope,
  TaskScopeKind,
  TaskScopeSpec,
} from "@xeon/contracts/services";
import type { ToolTasks } from "../../src/tasks.ts";

// core-tasks 대역. 범위 노드의 신호 전파와 키 큐(공유·배타, 사전순 획득)만 흉내 낸다.

interface FakeScope extends TaskScope {
  readonly controller: AbortController;
  readonly tracked: Promise<unknown>[];
}

interface LockSpan {
  readonly keys: readonly string[];
  readonly start: number;
  end: number;
}

export interface FakeTasksOptions {
  /** `tools` 풀 슬롯 수. 생략하면 제한이 없다 */
  readonly toolsCapacity?: number;
}

export interface FakeTasks extends ToolTasks {
  /** 키 잠금 획득과 슬롯 획득·반납을 일어난 순서대로 적는다(`lock:<키>`, `slot:<노드 id>`, `release:<노드 id>`) */
  readonly trace: readonly string[];
  /** 지금 쥔 `tools` 슬롯 수 */
  slotsInUse(): number;
  addTurn(turnId: TurnId): FakeScope;
  abortTurn(turnId: TurnId): void;
  scopes: readonly FakeScope[];
  /** 키 잠금을 쥔 구간의 기록(시작·끝 순번) */
  spans: readonly LockSpan[];
}

function abortReason(owner: TaskScope): Error {
  const reason: unknown = owner.signal.reason;
  return reason instanceof Error ? reason : new Error("aborted");
}

export function fakeTasks(options: FakeTasksOptions = {}): FakeTasks {
  const trace: string[] = [];
  const scopes: FakeScope[] = [];
  const spans: LockSpan[] = [];
  const tails = new Map<string, Promise<void>>();
  let tick = 0;

  function newScope(kind: TaskScopeKind, id: string, parent: TaskScope | null): FakeScope {
    const controller = new AbortController();
    const signal =
      parent === null ? controller.signal : AbortSignal.any([parent.signal, controller.signal]);
    const tracked: Promise<unknown>[] = [];
    const scope: FakeScope = {
      kind,
      id,
      parent,
      background: false,
      signal,
      state: "live",
      abortReason: null,
      controller,
      tracked,
      children: () => scopes.filter((candidate) => candidate.parent === scope),
      track: (work) => {
        tracked.push(work);
        return work;
      },
      settle: async (): Promise<ScopeOutcome> => {
        await Promise.all(tracked);
        return { aborted: signal.aborted, reason: null };
      },
    };
    scopes.push(scope);
    return scope;
  }

  // 슬롯 상한기. 꽉 차면 FIFO로 기다리고, 대기 중 owner가 취소되면 대기열에서 빠져 reason으로 거부한다
  let inUse = 0;
  const waiting: { readonly owner: TaskScope; readonly grant: () => void }[] = [];
  const capacity = options.toolsCapacity ?? Number.POSITIVE_INFINITY;

  function grantNext(): void {
    const next = inUse < capacity ? waiting.shift() : undefined;
    if (next === undefined) return;
    next.grant();
    grantNext();
  }

  const limiter: Limiter = {
    pool: "tools",
    capacity: () => capacity,
    inUse: () => inUse,
    waiting: () => waiting.length,
    acquire(owner) {
      const make = (): Slot => {
        let held = true;
        const slot: Slot = {
          pool: "tools",
          owner,
          release: () => {
            if (!held) return;
            held = false;
            inUse -= 1;
            trace.push(`release:${owner.id}`);
            grantNext();
          },
          suspendWhile: async (wait) => {
            slot.release();
            try {
              return await wait;
            } finally {
              // 다시 얻는다. 같은 슬롯 객체로 이어 쓰도록 새 슬롯의 release를 여기서 감싼다
              const again = await limiter.acquire(owner);
              held = true;
              slot.release = () => {
                again.release();
              };
            }
          },
        };
        return slot;
      };
      return new Promise<Slot>((resolve, reject) => {
        const take = (): void => {
          inUse += 1;
          trace.push(`slot:${owner.id}`);
          resolve(make());
        };
        if (owner.signal.aborted) {
          reject(abortReason(owner));
          return;
        }
        if (inUse < capacity) {
          take();
          return;
        }
        const entry = { owner, grant: take };
        waiting.push(entry);
        owner.signal.addEventListener(
          "abort",
          () => {
            const index = waiting.indexOf(entry);
            if (index < 0) return;
            waiting.splice(index, 1);
            reject(abortReason(owner));
          },
          { once: true },
        );
      });
    },
  };

  const root = newScope("app", "app", null);
  return {
    trace,
    slotsInUse: () => inUse,
    limiter: (pool: PoolName) => {
      if (pool !== "tools") throw new Error(`fake-tasks: pool ${pool} is not modeled`);
      return limiter;
    },
    get scopes() {
      return scopes;
    },
    get spans() {
      return spans;
    },
    addTurn: (turnId) => newScope("turn", turnId, root),
    abortTurn: (turnId) => {
      scopes.find((scope) => scope.kind === "turn" && scope.id === turnId)?.controller.abort();
    },
    find: (kind, id) => scopes.find((scope) => scope.kind === kind && scope.id === id),
    openScope: (parent: TaskScope, spec: TaskScopeSpec) => newScope(spec.kind, spec.id, parent),
    locks: {
      pending: () => 0,
      async run<T>(locks: readonly LockRequest[], owner: TaskScope, fn: () => Promise<T>) {
        const keys = locks.map((lock) => lock.key).toSorted();
        // 단순화: 같은 키는 모드와 무관하게 앞 작업이 끝난 뒤 시작한다. 공유 잠금 병행은 이 대역에 없다
        const waits = keys.map((key) => tails.get(key) ?? Promise.resolve());
        const release = Promise.withResolvers<void>();
        for (const key of keys) tails.set(key, release.promise);
        // 대기 중 owner.signal이 켜지면 대기열에서 빠지고 signal.reason으로 거부한다
        const cancelled = new Promise<{ readonly error: Error }>((resolve) => {
          const fail = (): void => {
            const reason: unknown = owner.signal.reason;
            resolve({ error: reason instanceof Error ? reason : new Error("aborted") });
          };
          if (owner.signal.aborted) fail();
          owner.signal.addEventListener("abort", fail, { once: true });
        });
        const first = await Promise.race([Promise.all(waits).then(() => undefined), cancelled]);
        if (first !== undefined) {
          release.resolve();
          throw first.error;
        }
        const span: LockSpan = { keys, start: (tick += 1), end: 0 };
        spans.push(span);
        trace.push(`lock:${keys.join(",")}`);
        try {
          return await fn();
        } finally {
          span.end = tick += 1;
          release.resolve();
        }
      },
    },
  };
}
