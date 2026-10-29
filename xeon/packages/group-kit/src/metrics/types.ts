import type { ThreadId } from "@xeon/contracts/conversation";
import type { GroupId } from "@xeon/contracts/extensions";
import type { GroupMetricsSummary } from "@xeon/contracts/services";

export type { GroupMetricsSummary } from "@xeon/contracts/services";

/**
 * 그룹 계측 집계(L3.group-kit.spec §3.12). snapshot은 메모리 카운터만 담는다.
 * denies·chainPatches·handlerErrors는 on 래퍼가, posts·spawns·delegates·commits·records는 wrap이 올린다.
 * tokens·costUsd는 `addUsage`로 더한 값이다. leases·leaseMs와 turn.completed 사용량은 이벤트에서 따로 셈하고(§4.9),
 * 그 값은 `GroupStatus.metrics`에서만 카운터와 합쳐진다. threadId는 모든 thread의 합이라 null이다.
 */
export interface GroupMetrics extends GroupMetricsSummary {
  readonly groupId: GroupId;
  readonly threadId: ThreadId | null;
  /** first 지점에서 이 그룹 핸들러가 결정(거부)을 돌려준 횟수 */
  readonly denies: number;
  /** chain 지점에서 이 그룹 핸들러가 돌려준 패치 수 */
  readonly chainPatches: number;
  /** 핸들러가 던진 횟수 */
  readonly handlerErrors: number;
  /** duplicate 제외 */
  readonly posts: number;
  /** drive 안 loop.spawn */
  readonly spawns: number;
  /** accepted delegate */
  readonly delegates: number;
  readonly commits: number;
  readonly records: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly costUsd: number;
  /** snapshot에서는 0이다. 임대 시간은 `lease.*` 이벤트에서 셈한다(GroupStatus.metrics 참고) */
  readonly leaseMs: number;
  /** snapshot에서는 0이다. 임대 수는 `lease.acquired` 이벤트에서 셈한다(GroupStatus.metrics 참고) */
  readonly leases: number;
}

/** 카운터 누계에서 snapshot의 id 두 필드를 뺀 값. 계측 기록의 delta 모양이다 */
export type GroupMetricsTotals = Omit<GroupMetrics, "groupId" | "threadId">;

/** `addUsage`의 인자. 모든 값은 0 이상의 유한한 수다 */
export interface GroupUsageDelta {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly costUsd: number;
}

export interface GroupMetricsHandle {
  /** 누적값. 순수 조회 */
  snapshot(): GroupMetrics;
  /**
   * 이 그룹이 쓴 토큰과 비용을 누적에 더한다. 음수나 유한하지 않은 값은 호출 계약 위반이라 Bug를 던진다.
   * 그룹 코드가 만든 값이므로 오류 값 대신 버그로 다룬다(TY-24, 자기 코드가 만든 값의 불변 조건)
   */
  addUsage(delta: GroupUsageDelta): void;
}

/**
 * grp.<그룹>.metrics.recorded payload(recordPrivate, L3.group-kit.spec §4.9). 단계 경계마다 0이 아닌 증가분만 쓴다.
 * stepId는 경계 signal의 turnId다 [결정: 오케스트레이터 기본값]
 */
export interface MetricsRecordedPayload {
  readonly stepId: string;
  readonly delta: GroupMetricsTotals;
}
