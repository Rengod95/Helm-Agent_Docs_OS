// 격리 플러그인의 단계 함수 표시. 엔진 쪽 대리 등록(`proxy-entry.ts`)이 자기 단계 함수에 표시를 하고, 주도권 코드(`primitives/lease.ts`)가
// 그 등록이 격리 프로세스를 쓰는지와 입력의 상한을 읽는다. 매니페스트나 등록 API에 칸을 더하지 않고(플러그인 API 변화 없음) 엔진 안에서만 쓴다.
// 상한은 등록마다 다르다: 협상된 조각 상한이 있으면 그것, 없으면 한 줄 상한이다(X.loading-trust §4.9.3). 값은 읽을 때마다 새로 구한다.

const isolatedSteps = new WeakMap<object, () => number>();

/** 단계 함수에 격리 표시와 입력 상한(바이트)을 달고 그대로 돌려준다. `inputLimit`은 기록 직전마다 불린다 */
export function markIsolatedStep<T extends object>(step: T, inputLimit: () => number): T {
  isolatedSteps.set(step, inputLimit);
  return step;
}

/** 격리 단계 함수의 입력 상한을 읽는 함수. 격리 표시가 없으면 undefined다 */
export function isolatedInputLimit(step: object): (() => number) | undefined {
  return isolatedSteps.get(step);
}
