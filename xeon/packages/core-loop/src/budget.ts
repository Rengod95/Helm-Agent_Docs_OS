// L1.loop.spec §4.7 예산(pi 방식). 기본 단계·비용 상한이 없고, 단계 상한은 `l1.loop.maxSteps`, drive turn 신호,
// 자식 한도에서만 온다. 토큰 상한은 X가 `loop.turn` 호출 사이에서 검사한다.

export interface StepBudget {
  /** turn당 최대 단계. 0이면 상한 없음 */
  readonly maxSteps: number;
}

/** 이 turn의 완료 단계 수가 상한에 이르렀는가 */
export function stepLimitReached(budget: StepBudget, completedSteps: number): boolean {
  return budget.maxSteps > 0 && completedSteps >= budget.maxSteps;
}

/** 이번 단계가 마지막 허용 단계인지 판정하는 입력 */
export interface ContinueInputs {
  /** 마지막 어시스턴트 stopReason이 error 또는 aborted */
  readonly hardStop: boolean;
  /** turn에 취소 의도가 있다 */
  readonly abortRequested: boolean;
  /** `maxSteps`에 이르렀다 */
  readonly stepLimit: boolean;
  /** drive turn 신호(또는 자식 한도)가 켜졌다 */
  readonly externalStop: boolean;
  /** `stopAtSafeBoundary`가 진행 중이다 */
  readonly stopping: boolean;
  /** 게이트 계속이 상한에 이르렀다 */
  readonly gateExhausted: boolean;
}

/** L1.loop.spec §4.9 `canContinue`: 하나라도 참이면 boundary의 `continue`를 따르지 않는다 */
export function canContinue(inputs: ContinueInputs): boolean {
  return !(
    inputs.hardStop ||
    inputs.abortRequested ||
    inputs.stepLimit ||
    inputs.externalStop ||
    inputs.stopping ||
    inputs.gateExhausted
  );
}
