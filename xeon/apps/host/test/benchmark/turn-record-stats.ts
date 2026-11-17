// 턴 기록 벤치의 순수 계산. 분위수는 `scripts/benchmark.ts`와 같은 최근접 순위를 쓴다(정렬한 n개에서 p%는 ceil(p·n/100)번째 값).
import { Bug } from "@fresnel/contracts";

export interface Summary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** 정렬된 값에서 최근접 순위 분위수. 빈 값은 호출자의 버그다 */
function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Bug("turn-record bench: percentile of no samples");
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p * sorted.length) / 100)));
  const value = sorted[rank - 1];
  if (value === undefined) throw new Bug("turn-record bench: percentile rank out of range");
  return value;
}

/** 소수 셋째 자리까지 남긴다 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 표본의 p50, p95, 최댓값 */
export function summarize(samples: readonly number[]): Summary {
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    n: sorted.length,
    p50: round(percentileOf(sorted, 50)),
    p95: round(percentileOf(sorted, 95)),
    max: round(percentileOf(sorted, 100)),
  };
}

/** 더 돌지 정한다. 목표 개수에 닿았거나 마감 시각을 넘기면 멈춘다 */
export function keepGoing(
  measured: number,
  target: number,
  nowMs: number,
  deadlineMs: number,
): boolean {
  return measured < target && nowMs < deadlineMs;
}
