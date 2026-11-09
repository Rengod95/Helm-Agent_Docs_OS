// 알림을 푸시로 바꾸는 연결(spec §6.2). 서비스가 `notify.delivered`로 알리는 알림 가운데 사용자가 응답할 차례인 것(승인, 질문),
// 턴이 끝난 것(완료), 실패한 것만 보낸다. 제목은 알림의 `title`이고(최대 120자, 스키마), 본문(`body`)은 읽지도 싣지도 않는다.
// 이 파일은 알림 원천을 인터페이스로만 받는다. 유닉스 소켓으로 `host.hello`를 거쳐 `notify.delivered`를 받는 구현은 아직 없다
// (desktop-shell은 `@fresnel/contracts`와 `@fresnel/platform-process`만 가져온다. `@fresnel/client`의 소켓 접속과 서비스 등록 경로가 필요하다).
import { detach, type Logger } from "@fresnel/contracts";
import type { PushPayload, PushSender } from "./sender.ts";

/** 푸시를 보내는 알림 종류(`NoticeKindSchema` 가운데). `background_completed`는 보내지 않는다 */
export const PUSHED_NOTICE_KINDS: readonly string[] = [
  "approval_waiting",
  "question_waiting",
  "completed",
  "error",
];

/** 원천이 알려 주는 알림의 푸시에 필요한 부분 */
export interface PushableNotice {
  readonly kind: string;
  /** 알림 제목(1~120자). 비어 있으면 앱 이름으로 바꾼다 */
  readonly title: string;
  /** 알림이 속한 대화. 대화 밖 알림이면 null */
  readonly threadId: string | null;
}

/** 알림이 올 때마다 `callback`을 부르는 원천. 서비스 연결이 구현하고, 시험은 가짜를 넣는다 */
export interface NoticeSource {
  onNotice(callback: (notice: PushableNotice) => void): () => void;
}

const APP_NAME = "Fresnel";

function titleOf(title: string): string {
  const trimmed = title.trim();
  return trimmed === "" ? APP_NAME : trimmed;
}

/** 원천의 알림을 푸시로 보낸다. 해제 함수를 돌려준다. 발송 실패는 기록만 남기고 원천을 멈추지 않는다 */
export function startNoticePush(options: {
  readonly source: NoticeSource;
  readonly sender: PushSender;
  readonly logger: Logger;
  /** 기본은 `PUSHED_NOTICE_KINDS` */
  readonly kinds?: readonly string[];
}): () => void {
  const kinds = new Set(options.kinds ?? PUSHED_NOTICE_KINDS);
  return options.source.onNotice((notice) => {
    if (!kinds.has(notice.kind)) return;
    const payload: PushPayload = { title: titleOf(notice.title), threadId: notice.threadId };
    detach(options.sender.send(payload), () => {
      options.logger.error("push.notice_send_failed", { kind: notice.kind });
    });
  });
}
