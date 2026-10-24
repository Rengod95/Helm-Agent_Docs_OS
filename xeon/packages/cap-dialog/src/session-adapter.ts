import type { Logger } from "@xeon/contracts";
import type { StatusItem } from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { SessionService, VolatileEventEnvelope } from "@xeon/contracts/records";
import type { OsTime } from "@xeon/contracts/services";
import type { DialogFeed, StatusPublisher } from "./ports/session.ts";

// `xeon.session`을 이 패키지의 좁은 포트(DialogFeed, StatusPublisher)로 감싼다.

const FEED_KIND_PREFIXES = ["turn.", "approval."] as const;

/**
 * 내구 이벤트 피드. 구독한 뒤 커밋되는 `turn.*`, `approval.*`만 받는다. 구독 전 이벤트(재시작 전의 누적 사용량 등)는
 * 따라잡지 않는다: 따라잡기는 로그 전체를 읽는 일이라 정책이 필요하다 [미결: 상태줄 core.usage의 재시작 뒤 복원].
 */
export function sessionFeed(
  session: Pick<SessionService, "feed" | "subscribe">,
  logger: Logger,
): DialogFeed {
  return {
    subscribe(listener) {
      const head = session.feed.headSeq();
      if (!head.ok) {
        logger.warn("dialog.feed_unavailable", { reason: head.error.kind });
        return () => undefined;
      }
      const subscribed = session.subscribe(
        head.value,
        (batch) => {
          for (const event of batch.events) listener(event);
        },
        { kindPrefixes: FEED_KIND_PREFIXES },
      );
      if (!subscribed.ok) {
        logger.warn("dialog.feed_unavailable", { reason: subscribed.error.kind });
        return () => undefined;
      }
      return subscribed.value;
    },
  };
}

/** `dialog.status` 휘발 이벤트를 `xeon.session`으로 내보낸다. 읽기에 실패하면 이 이벤트는 건너뛴다(최선 노력) */
export function sessionStatusPublisher(
  session: Pick<SessionService, "feed" | "emitVolatile">,
  ids: IdFactory,
  time: Pick<OsTime, "clock">,
  logger: Logger,
): StatusPublisher {
  const counters = new Map<ThreadId, number>();
  return {
    publish(threadId: ThreadId, items: readonly StatusItem[]) {
      const head = session.feed.headSeq();
      if (!head.ok) {
        logger.warn("dialog.status_dropped", { threadId, reason: head.error.kind });
        return;
      }
      const n = counters.get(threadId) ?? 0;
      counters.set(threadId, n + 1);
      const envelope: VolatileEventEnvelope = {
        id: ids.next("evt"),
        kind: "dialog.status",
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        recordedAt: time.clock.now(),
        causationId: null,
        correlationId: null,
        payload: { threadId, items: [...items] },
        durable: false,
        n,
        afterSeq: head.value,
      };
      session.emitVolatile(envelope);
    },
  };
}
