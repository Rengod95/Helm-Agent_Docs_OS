import { Bug } from "@xeon/contracts";
import type {
  AbortIntentWriter,
  AbortReason,
  ScopeOutcome,
  TaskScope,
  TaskScopeKind,
  TaskScopeSpec,
  TaskScopeState,
} from "@xeon/contracts/services";
import { isAbortReason, UNKNOWN_ABORT_REASON } from "./abort-reason.ts";

// L1.tasks.spec §4.1 범위 트리. 소유 간선은 만들 때 정하고 바꾸지 않는다.

/** 서비스 안에서만 쓰는 범위 노드. 사용자에게는 TaskScope로 보인다 */
export interface ScopeNode extends TaskScope {
  readonly parent: ScopeNode | null;
  readonly abortIntent: AbortIntentWriter | undefined;
  children(): readonly ScopeNode[];
  /** 취소 의도를 이미 커밋했거나 쓰지 않기로 했으면 참 */
  readonly intentHandled: boolean;
  markIntentHandled(): void;
  /** 이 노드의 제어기를 켠다. 소유 작업은 AbortSignal.any로 함께 켜진다 */
  abortNow(reason: AbortReason): void;
  /** 이 노드 아래 모든 노드. 백그라운드 경계를 건너 포함한다 */
  descendants(): readonly ScopeNode[];
  /** 정착하면 부른다. 이미 정착했으면 곧바로 부른다. settle()을 요청하지 않는다 */
  whenSettled(listener: () => void): void;
  /** 트리 안에서만 쓴다. 자식을 소유 목록에 넣고 뺀다 */
  attach(child: ScopeNode): void;
  detach(child: ScopeNode): void;
}

export interface ScopeHooks {
  /** 노드를 만든 직후 */
  onOpened(node: ScopeNode): void;
  /** 노드가 정착한 직후 */
  onSettled(node: ScopeNode): void;
  /** 의도 기록기가 있는 노드의 신호가 켜졌다(부모 취소가 전파됐거나 직접 켰다) */
  onSignalled(node: ScopeNode): void;
}

export interface ScopeTree {
  readonly root: ScopeNode;
  open(parent: TaskScope, spec: TaskScopeSpec): ScopeNode;
  nodeOf(scope: TaskScope): ScopeNode | undefined;
  find(kind: TaskScopeKind, id: string): ScopeNode | undefined;
  /** 정착하지 않은 모든 노드 */
  live(): readonly ScopeNode[];
}

/** spec §4.1 표 */
const ALLOWED_PARENTS: Readonly<Record<Exclude<TaskScopeKind, "app">, readonly TaskScopeKind[]>> = {
  thread: ["app"],
  turn: ["thread", "subagent"],
  tool: ["turn"],
  subagent: ["turn", "tool", "thread"],
};

function indexKey(kind: TaskScopeKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function checkSpec(parent: ScopeNode, spec: TaskScopeSpec): boolean {
  const background = spec.background === true;
  if (!ALLOWED_PARENTS[spec.kind].includes(parent.kind)) return false;
  if (spec.kind === "subagent") {
    // 부모가 thread이면 background: true, turn·tool 아래는 background: false만
    return parent.kind === "thread" ? background : !background;
  }
  return !background;
}

export function createScopeTree(hooks: ScopeHooks): ScopeTree {
  const registry = new WeakMap<TaskScope, ScopeNode>();
  const index = new Map<string, ScopeNode[]>();

  function createNode(
    parent: ScopeNode | null,
    root: ScopeNode | null,
    kind: TaskScopeKind,
    id: string,
    background: boolean,
    abortIntent: AbortIntentWriter | undefined,
  ): ScopeNode {
    const controller = new AbortController();
    const upstream = background ? root : parent;
    const signal =
      upstream === null ? controller.signal : AbortSignal.any([upstream.signal, controller.signal]);
    const children = new Set<ScopeNode>();
    const tracked = new Set<Promise<unknown>>();
    const settledListeners: (() => void)[] = [];
    let settleRequested = false;
    let settled = false;
    let intentHandled = false;
    let settlePromise: Promise<ScopeOutcome> | undefined;

    function reasonOf(): AbortReason | null {
      if (!signal.aborted) return null;
      const raw: unknown = signal.reason;
      return isAbortReason(raw) ? raw : UNKNOWN_ABORT_REASON;
    }

    function finalize(): ScopeOutcome {
      settled = true;
      const list = index.get(indexKey(kind, id));
      if (list !== undefined) {
        const remaining = list.filter((entry) => entry !== node);
        if (remaining.length === 0) index.delete(indexKey(kind, id));
        else index.set(indexKey(kind, id), remaining);
      }
      parent?.detach(node);
      for (const listener of settledListeners.splice(0)) listener();
      hooks.onSettled(node);
      return { aborted: signal.aborted, reason: reasonOf() };
    }

    /** 소유 작업이 정착한 뒤에 정착한다(아래에서 위). 백그라운드 자식은 기다리지 않는다. 기다리는 사이 늘어난 작업까지 본다 */
    async function waitQuiet(): Promise<void> {
      const waits: Promise<unknown>[] = [...tracked];
      for (const child of children) {
        if (!child.background) waits.push(child.settle());
      }
      if (waits.length === 0) return;
      await Promise.allSettled(waits);
      await waitQuiet();
    }

    async function runSettle(): Promise<ScopeOutcome> {
      await waitQuiet();
      return finalize();
    }

    const node: ScopeNode = {
      kind,
      id,
      parent,
      background,
      signal,
      abortIntent,
      get state(): TaskScopeState {
        if (settled) return "settled";
        if (signal.aborted) return "aborting";
        return settleRequested ? "settling" : "live";
      },
      get abortReason(): AbortReason | null {
        return reasonOf();
      },
      get intentHandled(): boolean {
        return intentHandled;
      },
      markIntentHandled() {
        intentHandled = true;
      },
      abortNow(reason) {
        controller.abort(reason);
      },
      children() {
        return [...children];
      },
      descendants() {
        const out: ScopeNode[] = [];
        const pending: ScopeNode[] = [...children];
        for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
          out.push(next);
          pending.push(...next.children());
        }
        return out;
      },
      track<T>(work: Promise<T>): Promise<T> {
        if (settled) throw new Bug(`tasks.scope_settled: ${kind} ${id} is settled`);
        tracked.add(work);
        const forget = (): void => {
          tracked.delete(work);
        };
        work.then(forget, forget);
        return work;
      },
      settle() {
        settleRequested = true;
        settlePromise ??= runSettle();
        return settlePromise;
      },
      whenSettled(listener) {
        if (settled) listener();
        else settledListeners.push(listener);
      },
      attach(child) {
        children.add(child);
      },
      detach(child) {
        children.delete(child);
      },
    };
    registry.set(node, node);
    return node;
  }

  const root = createNode(null, null, "app", "app", false, undefined);
  index.set(indexKey("app", "app"), [root]);

  function open(parentScope: TaskScope, spec: TaskScopeSpec): ScopeNode {
    const parent = registry.get(parentScope);
    if (parent === undefined) {
      throw new Bug(
        `tasks.invalid_parent: ${parentScope.kind} ${parentScope.id} is not in this tree`,
      );
    }
    if (parent.state === "settled") {
      throw new Bug(`tasks.parent_settled: ${parent.kind} ${parent.id} is settled`);
    }
    if (!checkSpec(parent, spec)) {
      throw new Bug(
        `tasks.invalid_parent: ${spec.kind}${spec.background === true ? " (background)" : ""} cannot be opened under ${parent.kind}`,
      );
    }
    const node = createNode(
      parent,
      root,
      spec.kind,
      spec.id,
      spec.background === true,
      spec.abortIntent,
    );
    parent.attach(node);
    const key = indexKey(spec.kind, spec.id);
    index.set(key, [...(index.get(key) ?? []), node]);
    if (spec.abortIntent !== undefined) {
      node.signal.addEventListener("abort", () => hooks.onSignalled(node), { once: true });
    }
    hooks.onOpened(node);
    return node;
  }

  return {
    root,
    open,
    nodeOf: (scope) => registry.get(scope),
    find(kind, id) {
      return index.get(indexKey(kind, id))?.at(-1);
    },
    live() {
      return [...index.values()].flat();
    },
  };
}
