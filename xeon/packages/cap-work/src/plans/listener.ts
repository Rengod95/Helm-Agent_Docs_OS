import { detach } from "@xeon/contracts";
import type { Logger } from "@xeon/contracts";
import type { Unsubscribe } from "@xeon/contracts/records";
import type { WorkSessionPort } from "../ports/session.ts";
import type { PlansRuntime } from "./service.ts";

// L2.work.spec §4.2.5, §7.1. 승인 해결을 내구 피드로 받아 승인된 계획이면 계획 모드를 나간다.
// 구독자는 seq로 중복을 거를 필요가 없다: 같은 이벤트를 다시 받아도 restore는 모드가 plan일 때만 바꾼다(멱등).

export interface PlanModeListener {
  stop(): void;
  /** 지금까지 받은 이벤트의 처리가 끝나기를 기다린다(시험용) */
  settled(): Promise<void>;
}

/**
 * 커밋 리스너 안에서는 새 커밋을 낼 수 없다(`store.nested_write`). 모드 복원은 `setMode`로 세션 설정을 커밋하므로 리스너가 돌아간 뒤
 * 마이크로태스크로 미룬다. 승인 서비스가 해결 커밋 직후 같은 동기 구간에서 승인자가 고른 모드(`answer.mode`)를 먼저 적용하므로,
 * 이 순서면 복원은 그 모드가 적용된 뒤의 상태를 보고 판단한다
 */
async function deferred(work: () => Promise<void>): Promise<void> {
  await Promise.resolve();
  await work();
}

/** 지금부터 커밋되는 approval.resolved를 받는다. 이미 커밋된 것은 스레드를 다시 열 때 resume이 마무리한다 */
export function startPlanModeListener(
  session: Pick<WorkSessionPort, "feed" | "subscribe">,
  plans: Pick<PlansRuntime, "onApprovalResolved">,
  logger: Logger,
): PlanModeListener | undefined {
  const head = session.feed.headSeq();
  if (!head.ok) {
    logger.warn("work.plans.listener_unavailable", { reason: head.error.kind });
    return undefined;
  }
  const running = new Set<Promise<void>>();
  const subscribed = session.subscribe(
    head.value,
    (batch) => {
      for (const event of batch.events) {
        if (event.kind !== "approval.resolved") continue;
        const work = deferred(() => plans.onApprovalResolved(event));
        running.add(work);
        detach(
          work.finally(() => {
            running.delete(work);
          }),
          (cause) => {
            logger.error("work.plans.restore_failed", {
              event: event.id,
              reason: cause instanceof Error ? cause.message : "unknown",
            });
          },
        );
      }
    },
    { kindPrefixes: ["approval.resolved"] },
  );
  if (!subscribed.ok) {
    logger.warn("work.plans.listener_unavailable", { reason: subscribed.error.kind });
    return undefined;
  }
  const unsubscribe: Unsubscribe = subscribed.value;
  return {
    stop: unsubscribe,
    async settled() {
      await Promise.allSettled(running);
    },
  };
}
