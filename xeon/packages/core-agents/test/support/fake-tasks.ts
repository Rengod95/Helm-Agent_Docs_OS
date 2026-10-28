// core-tasks의 TaskService 부분을 흉내 내는 대역(DR-02: core-tasks를 import하지 않는다). 범위 트리, 취소 전파, 풀 상한(FIFO)만 같은 규칙으로 만든다.
import { err, ok, type Result } from "@xeon/contracts";
import type {
  AbortOptions,
  AbortReason,
  AbortTicket,
  Limiter,
  PoolName,
  ScopeOutcome,
  Slot,
  TaskScope,
  TaskScopeKind,
  TaskScopeSpec,
} from "@xeon/contracts/services";
import type { StoreError, ProducerHandle } from "@xeon/contracts/records";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { AgentsTasks } from "../../src/index.ts";

class FakeScope implements TaskScope {
  readonly kind: TaskScopeKind;
  readonly id: string;
  readonly parent: FakeScope | null;
  readonly childScopes: FakeScope[] = [];
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly background: boolean;
  state: TaskScope["state"] = "live";
  abortReason: AbortReason | null = null;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(kind: TaskScopeKind, id: string, parent: FakeScope | null, background: boolean) {
    this.kind = kind;
    this.id = id;
    this.parent = parent;
    this.background = background;
    this.signal =
      parent === null || background
        ? this.controller.signal
        : AbortSignal.any([parent.signal, this.controller.signal]);
    this.signal.addEventListener(
      "abort",
      () => {
        const reason: unknown = this.signal.reason;
        this.abortReason = isAbortReason(reason) ? reason : { code: "error", message: null };
        if (this.state === "live") this.state = "aborting";
      },
      { once: true },
    );
  }

  children(): readonly TaskScope[] {
    return this.childScopes;
  }

  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    const forget = (): void => {
      this.pending.delete(work);
    };
    work.then(forget, forget);
    return work;
  }

  private async drain(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled(this.pending);
    await this.drain();
  }

  async settle(): Promise<ScopeOutcome> {
    this.state = this.state === "live" ? "settling" : this.state;
    await this.drain();
    this.state = "settled";
    return { aborted: this.abortReason !== null, reason: this.abortReason };
  }
}

function isAbortReason(value: unknown): value is AbortReason {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function fakeLimiter(
  pool: PoolName,
  capacity: () => number,
): Limiter & { readonly held: () => number } {
  let used = 0;
  const waiters: { readonly owner: TaskScope; readonly grant: () => void }[] = [];
  const pump = (): void => {
    while (waiters.length > 0 && used < capacity()) {
      const next = waiters.shift();
      if (next === undefined) return;
      used += 1;
      next.grant();
    }
  };
  const slotFor = (owner: TaskScope): Slot => {
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      used -= 1;
      pump();
    };
    return {
      pool,
      owner,
      release,
      async suspendWhile<T>(wait: Promise<T>): Promise<T> {
        release();
        return await wait;
      },
    };
  };
  return {
    pool,
    capacity,
    inUse: () => used,
    waiting: () => waiters.length,
    held: () => used,
    async acquire(owner): Promise<Slot> {
      owner.signal.throwIfAborted();
      if (waiters.length === 0 && used < capacity()) {
        used += 1;
        return slotFor(owner);
      }
      const slot = await new Promise<Slot | null>((resolve) => {
        const entry = {
          owner,
          grant: () => {
            resolve(slotFor(owner));
          },
        };
        const onAbort = (): void => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          resolve(null);
        };
        owner.signal.addEventListener("abort", onAbort, { once: true });
        waiters.push(entry);
      });
      if (slot !== null) return slot;
      owner.signal.throwIfAborted();
      throw new Error("fakeTasks: waiter removed without an abort signal");
    },
  };
}

export interface FakeTasks extends AgentsTasks {
  readonly limits: Record<PoolName, { capacity: number }>;
  readonly scopes: readonly TaskScope[];
}

export interface FakeTasksOptions {
  /** 입력 큐 초안(draftQueued)이 쓰는 생산자와 id 발급기 */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
}

export function fakeTasks(options: FakeTasksOptions): FakeTasks {
  const root = new FakeScope("app", "app", null, false);
  const all: FakeScope[] = [root];
  const limits: Record<PoolName, { capacity: number }> = {
    tools: { capacity: 16 },
    subagents: { capacity: 16 },
    modelCalls: { capacity: 16 },
  };
  const limiters: Record<PoolName, Limiter> = {
    tools: fakeLimiter("tools", () => limits.tools.capacity),
    subagents: fakeLimiter("subagents", () => limits.subagents.capacity),
    modelCalls: fakeLimiter("modelCalls", () => limits.modelCalls.capacity),
  };
  return {
    root,
    limits,
    inputs: {
      draftQueued(view, draft) {
        const existing = view.inputByRequestId(draft.threadId, draft.source.type, draft.requestId);
        if (existing !== undefined) return { drafts: [], existing };
        const stamped = options.producer.draft({
          id: options.ids.next("evt"),
          kind: "input.queued",
          threadId: draft.threadId,
          turnId: null,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            mode: draft.mode,
            item: draft.item,
            requestId: draft.requestId,
            source: draft.source,
          },
        });
        return { drafts: [stamped], existing: undefined };
      },
    },
    get scopes() {
      return all;
    },
    openScope(parent, spec: TaskScopeSpec): TaskScope {
      if (!(parent instanceof FakeScope)) throw new Error("fakeTasks: foreign parent scope");
      const scope = new FakeScope(spec.kind, spec.id, parent, spec.background === true);
      parent.childScopes.push(scope);
      all.push(scope);
      return scope;
    },
    find(kind, id) {
      return all.find(
        (scope) => scope.kind === kind && scope.id === id && scope.state !== "settled",
      );
    },
    abort(
      target,
      reason: AbortReason,
      _options?: AbortOptions,
    ): Promise<Result<AbortTicket, StoreError>> {
      if (!(target instanceof FakeScope)) return Promise.resolve(err({ kind: "busy" }));
      if (target.state === "settled") return Promise.resolve(ok({ status: "already_settled" }));
      if (target.signal.aborted) {
        return Promise.resolve(ok({ status: "already_aborting", settled: target.settle() }));
      }
      target.controller.abort(reason);
      return Promise.resolve(ok({ status: "signalled", settled: target.settle() }));
    },
    limiter: (pool) => limiters[pool],
  };
}
