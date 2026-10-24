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
        const work = plans.onApprovalResolved(event);
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
