// 계측 링 버퍼의 핸들러 실행 기록을 훅별 시간 분포(ExtHookTiming, X-6)로 바꾼다(X.operations.spec §4.8.4). 순수 함수다.
import { Bug } from "@fresnel/contracts";
import type { ExtHookTiming, TraceHandlerResult } from "@fresnel/contracts/extensions";

/** 핸들러 실행 한 번의 기록. 버퍼 항목 하나를 펼친 모양이다 */
export interface HandlerRun {
  readonly hook: string;
  readonly registrationId: string;
  /** 활성 시간(ms). 사용자 응답 대기는 뺀다. 예산 초과는 예산 값이다(§4.8.2) */
  readonly ms: number;
  readonly result: TraceHandlerResult;
}

/** 거르기 조건. 없는 조건은 모든 값을 받는다 */
export interface TimingFilter {
  readonly hook?: string;
  readonly registrationId?: string;
}

/** 실패로 세는 결과. 막음(blocked)과 건너뜀(skipped)은 실패가 아니다(§4.8.4) */
const FAILURE_RESULTS: ReadonlySet<TraceHandlerResult> = new Set<TraceHandlerResult>(["failed"]);

interface Group {
  readonly hook: string;
  readonly registrationId: string;
  readonly values: number[];
  failures: number;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function valueAt(sorted: readonly number[], index: number): number {
  const value = sorted[index];
  if (value === undefined) {
    throw new Bug(
      `handler-timings: index ${String(index)} is outside ${String(sorted.length)} samples`,
    );
  }
  return value;
}

/** 오름차순으로 정렬된 비어 있지 않은 값에서 p퍼센트 최근접 순위 값. 순위는 ceil(p·n/100)번째다(1부터 센다) */
function nearestRank(sorted: readonly number[], percent: number): number {
  return valueAt(sorted, Math.ceil((percent * sorted.length) / 100) - 1);
}

function toTiming(group: Group): ExtHookTiming {
  const sorted = group.values.toSorted((a, b) => a - b);
  return {
    hook: group.hook,
    registrationId: group.registrationId,
    count: sorted.length,
    p50Ms: nearestRank(sorted, 50),
    p95Ms: nearestRank(sorted, 95),
    maxMs: valueAt(sorted, sorted.length - 1),
    failures: group.failures,
  };
}

/**
 * 실행 기록을 (hook, registrationId)별로 모아 분포를 만든다. 결과는 hook, 그다음 registrationId의 문자 순서다.
 * count는 기록 수(skipped 포함), p50Ms·p95Ms는 최근접 순위, maxMs는 최댓값, failures는 failed의 수다.
 */
export function timingsOf(
  runs: Iterable<HandlerRun>,
  filter: TimingFilter,
): readonly ExtHookTiming[] {
  const groups = new Map<string, Group>();
  for (const run of runs) {
    if (filter.hook !== undefined && run.hook !== filter.hook) continue;
    if (filter.registrationId !== undefined && run.registrationId !== filter.registrationId) {
      continue;
    }
    const key = JSON.stringify([run.hook, run.registrationId]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { hook: run.hook, registrationId: run.registrationId, values: [], failures: 0 };
      groups.set(key, group);
    }
    group.values.push(run.ms);
    if (FAILURE_RESULTS.has(run.result)) group.failures += 1;
  }
  return [...groups.values()]
    .toSorted(
      (a, b) => compareText(a.hook, b.hook) || compareText(a.registrationId, b.registrationId),
    )
    .map(toTiming);
}
