import type { CallerId, RunSource } from "@fresnel/contracts/services";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { CallState } from "./types.ts";

// 진행 중인 도구 호출 표. 의도 표(intent table)는 각 CallState.intent다(L1.tools.spec §4.4 1번).
// 서비스 인스턴스마다 하나 만든다(모듈 전역 상태를 두지 않는다, AP-C-04).

export interface CallTable {
  get(threadId: ThreadId, toolCallId: string): CallState | undefined;
  put(state: CallState): void;
  remove(state: CallState): void;
  /** thread에서 진행 중인 도구 호출의 요청자(caller)와 표면 thread. 진행 중인 호출이 없으면 undefined */
  requesterOf(threadId: ThreadId):
    | {
        readonly surfaceThreadId: ThreadId;
        readonly caller: CallerId;
        readonly source?: RunSource;
      }
    | undefined;
}

function keyOf(threadId: ThreadId, toolCallId: string): string {
  return `${threadId}\0${toolCallId}`;
}

export function createCallTable(): CallTable {
  const table = new Map<string, CallState>();
  return {
    get: (threadId, toolCallId) => table.get(keyOf(threadId, toolCallId)),
    put: (state) => {
      table.set(keyOf(state.threadId, state.toolCallId), state);
    },
    remove: (state) => {
      const key = keyOf(state.threadId, state.toolCallId);
      if (table.get(key) === state) table.delete(key);
    },
    requesterOf: (threadId) => {
      for (const state of table.values()) {
        if (state.threadId === threadId) {
          return {
            surfaceThreadId: state.run.surfaceThreadId,
            caller: state.run.caller,
            ...(state.run.source === undefined ? {} : { source: state.run.source }),
          };
        }
      }
      return undefined;
    },
  };
}
