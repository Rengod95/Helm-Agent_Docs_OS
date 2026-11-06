import type { MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { INPUT_NEEDED_KINDS, type Notice, type NoticeKind } from "@fresnel/contracts/capabilities";

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

/**
 * 알림 제목을 앱 말투로 바꿀 카탈로그 키. 알림 원문은 엔진이 반말로 만들어 OS 알림과 CLI도 쓰므로 원문은 두고
 * 이 앱의 토스트와 목록에서만 바꾼다. 종류와 출처 이벤트로 고르고 원문 문장은 비교하지 않는다. 못 고르면 null이라 원문 그대로다
 */
export type NoticeTitleView = {
  readonly id: MessageId;
  readonly params?: { readonly tool: string };
};

/** 승인 알림 원문은 "<말>: <도구 이름>"이다. 콜론 뒤를 도구 이름으로 읽고, 말 자체는 보지 않는다 */
const TOOL_SEPARATOR = ": ";

export function noticeTitleViewOf(notice: Notice): NoticeTitleView | null {
  switch (notice.kind) {
    case "completed":
      return { id: "desktop.notices.title.completed" };
    case "question_waiting":
      return { id: "desktop.notices.title.question" };
    case "approval_waiting": {
      const at = notice.title.indexOf(TOOL_SEPARATOR);
      if (at < 0) return null;
      const tool = notice.title.slice(at + TOOL_SEPARATOR.length);
      return tool === "plan"
        ? { id: "desktop.notices.title.approvalPlan" }
        : { id: "desktop.notices.title.approvalTool", params: { tool } };
    }
    case "background_completed":
      return notice.sourceType === "schedule.run_finished"
        ? { id: "desktop.notices.title.scheduleCompleted" }
        : { id: "desktop.notices.title.backgroundCompleted" };
    case "error":
      if (notice.sourceType === "turn.completed") return { id: "desktop.notices.title.turnFailed" };
      if (notice.sourceType === "agent.settled") {
        return { id: "desktop.notices.title.backgroundFailed" };
      }
      if (notice.sourceType === "schedule.run_finished") {
        return { id: "desktop.notices.title.scheduleFailed" };
      }
      return null;
    default:
      return assertNever(notice.kind, "noticeTitleViewOf");
  }
}

/**
 * 이 알림을 화면 토스트로도 알리나. 새 승인 요청은 낭독 영역(`live-announcer.tsx`)이 이미 읽고, 토스트 영역과 토스트 자체도 낭독 영역이라
 * 같은 문장이 세 번 읽힌다. 승인 알림은 목록과 OS 알림, 대화의 승인 카드와 사이드바 승인 수로 알리고 토스트는 띄우지 않는다
 */
export function noticeToastVisible(notice: Notice): boolean {
  return notice.kind !== "approval_waiting";
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

/** 알림 목록은 알림의 대화를 싣지 않는다. 대화별로 읽은 목록에서 알림 seq(DB 전역 단조)를 대화로 잇는다. 같은 seq가 둘이면 먼저 온 것이 이긴다 */
export function threadBySeqOf(
  reads: readonly { readonly threadId: ThreadId; readonly notices: readonly Notice[] }[],
): ReadonlyMap<number, ThreadId> {
  const found = new Map<number, ThreadId>();
  for (const read of reads) {
    for (const notice of read.notices) {
      if (!found.has(notice.seq)) found.set(notice.seq, read.threadId);
    }
  }
  return found;
}

/**
 * 사용자의 답을 기다리던 알림(승인·질문 대기)이 이미 풀렸나. 알림은 요청 id를 싣지 않아 대화 단위로 본다:
 * 알림의 대화가 알려져 있고 그 대화에 지금 기다리는 승인이 없으면 풀린 것이다. 대화를 모르면 풀렸다고 하지 않는다
 */
export function noticeResolved(entry: NoticeEntry, waitingThreads: ReadonlySet<string>): boolean {
  if (!INPUT_NEEDED_KINDS.includes(entry.notice.kind)) return false;
  return entry.threadId !== null && !waitingThreads.has(entry.threadId);
}
