import { assertNever, attempt, parse } from "@xeon/contracts";
import {
  DialogNotify,
  NotifyEmitInput,
  NotifyListInput,
  type CapabilityApi,
  type Notice,
  type NoticeFeed,
  type NoticeKind,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, StoreError } from "@xeon/contracts/records";
import type { DialogDeps } from "../deps.ts";
import { DialogFailure, guarded } from "../errors.ts";
import type { NoticeEmitFailure, NoticePort, NoticeReadFilter } from "../ports/notices.ts";
import { classifyNotice } from "./classify.ts";

// L2.dialog.spec §3.6, §4.7. `dialog.notify`의 emit(내구 기록), list(당겨 읽기), 구독(같은 프로세스 밀어주기)을 구현한다.
// 알림은 원인 내구 이벤트에서 `classifyNotice`로 계산한다. emit만 `dialog.notified`를 새로 남긴다.
// 구독자에게는 피드의 이벤트마다 한 번 계산한 알림을 보내며, 같은 스레드·같은 종류는 1초 안에 한 번만 보낸다.
// list는 묶음과 무관하게 모든 알림을 돌려준다. OS 전달은 다음 단위다(D11).

type NotifyApi = CapabilityApi<typeof DialogNotify> & NoticeFeed;

const CAPABILITY = DialogNotify.id;

/** 같은 스레드·같은 종류의 알림은 이 시간 안에 한 번만 구독자에게 보낸다(spec §5 10번) [결정: 오케스트레이터 기본값] */
export const NOTICE_COALESCE_MS = 1000;
/** list의 기본 개수. 상한 500은 입력 스키마가 막는다(spec §3.6) */
export const LIST_DEFAULT_LIMIT = 100;
/** list 한 번의 읽기 크기와 읽기 횟수. 곱이 한 호출이 훑는 행의 상한이라 긴 로그에서도 호출이 끝난다 */
const SCAN_BATCH = 200;
const SCAN_ROUNDS = 5;

export interface NotifyService {
  readonly api: NotifyApi;
  /** 내구 이벤트 피드의 이벤트 하나를 알림으로 바꿔 구독자에게 보낸다. 이미 본 seq 이하는 무시한다 */
  readonly onEvent: (event: DurableEventEnvelope) => void;
  readonly dispose: () => void;
}

interface Subscription {
  readonly kinds: ReadonlySet<NoticeKind> | undefined;
  readonly listener: (threadId: ThreadId, notice: Notice) => void;
}

function storeFailure(error: StoreError): DialogFailure {
  return new DialogFailure("unavailable", `The session store failed (${error.kind}).`, {
    retryable: error.kind === "busy",
    detail: { by: "session", reason: error.kind },
  });
}

function emitFailure(failure: NoticeEmitFailure): DialogFailure {
  switch (failure.kind) {
    case "key_reused":
      // 같은 requestId로 다른 알림을 보냈다. 호출자의 버그다(spec §5 3번)
      return new DialogFailure("internal", "The requestId was already used for another notice.", {
        detail: { by: "session", reason: "key_reused" },
      });
    case "rejected":
      return new DialogFailure("internal", "The session rejected the notice.", {
        detail: { by: "session", code: failure.code },
      });
    case "store":
      return storeFailure(failure.error);
    default:
      return assertNever(failure, "NoticeEmitFailure");
  }
}

function requireNotices(deps: DialogDeps): NoticePort {
  if (deps.notices === undefined) {
    throw new DialogFailure("unavailable", "The notice store is not available.", {
      detail: { by: "session", reason: "session_missing" },
    });
  }
  return deps.notices;
}

/**
 * afterSeq 뒤를 읽어 알림으로 바꾼다. 개수가 차면 그 알림의 seq에서 멈추고(다음 호출이 나머지를 다시 본다),
 * 아니면 훑은 마지막 seq를 돌려준다. 훑을 것이 없으면 afterSeq다.
 */
function scanNotices(
  port: NoticePort,
  afterSeq: number,
  query: {
    readonly threadId: ThreadId | undefined;
    readonly limit: number;
    readonly kinds: ReadonlySet<NoticeKind> | undefined;
  },
): { readonly notices: Notice[]; readonly nextSeq: number } {
  const filter: NoticeReadFilter =
    query.threadId === undefined
      ? { limit: SCAN_BATCH, scanLimit: SCAN_BATCH }
      : { threadId: query.threadId, limit: SCAN_BATCH, scanLimit: SCAN_BATCH };
  const notices: Notice[] = [];
  let cursor = afterSeq;
  for (let round = 0; round < SCAN_ROUNDS; round += 1) {
    const page = port.read(cursor, filter);
    if (!page.ok) throw storeFailure(page.error);
    if (page.value.events.length === 0 && page.value.scannedTo === cursor) break;
    for (const event of page.value.events) {
      cursor = event.seq;
      const notice = classifyNotice(event);
      if (notice === null) continue;
      if (query.kinds !== undefined && !query.kinds.has(notice.kind)) continue;
      notices.push(notice);
      if (notices.length === query.limit) return { notices, nextSeq: cursor };
    }
    cursor = page.value.scannedTo;
  }
  return { notices, nextSeq: cursor };
}

export function createNotifyService(deps: DialogDeps): NotifyService {
  const subscriptions = new Set<Subscription>();
  /** `${threadId} ${kind}` → 마지막으로 구독자에게 보낸 시각(ms). 창을 지난 항목은 알림이 올 때 지운다 */
  const lastDelivered = new Map<string, number>();
  let watermark = 0;

  const api: NotifyApi = {
    emit: (input, options) =>
      guarded(CAPABILITY, "emit", () => {
        const threadId = options?.context?.threadId;
        if (threadId === undefined) {
          throw new DialogFailure(
            "invalid_input",
            "emit needs a thread: the call context has no threadId.",
          );
        }
        const parsed = parse(NotifyEmitInput, input);
        if (!parsed.ok) {
          throw new DialogFailure("invalid_input", "The notice does not match the schema.");
        }
        const port = requireNotices(deps);
        const { kind, title, origin, body } = parsed.value;
        const written = port.emit(
          threadId,
          { kind, title, body: body ?? null, origin },
          options?.requestId,
        );
        if (!written.ok) throw emitFailure(written.error);
        // 구독자에게는 커밋 뒤 피드가 onEvent로 알린다. 여기서는 기록된 이벤트를 같은 분류로 바꿔 돌려준다
        const notice = classifyNotice(written.value);
        if (notice === null) {
          throw new DialogFailure("internal", "The committed notice does not classify.");
        }
        return Promise.resolve({ notice });
      }),
    list: (input, options) =>
      guarded(CAPABILITY, "list", () => {
        const parsed = parse(NotifyListInput, input);
        if (!parsed.ok) {
          throw new DialogFailure("invalid_input", "The list input does not match the schema.");
        }
        const port = requireNotices(deps);
        const { notices, nextSeq } = scanNotices(port, parsed.value.afterSeq, {
          threadId: options?.context?.threadId,
          limit: parsed.value.limit ?? LIST_DEFAULT_LIMIT,
          kinds: parsed.value.kinds === undefined ? undefined : new Set(parsed.value.kinds),
        });
        return Promise.resolve({ notices, nextSeq });
      }),
    subscribe: (filter, listener) => {
      const subscription: Subscription = {
        kinds: filter.kinds === undefined ? undefined : new Set(filter.kinds),
        listener,
      };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
  };

  return {
    api,
    onEvent: (event) => {
      if (event.seq <= watermark) return;
      watermark = event.seq;
      const notice = classifyNotice(event);
      if (notice === null) return;
      const now = deps.timers.clock.now();
      for (const [key, at] of lastDelivered) {
        if (now - at >= NOTICE_COALESCE_MS) lastDelivered.delete(key);
      }
      const key = `${event.threadId} ${notice.kind}`;
      // 남아 있는 항목은 창 안에서 이미 보낸 것이다. 묶인 알림은 시각을 갱신하지 않는다
      if (lastDelivered.has(key)) return;
      lastDelivered.set(key, now);
      for (const subscription of subscriptions) {
        if (subscription.kinds !== undefined && !subscription.kinds.has(notice.kind)) continue;
        // 구독자의 실패가 피드 커밋 경로를 끊지 않게 한다. 실패는 로그에 남긴다
        const delivered = attempt(() => {
          subscription.listener(event.threadId, notice);
        });
        if (!delivered.ok) {
          deps.logger.error("dialog.notify_listener_failed", {
            threadId: event.threadId,
            kind: notice.kind,
            seq: event.seq,
          });
        }
      }
    },
    dispose: () => {
      subscriptions.clear();
      lastDelivered.clear();
    },
  };
}
