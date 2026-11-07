import type { StepId } from "@fresnel/contracts/conversation";
import type { ModelRetryEvent } from "@fresnel/contracts/services";
import type { TurnRun } from "./turn-run.ts";

// L1.models.spec §4.5의 재시도 상태 이벤트를 이 turn의 휘발 `turn.updated`(notice `provider_retry`)로 낸다.
// 알림은 사용자에게만 보이고 내구 기록과 모델 컨텍스트에 들어가지 않는다(L1.loop.spec §4.9).

/** 재시도 알림을 받는 콜백. 모델 호출 ctx(`onRetry`)와 컴팩션 요청에 같은 것을 넘긴다 */
export function providerRetryListener(
  run: TurnRun,
  stepId: StepId | null,
): (event: ModelRetryEvent) => void {
  return (event) => {
    run.emitter.emit({
      type: "turn.updated",
      threadId: run.threadId,
      turnId: run.turnId,
      stepId,
      status: "running",
      // detail은 정수다. 대기 시간은 올림한 ms로 싣는다(화면은 초로 센다)
      notice: {
        code: "provider_retry",
        detail: {
          attempt: event.attempt,
          maxRetries: event.maxRetries,
          waitMs: Math.ceil(event.waitMs),
        },
      },
    });
  };
}
