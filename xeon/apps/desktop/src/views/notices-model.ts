import type { MessageId } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { Notice, NoticeKind } from "@fresnel/contracts/capabilities";

// 받은 요청 탭의 알림 묶음(p03-inbox)이 쓰는 순수 함수. 목록은 요청 결과이고 거울에 넣지 않는다(FS-03).

/** 화면이 들고 있는 알림 한 건. `threadId`는 `notify.delivered`가 줄 때만 알 수 있다 */
export interface NoticeEntry {
  readonly notice: Notice;
  readonly threadId: ThreadId | null;
}

/** 화면에 두는 알림 수 상한(`notify.list`의 한 번 최대 500과 별개로 오래된 것부터 버린다) */
export const NOTICE_KEEP = 100;

const KIND_TEXT: Readonly<Record<NoticeKind, MessageId>> = {
  completed: "desktop.notices.kind.completed",
  approval_waiting: "desktop.notices.kind.approvalWaiting",
  question_waiting: "desktop.notices.kind.questionWaiting",
  error: "desktop.notices.kind.error",
  background_completed: "desktop.notices.kind.backgroundCompleted",
};

export function noticeKindId(kind: NoticeKind): MessageId {
  return KIND_TEXT[kind];
}

/** 같은 seq는 한 번만 둔다(목록 읽기와 전달 알림이 겹칠 수 있다). 새것이 위로 오고 상한을 넘으면 오래된 것을 버린다 */
export function mergeNotices(
  current: readonly NoticeEntry[],
  incoming: readonly NoticeEntry[],
): readonly NoticeEntry[] {
  const seen = new Map<number, NoticeEntry>();
  for (const entry of current) seen.set(entry.notice.seq, entry);
  for (const entry of incoming) {
    const known = seen.get(entry.notice.seq);
    // 전달 알림만 대화를 안다. 목록으로 먼저 온 건에 대화를 채운다
    if (known === undefined || known.threadId === null) seen.set(entry.notice.seq, entry);
  }
  return [...seen.values()].toSorted((a, b) => b.notice.seq - a.notice.seq).slice(0, NOTICE_KEEP);
}
