import type { ThreadId } from "@xeon/contracts/conversation";
import type { GroupId } from "@xeon/contracts/extensions";
import type { GroupMetricsSummary } from "@xeon/contracts/services";

export type { GroupMetricsSummary } from "@xeon/contracts/services";

/**
 * 그룹 계측 집계(L3.group-kit.spec §3.12). M2는 프로세스 안 메모리 집계만 한다.
 * 이 때문에 threadId는 thread 하나가 아니라 "모든 thread의 합"을 뜻하는 null이 될 수 있다(스펙의 ThreadId에서 넓힌 값).
 * 토큰·비용·임대 시간·임대 수는 `lease.*`·`turn.completed` 이벤트가 필요해 M3(G-17)까지 0이다.
 */
export interface GroupMetrics extends GroupMetricsSummary {
  readonly groupId: GroupId;
  readonly threadId: ThreadId | null;
  /** first 지점에서 이 그룹 핸들러가 결정(거부)을 돌려준 횟수. on 래퍼를 쓰는 M3(G-17)까지 0 */
  readonly denies: number;
  /** chain 지점에서 이 그룹 핸들러가 돌려준 패치 수. M3까지 0 */
  readonly chainPatches: number;
  /** 핸들러 예외 수. M3까지 0 */
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
  readonly leaseMs: number;
  readonly leases: number;
}

export interface GroupMetricsHandle {
  /** 누적값. 순수 조회 */
  snapshot(): GroupMetrics;
}
