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

/**
 * 뒤쪽 쓰기의 예산(L4.host-service.spec §4.20, review/m5/turn-record-metrics §9 29, 결정 2026-11-20 사용자, AGE-50):
 * 긴 턴(20단계, 단계당 호출 10)에서 턴당 뒤쪽 쓰기의 p95가 25 ms 이하. 다른 시나리오는 예산이 없어 판정하지 않는다
 */
const DEFERRED_TURN_BUDGET = { steps: 20, callsPerStep: 10, p95Ms: 25 } as const;

export type BudgetVerdict =
  | { readonly kind: "not_judged" }
  | { readonly kind: "within"; readonly p95Ms: number; readonly budgetMs: number }
  | { readonly kind: "over"; readonly p95Ms: number; readonly budgetMs: number };

/** 시나리오 하나의 턴당 뒤쪽 쓰기 분포를 예산에 댄다. 예산과 같은 값은 넘지 않은 것이다 */
export function judgeDeferredTurn(
  scenario: { readonly steps: number; readonly callsPerStep: number },
  deferredPerTurn: Summary,
): BudgetVerdict {
  const budget = DEFERRED_TURN_BUDGET;
  if (scenario.steps !== budget.steps || scenario.callsPerStep !== budget.callsPerStep) {
    return { kind: "not_judged" };
  }
  const kind = deferredPerTurn.p95 <= budget.p95Ms ? "within" : "over";
  return { kind, p95Ms: deferredPerTurn.p95, budgetMs: budget.p95Ms };
}

/** 판정을 사람이 읽는 한 줄로 */
export function describeVerdict(verdict: BudgetVerdict): string {
  if (verdict.kind === "not_judged") {
    return "no budget for this scenario (budget is steps=20,calls=10 only)";
  }
  const sign = verdict.kind === "within" ? "<=" : ">";
  return `${verdict.kind === "within" ? "within" : "over"} budget: deferred/turn p95 ${String(verdict.p95Ms)} ms ${sign} ${String(verdict.budgetMs)} ms`;
}
