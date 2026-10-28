import type { DrainMode, PoolName } from "@xeon/contracts/services";

/**
 * l1.tasks.* 설정 읽기(L1.tasks.spec §6). drain 모드와 동시 상한은 쓸 때마다 그때 읽는다(runtimeChange: live).
 * 값을 정하는 쪽(효과 값 계산, F.wire-settings.spec §3.9)은 조립 루트가 넘긴다
 */
export interface TasksSettingsSource {
  /** l1.tasks.queue.steeringMode */
  steeringMode(): DrainMode;
  /** l1.tasks.queue.followUpMode */
  followUpMode(): DrainMode;
  /** l1.tasks.limits.<풀>: 풀의 동시 상한(양의 정수) */
  limit(pool: PoolName): number;
}

/** 명세 §6 표의 기본 동시 상한 */
export const DEFAULT_POOL_LIMITS: Readonly<Record<PoolName, number>> = {
  tools: 8,
  subagents: 16,
  modelCalls: 16,
};

export interface StaticTasksSettings {
  readonly steeringMode?: DrainMode;
  readonly followUpMode?: DrainMode;
  readonly limits?: Readonly<Partial<Record<PoolName, number>>>;
}

/** 값이 정해진 설정 읽기. 값이 없으면 기본값(one-at-a-time, 8·16·16)이다 */
export function createStaticTasksSettings(values: StaticTasksSettings = {}): TasksSettingsSource {
  return {
    steeringMode: () => values.steeringMode ?? "one-at-a-time",
    followUpMode: () => values.followUpMode ?? "one-at-a-time",
    limit: (pool) => values.limits?.[pool] ?? DEFAULT_POOL_LIMITS[pool],
  };
}
