import type { OverflowRecovery } from "@xeon/contracts/services";

// L1.context.spec §4.7 오버플로우 복구.
// M1에서는 컴팩션이 없으므로(§4.7 6번) 모델 호출도 커밋도 하지 않고 fail(disabled)를 돌려준다.
// core-loop는 이 결과로 "컨텍스트 창을 넘었다"는 명확한 오류로 turn을 끝낸다. 단계당 한 번 복구는 M2다.

export function disabledOverflowRecovery(): OverflowRecovery {
  return { action: "fail", reason: "disabled" };
}
