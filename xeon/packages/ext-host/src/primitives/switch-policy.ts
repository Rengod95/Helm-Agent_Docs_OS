// 사용자 명령이 주도 중인 스택을 바꾸는 시점의 정책(drive-isolation.md 2.2). 이 파일 한 곳에서만 정한다.
import { assertNever } from "@fresnel/contracts";

/**
 * 사용자 답: 해당 주도만 끝내놓고 다음 스탭에 전환. 현재 주도가 맡은 일 전체가 끝난 뒤로 바꾸려면 상수만 바꾼다
 * (`task_end`). `step_boundary`는 돌고 있는 단계를 끝까지 간 뒤 그 단계 경계에서 스택 전체를 내린다.
 */
export type UserSwitchAt = "step_boundary" | "task_end";

export const USER_SWITCH_AT: UserSwitchAt = "step_boundary";

/** 사용자 명령이 들어온 순간에 맨 위 프레임이 어떤 상태인가 */
export interface SwitchSituation {
  /** 맨 위 프레임의 단계 함수가 도는 중이다(질문 대기 포함) */
  readonly running: boolean;
  /** 맨 위 프레임이 사람의 답을 기다린다 */
  readonly asking: boolean;
  /** 방금 단계 하나가 끝난 경계다 */
  readonly stepEnded: boolean;
}

/**
 * 지금 스택을 내리고 사용자 명령의 주도로 바꿔도 되는가. `step_boundary`면 단계가 끝난 경계, 실행 밖(유휴, 맡기기 대기),
 * 질문 대기에서 바꾼다. 실행 중에는 그 단계를 끊지 않는다. `task_end`면 맡은 일이 스스로 끝나 스택이 비기 전에는 바꾸지 않는다.
 */
export function shouldSwitchNow(
  situation: SwitchSituation,
  policy: UserSwitchAt = USER_SWITCH_AT,
): boolean {
  switch (policy) {
    case "step_boundary":
      return situation.stepEnded || !situation.running || situation.asking;
    case "task_end":
      return false;
    default:
      return assertNever(policy, "shouldSwitchNow");
  }
}
