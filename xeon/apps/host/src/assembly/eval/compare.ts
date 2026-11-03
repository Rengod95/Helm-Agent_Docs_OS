// T-TEST-AB. 켬/끔 비교의 판정(기획서 §6 "켬/끔 비교의 판정"). 같은 케이스를 두 프로필로 돌리고 케이스별로 짝지어 비교한다.
// 판정은 좋아짐, 나빠짐, 구분 안 됨 셋이고 기준은 정확 부호 검정(양측 5%)이다. 실행은 이 모듈이 하지 않는다. 케이스마다 반복별 통과 여부를 받는다.

type Verdict = "improved" | "regressed" | "indistinguishable";

/** 케이스 하나의 반복별 통과 여부. `a`는 기준(끔), `b`는 바꾼 쪽(켬)이다 */
export interface CasePair {
  readonly id: string;
  readonly a: readonly boolean[];
  readonly b: readonly boolean[];
}

export interface Comparison {
  /** `b`가 나은 케이스 수 */
  readonly better: number;
  /** `a`가 나은 케이스 수 */
  readonly worse: number;
  /** 통과 횟수가 같은 케이스 수(부호 검정에서 뺀다) */
  readonly same: number;
  readonly cases: number;
  /** 양측 정확 부호 검정 p값. 차이가 난 케이스가 없으면 1이다 */
  readonly pValue: number;
  readonly verdict: Verdict;
}

const SIGNIFICANCE = 0.05;

/** 이항 분포 Binomial(n, 1/2)에서 X ≤ k일 확률. 로그 없이 정수 조합을 누적해 계산한다(n은 케이스 수라 작다) */
function binomialCdfHalf(n: number, k: number): number {
  let choose = 1;
  let sum = 0;
  for (let i = 0; i <= k; i += 1) {
    sum += choose;
    choose = (choose * (n - i)) / (i + 1);
  }
  return sum / 2 ** n;
}

/** 정확 부호 검정(양측). `better`와 `worse`는 차이가 난 케이스 수다 */
export function exactSignTest(better: number, worse: number): number {
  const n = better + worse;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomialCdfHalf(n, Math.min(better, worse)));
}

function passes(runs: readonly boolean[]): number {
  return runs.filter(Boolean).length;
}

/** 케이스별 통과 횟수를 견줘 판정한다. 반복 수가 달라도 통과 횟수로 비교하므로 두 쪽의 반복 수는 같아야 한다 */
export function compareRuns(pairs: readonly CasePair[]): Comparison {
  let better = 0;
  let worse = 0;
  let same = 0;
  for (const pair of pairs) {
    const delta = passes(pair.b) - passes(pair.a);
    if (delta > 0) better += 1;
    else if (delta < 0) worse += 1;
    else same += 1;
  }
  const pValue = exactSignTest(better, worse);
  const significant = pValue <= SIGNIFICANCE;
  const verdict: Verdict = !significant
    ? "indistinguishable"
    : better > worse
      ? "improved"
      : "regressed";
  return { better, worse, same, cases: pairs.length, pValue, verdict };
}

/**
 * 같은 프로필끼리 비교(A/A)가 "구분 안 됨"이 아니면 이 케이스 묶음과 모델의 변동이 판정 기준을 넘는다는 뜻이다.
 * 그때의 켬/끔 판정은 믿지 않는다. 모델이나 케이스가 바뀔 때까지 결과를 재사용한다
 */
export function isNoisy(aa: Comparison): boolean {
  return aa.verdict !== "indistinguishable";
}

export interface RunPlan {
  /** 켬/끔 비교의 실행 수: 케이스 × 반복 × 양쪽 */
  readonly comparisonRuns: number;
  /** 변동폭(A/A)을 처음 재는 데 더 드는 실행 수: 케이스 × 반복(기준 쪽 실행은 비교와 같은 것을 쓴다) */
  readonly aaRuns: number;
  readonly totalRuns: number;
  /** 시작 전 확인 창에 보일 비용 범위(USD). 한 번 비용의 낮은 값과 높은 값은 호출자가 작업 몇 개로 재서 넘긴다 */
  readonly costUsd: { readonly low: number; readonly high: number };
}

/** 실행 전에 보일 예상 실행 수와 비용 범위. 기본은 케이스 20개 × 반복 3회 × 양쪽 = 120회, A/A 60회 추가다 */
export function planRuns(input: {
  readonly cases: number;
  readonly repeats: number;
  readonly needsAA: boolean;
  readonly perRunUsd: { readonly low: number; readonly high: number };
}): RunPlan {
  const comparisonRuns = input.cases * input.repeats * 2;
  const aaRuns = input.needsAA ? input.cases * input.repeats : 0;
  const totalRuns = comparisonRuns + aaRuns;
  return {
    comparisonRuns,
    aaRuns,
    totalRuns,
    costUsd: { low: totalRuns * input.perRunUsd.low, high: totalRuns * input.perRunUsd.high },
  };
}
