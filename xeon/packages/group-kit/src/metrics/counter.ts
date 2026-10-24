import type { GroupId } from "@xeon/contracts/extensions";
import type { GroupMetrics, GroupMetricsHandle } from "./types.ts";

type CounterField =
  | "denies"
  | "chainPatches"
  | "handlerErrors"
  | "posts"
  | "spawns"
  | "delegates"
  | "commits"
  | "records"
  | "leases";

export interface MetricsCounter {
  readonly handle: GroupMetricsHandle;
  bump(field: CounterField, amount?: number): void;
}

/** 그룹 하나의 메모리 집계(L3.group-kit.spec §3.12, plan "계측: 메모리 집계(M2)") */
export function createMetricsCounter(groupId: GroupId): MetricsCounter {
  const counts: Record<CounterField, number> = {
    denies: 0,
    chainPatches: 0,
    handlerErrors: 0,
    posts: 0,
    spawns: 0,
    delegates: 0,
    commits: 0,
    records: 0,
    leases: 0,
  };
  return {
    handle: {
      snapshot(): GroupMetrics {
        return {
          groupId,
          threadId: null,
          ...counts,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0,
          leaseMs: 0,
        };
      },
    },
    bump(field, amount = 1) {
      counts[field] += amount;
    },
  };
}
