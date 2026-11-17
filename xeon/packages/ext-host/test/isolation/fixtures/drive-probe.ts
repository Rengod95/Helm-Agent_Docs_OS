// 주도 동등성 시험(parity-drive.test.ts)의 관찰 자리. 단계 함수는 자기가 받은 입력을 `observe`로 넘기고, 시험이 건 관찰자가
// 엔진의 스택 읽기(`driveFrames`)와 함께 값을 적는다. 엔진 안의 단계와 격리 자식의 단계는 같은 프로세스와 같은 모듈 인스턴스에서
// 돈다(fake-process의 `runPluginHost`), 그래서 같은 자리로 모인다. 관찰은 읽기만 하고 단계의 결정을 바꾸지 않는다.
import type { DriveFrameInfo, DriveLockBudget, StepResult } from "@fresnel/contracts/extensions";

/** 단계 함수가 받은 입력 한 장. 상태는 커밋된 문서의 사본이다 */
export interface StepView {
  readonly plugin: string;
  readonly state: { readonly n: number; readonly seen: string };
  readonly last: StepResult | null;
  readonly budget: DriveLockBudget;
  readonly frame: DriveFrameInfo;
}

type Observer = (view: StepView) => void;

let observer: Observer | null = null;

/** 맡은 쪽이 실패를 내는 방식. `hang`은 끝나지 않는 단계(격리에서는 시험이 자식을 끝낸다), `throw`는 단계가 던진다 */
export type FailureMode = "hang" | "throw";

let failure: FailureMode = "throw";

/** 시험이 실패 방식을 고른다. 입력은 그대로 두고 방식만 바꿔 엔진 안과 격리의 값을 같은 입력에서 비교한다 */
export function setFailure(next: FailureMode): void {
  failure = next;
}

export function failureMode(): FailureMode {
  return failure;
}

/** 시험이 관찰자를 건다. 시험이 끝나면 `null`로 되돌린다 */
export function setObserver(next: Observer | null): void {
  observer = next;
}

/** 단계 함수가 부른다. 관찰자가 없으면 아무것도 하지 않는다 */
export function observe(view: StepView): void {
  observer?.(view);
}
