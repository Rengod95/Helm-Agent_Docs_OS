import { assertNever, Bug, err, ok, type Logger } from "@xeon/contracts";
import type { StatusItem } from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  type FeedFilter,
  type ProducerHandle,
  type SessionService,
  type VolatileEventEnvelope,
} from "@xeon/contracts/records";
import type { OsTime } from "@xeon/contracts/services";
import { sha256Hex } from "./hash.ts";
import type { NoticePort } from "./ports/notices.ts";
import type { DialogFeed, StatusPublisher } from "./ports/session.ts";

// `xeon.session`을 이 패키지의 좁은 포트(DialogFeed, StatusPublisher, NoticePort)로 감싼다.

/** 피드가 거르는 내구 이벤트 접두. 상태줄(turn., approval.)과 알림 분류(work., agent., schedule.)의 원인 종류다 */
const FEED_KIND_PREFIXES = [
  "turn.",
  "approval.",
  "work.",
  "agent.",
  "schedule.",
  "dialog.",
] as const;

/**
 * 내구 이벤트 피드. 구독한 뒤 커밋되는 `FEED_KIND_PREFIXES` 접두의 이벤트만 받는다. 구독 전 이벤트(재시작 전의 누적 사용량 등)는
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

/**
 * `dialog.notified`를 `xeon.session` 커밋으로 남기고 원인 이벤트를 피드에서 읽는다(L2.dialog.spec §3.7, §4.7).
 * 커밋 키는 `dialog:notify:<requestId>`다. requestId가 없으면 고유한 토막을 써서 멱등을 걸지 않는다.
 * producer 핸들은 플러그인 setup에서 한 번 받아 넘긴다.
 */
export function sessionNoticePort(
  session: Pick<SessionService, "commit" | "feed">,
  producer: ProducerHandle,
  ids: IdFactory,
  logger: Logger,
): NoticePort {
  return {
    emit(threadId, record, requestId) {
      const token = requestId ?? ids.next("evt");
      const committed = session.commit({
        threadId,
        requestId: `dialog:notify:${commitKeyPart(token, sha256Hex)}`,
        fingerprintSource: {
          threadId,
          kind: record.kind,
          title: record.title,
          body: record.body,
          origin: record.origin,
        },
        build: () => ({
          kind: "append",
          drafts: [
            producer.draft({
              id: ids.next("evt"),
              kind: "dialog.notified",
              threadId,
              turnId: null,
              stepId: null,
              causationId: null,
              correlationId: null,
              payload: {
                notice: {
                  kind: record.kind,
                  title: record.title,
                  body: record.body,
                  origin: record.origin,
                },
              },
            }),
          ],
          checkpoint: null,
        }),
      });
      if (!committed.ok) return err({ kind: "store", error: committed.error });
      const result = committed.value;
      switch (result.status) {
        case "key_reused":
          logger.error("dialog.notify_key_reused", { requestId: token });
          return err({ kind: "key_reused", requestId: token });
        case "rejected":
          return err({ kind: "rejected", code: result.code });
        case "committed": {
          // 재전송된 커밋(같은 requestId)도 처음 기록된 seq를 돌려주므로 같은 이벤트를 읽는다
          const read = session.feed.read(
            result.firstSeq - 1,
            result.lastSeq,
            { threadIds: [threadId], kindPrefixes: ["dialog."] },
            1,
            1,
          );
          if (!read.ok) return err({ kind: "store", error: read.error });
          const [event] = read.value.events;
          if (event === undefined) {
            throw new Bug(
              `dialog.notified was committed at seq ${String(result.lastSeq)} but cannot be read back.`,
            );
          }
          return ok(event);
        }
        default:
          return assertNever(result, "CommitResult");
      }
    },
    read(afterSeq, query) {
      const head = session.feed.headSeq();
      if (!head.ok) return err(head.error);
      if (head.value <= afterSeq) return ok({ events: [], scannedTo: afterSeq });
      const feedFilter: FeedFilter =
        query.threadId === undefined
          ? { kindPrefixes: FEED_KIND_PREFIXES }
          : { threadIds: [query.threadId], kindPrefixes: FEED_KIND_PREFIXES };
      const page = session.feed.read(
        afterSeq,
        head.value,
        feedFilter,
        query.limit,
        query.scanLimit,
      );
      if (!page.ok) return err(page.error);
      return ok({ events: page.value.events, scannedTo: page.value.scannedTo });
    },
  };
}
