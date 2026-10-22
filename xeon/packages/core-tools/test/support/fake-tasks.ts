import type { TurnId } from "@xeon/contracts/conversation";
import type {
  LockRequest,
  ScopeOutcome,
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

export interface FakeTasks extends ToolTasks {
  addTurn(turnId: TurnId): FakeScope;
  abortTurn(turnId: TurnId): void;
  scopes: readonly FakeScope[];
  /** 키 잠금을 쥔 구간의 기록(시작·끝 순번) */
  spans: readonly LockSpan[];
}

export function fakeTasks(): FakeTasks {
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

  const root = newScope("app", "app", null);
  return {
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
