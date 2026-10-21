import type { Logger } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { Unsubscribe } from "@xeon/contracts/records";
import type { UsageMeter, UsageRecord, UsageScope, UsageTotals } from "@xeon/contracts/services";

// L1.models.spec §3.5, §4.4, L1.models.plan M-3. 프로세스 메모리의 합산기다. 내구 기록의 원천은 어시스턴트
// item.recorded의 message.usage와 turn.completed이고, 재개 뒤에는 이벤트를 다시 읽어 채운다.
// combineUsage 포크는 하지 않고 자체 작성한다(15줄 안팎이라 가져오는 이점이 없다, plan §4).

export interface UsageRecorder extends UsageMeter {
  /** 종결 이벤트마다 한 번 부른다. 구독자 오류는 합산에 영향을 주지 않는다 */
  record(record: UsageRecord): void;
}

const EMPTY_TOTALS: UsageTotals = {
  calls: 0,
  abortedCalls: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
  costTotal: 0,
};

function matches(record: UsageRecord, scope: UsageScope): boolean {
  if (scope.turnId !== undefined && record.turnId !== scope.turnId) return false;
  if (scope.role !== undefined && record.role !== scope.role) return false;
  if (scope.scopeId !== undefined && record.scopeId !== scope.scopeId) return false;
  return true;
}

function add(totals: UsageTotals, record: UsageRecord): UsageTotals {
  const { usage } = record;
  return {
    calls: totals.calls + 1,
    abortedCalls: totals.abortedCalls + (record.aborted ? 1 : 0),
    input: totals.input + usage.input,
    output: totals.output + usage.output,
    cacheRead: totals.cacheRead + usage.cacheRead,
    cacheWrite: totals.cacheWrite + usage.cacheWrite,
    // reasoning은 보고한 provider만 합산한다
    reasoning: totals.reasoning + (usage.reasoning ?? 0),
    totalTokens: totals.totalTokens + usage.totalTokens,
    costTotal: totals.costTotal + usage.cost.total,
  };
}

export function createUsageMeter(logger?: Logger): UsageRecorder {
  const byThread = new Map<ThreadId, UsageRecord[]>();
  const listeners = new Set<(record: UsageRecord) => void>();

  return {
    record(record) {
      const list = byThread.get(record.threadId) ?? [];
      list.push(record);
      byThread.set(record.threadId, list);
      for (const listener of listeners) {
        try {
          listener(record);
        } catch (error) {
          logger?.warn("usage.listener_failed", {
            threadId: record.threadId,
            error: error instanceof Error ? error.message : "non-error thrown",
          });
        }
      }
    },
    totals(scope) {
      let totals = EMPTY_TOTALS;
      for (const record of byThread.get(scope.threadId) ?? []) {
        if (matches(record, scope)) totals = add(totals, record);
      }
      return totals;
    },
    subscribe(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
