import { Bug } from "@xeon/contracts";
import type { GroupId } from "@xeon/contracts/extensions";
import type {
  GroupMetrics,
  GroupMetricsHandle,
  GroupMetricsTotals,
  GroupUsageDelta,
} from "./types.ts";

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
  /** 마지막으로 기록한 누계 이후의 증가분과, 기록이 성공하면 `markRecorded`에 넘길 현재 누계 */
  unrecorded(): { readonly delta: GroupMetricsTotals; readonly now: GroupMetricsTotals };
  /** 기록에 성공한 누계를 새 기준으로 삼는다 */
  markRecorded(now: GroupMetricsTotals): void;
}

/** 값이 0 이상의 유한한 수인지 본다. addUsage 인자 검사에 쓴다 */
function isUsageAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** 그룹 하나의 메모리 집계(L3.group-kit.spec §3.12, §4.9). 프로세스가 뜬 뒤의 값이다 */
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
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
  let recorded: GroupMetricsTotals = totalsOf();

  function totalsOf(): GroupMetricsTotals {
    return {
      ...counts,
      tokens: {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
      },
      costUsd: usage.costUsd,
      leaseMs: 0,
    };
  }

  return {
    handle: {
      snapshot(): GroupMetrics {
        return { groupId, threadId: null, ...totalsOf() };
      },
      addUsage(delta: GroupUsageDelta): void {
        const values = [
          delta.input,
          delta.output,
          delta.cacheRead,
          delta.cacheWrite,
          delta.costUsd,
        ];
        // 검사를 모두 마친 뒤에 더한다. 일부만 더한 채 던지지 않는다
        if (!values.every(isUsageAmount)) {
          throw new Bug("group metrics: addUsage needs finite amounts of zero or more");
        }
        usage.input += delta.input;
        usage.output += delta.output;
        usage.cacheRead += delta.cacheRead;
        usage.cacheWrite += delta.cacheWrite;
        usage.costUsd += delta.costUsd;
      },
    },
    bump(field, amount = 1) {
      counts[field] += amount;
    },
    unrecorded() {
      const now = totalsOf();
      return { delta: subtractTotals(now, recorded), now };
    },
    markRecorded(now) {
      recorded = now;
    },
  };
}

/** 두 누계의 차이. 기록할 증가분을 만든다 */
function subtractTotals(now: GroupMetricsTotals, before: GroupMetricsTotals): GroupMetricsTotals {
  return {
    denies: now.denies - before.denies,
    chainPatches: now.chainPatches - before.chainPatches,
    handlerErrors: now.handlerErrors - before.handlerErrors,
    posts: now.posts - before.posts,
    spawns: now.spawns - before.spawns,
    delegates: now.delegates - before.delegates,
    commits: now.commits - before.commits,
    records: now.records - before.records,
    leases: now.leases - before.leases,
    tokens: {
      input: now.tokens.input - before.tokens.input,
      output: now.tokens.output - before.tokens.output,
      cacheRead: now.tokens.cacheRead - before.tokens.cacheRead,
      cacheWrite: now.tokens.cacheWrite - before.tokens.cacheWrite,
    },
    costUsd: now.costUsd - before.costUsd,
    leaseMs: now.leaseMs - before.leaseMs,
  };
}
