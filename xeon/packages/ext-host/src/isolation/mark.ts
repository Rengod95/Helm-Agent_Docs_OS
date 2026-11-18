// 격리 플러그인의 단계 함수 표시. 엔진 쪽 대리 등록(`proxy-entry.ts`)이 자기 단계 함수에 표시를 하고, 주도권 코드(`primitives/lease.ts`)가
// 그 등록이 격리 프로세스를 쓰는지 읽는다. 매니페스트나 등록 API에 칸을 더하지 않고(플러그인 API 변화 없음) 엔진 안에서만 쓴다.
// 격리 등록이 받는 입력은 한 줄 상한(`PLUGIN_HOST_MAX_FRAME_BYTES`) 안이어야 하므로 기록하기 전에 거절한다(X.loading-trust §4.9.3).

const isolatedSteps = new WeakSet<object>();

/** 단계 함수에 격리 표시를 하고 그대로 돌려준다 */
export function markIsolatedStep<T extends object>(step: T): T {
  isolatedSteps.add(step);
  return step;
}

export function isIsolatedStep(step: object): boolean {
  return isolatedSteps.has(step);
}
