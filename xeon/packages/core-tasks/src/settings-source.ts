import type { DrainMode } from "@xeon/contracts/services";

/**
 * l1.tasks.queue.* 설정 읽기(L1.tasks.spec §6). drain 모드는 배치 지점마다 그때 읽는다.
 * 값을 정하는 쪽(효과 값 계산, F.wire-settings.spec §3.9)은 조립 루트가 넘긴다
 */
export interface TasksSettingsSource {
  /** l1.tasks.queue.steeringMode */
  steeringMode(): DrainMode;
  /** l1.tasks.queue.followUpMode */
  followUpMode(): DrainMode;
}

export interface StaticTasksSettings {
  readonly steeringMode?: DrainMode;
  readonly followUpMode?: DrainMode;
}

/** 값이 정해진 설정 읽기. 값이 없으면 기본값 one-at-a-time이다 */
export function createStaticTasksSettings(values: StaticTasksSettings = {}): TasksSettingsSource {
  return {
    steeringMode: () => values.steeringMode ?? "one-at-a-time",
    followUpMode: () => values.followUpMode ?? "one-at-a-time",
  };
}
