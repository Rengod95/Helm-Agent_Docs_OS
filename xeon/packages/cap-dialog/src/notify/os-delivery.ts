import { assertNever, detach, type Logger } from "@xeon/contracts";
import type { Notice, NoticeKind } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  NotifyError,
  NotifyKind,
  OsNotification,
  OsService,
  Redactor,
} from "@xeon/contracts/services";
import type { DialogSettings } from "../settings.ts";
import { clip } from "../util.ts";

// L2.dialog.spec §4.7.2. 구독으로 받은 알림을 `xeon.os`의 `notify`로 보낸다. 보낼지는 `notify.os`와 종류별 키가 정하고,
// 이 함수는 마스킹과 길이 제한만 한다. OS가 막아 전달하지 못한 것은 대화의 실패가 아니므로 운영 로그에만 남긴다.

/** 제목 길이 상한(L0.os.spec §3.7) */
const OS_TITLE_MAX = 80;
/** 본문 길이 상한(L0.os.spec §3.7) */
const OS_BODY_MAX = 400;

export interface OsDeliveryOptions {
  /** `xeon.os`. 이 함수가 쓰는 것은 `notify`뿐이다 */
  readonly os: Pick<OsService, "notify">;
  /** 대화 한 개의 유효 설정. 세션 범위를 포함하므로 알림마다 읽는다 */
  readonly settings: (threadId: ThreadId) => DialogSettings;
  /** 시크릿 마스킹. 자르기 전에 적용한다(L0.os.spec §3.7). 보내기 전에 값을 가리는 것은 호출자의 몫이다 */
  readonly redactor: Pick<Redactor, "mask">;
  readonly logger: Logger;
  /** 플러그인 수명 신호. 해제되면 보내는 중인 알림은 `cancelled`가 된다 */
  readonly signal: AbortSignal;
}

/** `NoticeFeed.subscribe`의 리스너 모양 */
export type OsDelivery = (threadId: ThreadId, notice: Notice) => void;

/** 알림 종류를 `xeon.os`의 종류로 옮긴다(§4.7.2 표) */
function osKindOf(kind: NoticeKind): NotifyKind {
  switch (kind) {
    case "completed":
    case "background_completed":
      return "done";
    case "approval_waiting":
      return "approval";
    case "question_waiting":
      return "question";
    case "error":
      return "error";
    default:
      return assertNever(kind, "NoticeKind");
  }
}

/** 보내기 결과를 운영 로그에 남긴다. 어떤 결과도 대화의 실패가 되지 않는다 */
function report(logger: Logger, threadId: ThreadId, error: NotifyError): void {
  switch (error.kind) {
    case "disabled":
      // M3 이전 빌드이거나 provider none이다. 정상 구성이라 디버그 로그만 남긴다
      logger.debug("dialog.notify_os_disabled", { threadId });
      return;
    case "unavailable":
      logger.warn("dialog.notify_os_failed", {
        reason: "unavailable",
        provider: error.provider,
        threadId,
      });
      return;
    case "failed":
      logger.warn("dialog.notify_os_failed", {
        reason: "failed",
        provider: error.provider,
        code: error.code,
        threadId,
      });
      return;
    case "cancelled":
      logger.warn("dialog.notify_os_failed", { reason: "cancelled", threadId });
      return;
    default:
      return assertNever(error, "NotifyError");
  }
}

async function send(
  os: Pick<OsService, "notify">,
  logger: Logger,
  threadId: ThreadId,
  notification: OsNotification,
  signal: AbortSignal,
): Promise<void> {
  const result = await os.notify(notification, signal);
  if (!result.ok) report(logger, threadId, result.error);
}

/**
 * 알림 하나를 OS로 보내는 리스너를 만든다. 설정이 꺼져 있으면 보내지 않는다. 같은 스레드·같은 종류의 1초 묶음은
 * 구독 전달(`NoticeFeed.subscribe`)이 이미 걸러서, 이 함수에는 묶인 뒤의 알림만 온다.
 */
export function createOsDelivery(options: OsDeliveryOptions): OsDelivery {
  const { os, settings, redactor, logger, signal } = options;
  return (threadId, notice) => {
    const current = settings(threadId);
    if (!current.notify.os || !current.notify.kinds[notice.kind]) return;
    const notification: OsNotification = {
      kind: osKindOf(notice.kind),
      title: clip(redactor.mask(notice.title).text, OS_TITLE_MAX),
      body: clip(redactor.mask(notice.body ?? "").text, OS_BODY_MAX),
      threadId,
    };
    // 기다리지 않는 호출이다. 보내기 자체가 거부되면 잡아서 로그에 남기고, 대화는 계속한다
    detach(send(os, logger, threadId, notification, signal), () => {
      logger.error("dialog.notify_os_rejected", { threadId, kind: notification.kind });
    });
  };
}
