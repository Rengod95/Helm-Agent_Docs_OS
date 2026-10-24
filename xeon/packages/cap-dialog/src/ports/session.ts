import type { StatusItem } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { Unsubscribe } from "@xeon/contracts/extensions";
import type { DurableEventEnvelope } from "@xeon/contracts/records";

/** `dialog.status` 휘발 이벤트를 내보낸다. 저장하지 않는다(L2.dialog.spec §3.7). 최대 32개가 전체 스냅숏이다 */
export interface StatusPublisher {
  publish(threadId: ThreadId, items: readonly StatusItem[]): void;
}

/**
 * 내구 이벤트 피드 구독. 구독 이후 커밋되는 `turn.*`, `approval.*`를 받는다. 구독자는 `seq`로 중복을 거른다(EV-05).
 * 구독 전 이벤트를 따라잡는 정책(처음부터, 현재 머리부터)은 어댑터가 정한다.
 */
export interface DialogFeed {
  subscribe(listener: (event: DurableEventEnvelope) => void): Unsubscribe;
}
