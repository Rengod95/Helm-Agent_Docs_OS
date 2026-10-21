import { Bug, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { ProducerHandle, StoreError } from "@xeon/contracts/records";
import type { Unsubscribe } from "@xeon/contracts/extensions";
import type {
  AbortOptions,
  AbortReason,
  AbortTicket,
  ActivitySnapshot,
  Limiter,
  PoolName,
  TaskScope,
  TaskService,
} from "@xeon/contracts/services";
import { CLOSE_ABORT_REASON, UNKNOWN_ABORT_REASON } from "./abort-reason.ts";
import { createInputQueue } from "./input-queue.ts";
import { createKeyedQueue } from "./keyed-queue.ts";
import { createPassThroughLimiter } from "./limiter.ts";
import { createScopeTree, type ScopeNode } from "./scope.ts";
import { commitWithRetry, describeError, type TasksSession } from "./session-port.ts";
import type { TasksSettingsSource } from "./settings-source.ts";

export interface TaskServiceDeps {
  readonly session: TasksSession;
  /** core.tasks 생산자. session.producer("core.tasks")를 setup에서 한 번만 받아 넘긴다 */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly settings: TasksSettingsSource;
  readonly log: Logger;
}

/** 스레드 목록을 한 쪽에 읽는 크기(ThreadListQuery.limit 상한) */
const THREAD_PAGE_LIMIT = 200;

/**
 * xeon.tasks(TaskService)를 만든다. Cordis에 등록하는 일은 plugin.ts가 한다(ADR-0002).
 * 범위 트리와 취소(spec §4.1~§4.3), 키 큐(§4.4), 내구 입력 큐(§4.6~§4.8)를 조립한다
 */
export function createTaskService(deps: TaskServiceDeps): TaskService {
  const { session, log } = deps;
  const activityListeners = new Set<() => void>();
  let closing = false;

  function notifyActivity(): void {
    for (const listener of activityListeners) {
      try {
        listener();
      } catch (cause) {
        log.error("tasks.on_activity_listener_failed", { error: describeError(cause) });
      }
    }
  }

  /** 신호를 받은 내구 노드(turn, subagent)가 자기 의도를 커밋한다. 최선 노력이고 빠지면 재개 때 소유 사슬에서 도출한다(§4.2 4번) */
  function recordCascadeIntent(node: ScopeNode): void {
    if (closing || node.intentHandled) return;
    node.markIntentHandled();
    try {
      const request = node.abortIntent?.(node.abortReason ?? UNKNOWN_ABORT_REASON, "cascade");
      if (request === null || request === undefined) return;
      const result = commitWithRetry(session, request);
      if (!result.ok) {
        log.warn("tasks.cascade_intent_failed", {
          scope: `${node.kind}:${node.id}`,
          error: result.error.kind,
        });
      }
    } catch (cause) {
      // 신호 리스너 안이다. 던지면 abort 호출자가 아니라 이벤트 전달 쪽으로 새어 나간다
      log.error("tasks.cascade_intent_threw", {
        scope: `${node.kind}:${node.id}`,
        error: describeError(cause),
      });
    }
  }

  const tree = createScopeTree({
    onOpened: notifyActivity,
    onSettled: notifyActivity,
    onSignalled: recordCascadeIntent,
  });

  const inputs = createInputQueue({ ...deps, onChanged: notifyActivity });
  const locks = createKeyedQueue();

  function whenSettled(owner: TaskScope, listener: () => void): void {
    const node = tree.nodeOf(owner);
    if (node === undefined) throw new Bug(`tasks.foreign_scope: ${owner.kind} ${owner.id}`);
    node.whenSettled(listener);
  }
  const limiters: Readonly<Record<PoolName, Limiter>> = {
    tools: createPassThroughLimiter("tools", whenSettled),
    subagents: createPassThroughLimiter("subagents", whenSettled),
    modelCalls: createPassThroughLimiter("modelCalls", whenSettled),
  };

  /** 의도를 먼저 내구로 남기고 신호를 보낸다(§4.2) */
  function performAbort(
    target: TaskScope,
    reason: AbortReason,
    options: AbortOptions | undefined,
  ): Result<AbortTicket, StoreError> {
    const node = tree.nodeOf(target);
    if (node === undefined) throw new Bug(`tasks.foreign_scope: ${target.kind} ${target.id}`);
    if (node.state === "settled") return ok({ status: "already_settled" });
    if (node.signal.aborted) return ok({ status: "already_aborting", settled: node.settle() });

    let ownershipLost: StoreError | undefined;
    if (!node.intentHandled) {
      const request = node.abortIntent?.(reason, "direct") ?? null;
      if (request !== null) {
        const result = commitWithRetry(session, request);
        if (!result.ok) {
          // 임대를 잃었으면 메모리 작업은 모두 멈춰야 한다. 그 밖의 실패는 신호를 보내지 않고 알린다
          if (result.error.kind !== "ownership_lost") return err(result.error);
          ownershipLost = result.error;
        } else if (result.value.status !== "committed") {
          log.warn("tasks.abort_intent_not_committed", {
            scope: `${node.kind}:${node.id}`,
            status: result.value.status,
          });
        }
      }
      node.markIntentHandled();
    }

    node.abortNow(reason);
    if (options?.background === true) {
      // 백그라운드 경계를 넘는다. 경계 아래의 소유 작업은 그 노드의 신호를 따라 켜진다
      for (const below of node.descendants()) {
        if (below.background && !below.signal.aborted) below.abortNow(reason);
      }
    }
    if (ownershipLost !== undefined) return err(ownershipLost);
    return ok({ status: "signalled", settled: node.settle() });
  }

  function queuedInputCount(): number {
    let total = 0;
    let cursor: string | undefined;
    do {
      const page = session.threads.list({
        limit: THREAD_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const thread of page.threads) total += thread.queuedInputs;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return total;
  }

  return {
    root: tree.root,
    openScope: (parent, spec) => tree.open(parent, spec),
    find: (kind, id) => tree.find(kind, id),
    abort(target, reason, options) {
      return new Promise((resolve) => {
        resolve(performAbort(target, reason, options));
      });
    },
    limiter: (pool) => limiters[pool],
    locks,
    inputs,
    enqueue: (request) => inputs.enqueuePost(request),
    activity(): ActivitySnapshot {
      const live = tree.live();
      return {
        liveTurns: live.filter((node) => node.kind === "turn").length,
        liveTasks: live.filter(
          (node) => node.kind === "turn" || node.kind === "tool" || node.kind === "subagent",
        ).length,
        queuedInputs: queuedInputCount(),
      };
    },
    onActivity(listener): Unsubscribe {
      activityListeners.add(listener);
      return () => {
        activityListeners.delete(listener);
      };
    },
    async close() {
      closing = true;
      // 신호만 보내고 의도는 쓰지 않는다. 다음 열기에서 재개된다(§3.1)
      tree.root.abortNow(CLOSE_ABORT_REASON);
      await Promise.allSettled(tree.live().map((node) => node.settle()));
      inputs.dispose();
      activityListeners.clear();
    },
  };
}
