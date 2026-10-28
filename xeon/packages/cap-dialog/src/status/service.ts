import { DialogStatus, type CapabilityApi, type StatusItem } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope } from "@xeon/contracts/records";
import type { DialogDeps } from "../deps.ts";
import { DialogFailure, guarded } from "../errors.ts";
import {
  coreItems,
  initialCoreState,
  reduceCore,
  toolEnded,
  toolStarted,
  TOOLS_SEGMENT,
  TURN_SEGMENT,
  USAGE_SEGMENT,
  type CoreState,
} from "./core-segments.ts";
import { createStatusStore, MAX_EVENT_ITEMS, selectSegments } from "./store.ts";

// L2.dialog.spec §3.3, §4.4. 세그먼트 스냅숏은 스레드마다 메모리에 있고 변경은 휘발 이벤트 `dialog.status`(전체 스냅숏)로만
// 나간다. 같은 창 안의 변경은 한 이벤트로 묶는다.

type StatusApi = CapabilityApi<typeof DialogStatus>;

const CAPABILITY = DialogStatus.id;

/** 첫 변경부터 이 시간 안의 변경을 한 이벤트로 묶는다(spec §4.4) */
export const STATUS_BATCH_MS = 100;

export interface StatusService {
  readonly api: StatusApi;
  /** 내구 이벤트 피드의 이벤트 하나를 내장 세그먼트에 반영한다 */
  readonly onEvent: (event: DurableEventEnvelope) => void;
  /** `tool.execution.before`·`tool.execution.after` 지점 */
  readonly onToolStart: (threadId: ThreadId, toolCallId: string, toolName: string) => void;
  readonly onToolEnd: (threadId: ThreadId, toolCallId: string) => void;
  readonly dispose: () => void;
}

export function createStatusService(deps: DialogDeps): StatusService {
  const store = createStatusStore();
  const cores = new Map<ThreadId, CoreState>();
  const timers = new Map<ThreadId, number>();

  /** 설정이 고른 세그먼트. `list`와 휘발 이벤트가 같은 목록을 쓴다 */
  function visible(threadId: ThreadId): readonly StatusItem[] {
    return selectSegments(store.all(threadId), deps.settings(threadId).status.segments);
  }

  function flush(threadId: ThreadId): void {
    timers.delete(threadId);
    deps.status?.publish(threadId, visible(threadId).slice(0, MAX_EVENT_ITEMS));
  }

  function changed(threadId: ThreadId): void {
    if (deps.status === undefined || timers.has(threadId)) return;
    timers.set(
      threadId,
      deps.timers.scheduler.setTimeout(() => {
        flush(threadId);
      }, STATUS_BATCH_MS),
    );
  }

  function apply(threadId: ThreadId, state: CoreState): void {
    cores.set(threadId, state);
    const items = coreItems(state);
    for (const [id, item] of [
      [TURN_SEGMENT, items.turn],
      [TOOLS_SEGMENT, items.tools],
      [USAGE_SEGMENT, items.usage],
    ] as const) {
      if (item === null) store.clear(threadId, id);
      else store.set(threadId, item);
    }
    changed(threadId);
  }

  const api: StatusApi = {
    setItem: (input, options) =>
      guarded(CAPABILITY, "setItem", () => {
        const threadId = threadOf(options?.context?.threadId, "setItem");
        if (!store.set(threadId, input)) {
          return Promise.reject(
            new DialogFailure("invalid_input", "The thread already has too many status items."),
          );
        }
        changed(threadId);
        return Promise.resolve({});
      }),
    clearItem: (input, options) =>
      guarded(CAPABILITY, "clearItem", () => {
        const threadId = threadOf(options?.context?.threadId, "clearItem");
        store.clear(threadId, input.id);
        changed(threadId);
        return Promise.resolve({});
      }),
    list: (_input, options) =>
      guarded(CAPABILITY, "list", () => {
        const threadId = threadOf(options?.context?.threadId, "list");
        return Promise.resolve({ items: [...visible(threadId)] });
      }),
  };

  return {
    api,
    onEvent: (event) => {
      const previous = cores.get(event.threadId) ?? initialCoreState();
      const next = reduceCore(previous, event);
      if (next !== previous) apply(event.threadId, next);
    },
    onToolStart: (threadId, toolCallId, toolName) => {
      apply(threadId, toolStarted(cores.get(threadId) ?? initialCoreState(), toolCallId, toolName));
    },
    onToolEnd: (threadId, toolCallId) => {
      apply(threadId, toolEnded(cores.get(threadId) ?? initialCoreState(), toolCallId));
    },
    dispose: () => {
      for (const handle of timers.values()) deps.timers.scheduler.clearTimeout(handle);
      timers.clear();
    },
  };
}

function threadOf(threadId: ThreadId | undefined, method: string): ThreadId {
  if (threadId === undefined) {
    throw new DialogFailure(
      "invalid_input",
      `${method} needs a thread: the call context has no threadId.`,
    );
  }
  return threadId;
}
