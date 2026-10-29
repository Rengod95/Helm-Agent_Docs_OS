import type { GroupId, RecordKind, ScopeApi } from "@xeon/contracts/extensions";
import type { GroupMetricsTotals } from "./types.ts";
import type { MetricsCounter } from "./counter.ts";

/** 계측을 켜고 끄는 설정 키(L3.group-kit.spec §6). 값이 false일 때만 끈 것이다 */
export const INSTRUMENTATION_KEY = "l3.group-kit.instrumentation";

interface BoundaryRecordOptions {
  readonly groupId: GroupId;
  readonly counter: MetricsCounter;
  /** 경계마다 부른다. 설정을 읽지 못하거나 값이 없으면 참이다 */
  readonly enabled: () => boolean;
}

/** 증가분 가운데 0이 아닌 값이 하나라도 있는가 */
function hasChange(delta: GroupMetricsTotals): boolean {
  const values = [
    delta.denies,
    delta.chainPatches,
    delta.handlerErrors,
    delta.posts,
    delta.spawns,
    delta.delegates,
    delta.commits,
    delta.records,
    delta.leases,
    delta.tokens.input,
    delta.tokens.output,
    delta.tokens.cacheRead,
    delta.tokens.cacheWrite,
    delta.costUsd,
    delta.leaseMs,
  ];
  return values.some((value) => value !== 0);
}

/**
 * `boundary.settle.after`마다 마지막 기록 뒤 증가분을 `grp.<그룹>.metrics.recorded` 비공개 기록으로 쓴다(L3.group-kit.spec §4.9).
 * 기록이 성공했을 때만 기준을 옮긴다. 실패하면 다음 경계에 같은 증가분을 다시 쓴다.
 * 이 핸들러는 wrap이 setup 전에 등록하므로 같은 경계에서 그룹 핸들러가 올린 값은 다음 경계 기록에 든다.
 */
export function recordBoundaryMetrics<S>(api: ScopeApi<S>, options: BoundaryRecordOptions): void {
  const kind: RecordKind = `grp.${options.groupId}.metrics.recorded`;
  api.on("boundary.settle.after", async (payload) => {
    if (!options.enabled()) return;
    const { delta, now } = options.counter.unrecorded();
    if (!hasChange(delta)) return;
    await api.recordPrivate(kind, { stepId: payload.turnId, delta });
    options.counter.markRecorded(now);
  });
}
