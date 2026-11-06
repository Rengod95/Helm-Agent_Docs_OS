import type { EventId, ThreadId } from "@fresnel/contracts/conversation";

// 받은 요청 화면 머리의 대화·정렬 셀렉트가 고르는 값과, 승인 목록을 거르고 정렬하는 순수 함수(시안 p03).
// 거르기와 정렬은 승인 구역만 본다. 알림 구역은 거르지 않는다(notices.tsx).

/** 대화 셀렉트의 값. `all`이면 모든 대화다 */
export type InboxThread = "all" | ThreadId;

/** 정렬 셀렉트의 값. 요청 시각 기준이고 `oldest`가 기본이다 */
export type InboxSort = "oldest" | "newest";

export const INBOX_SORTS: readonly InboxSort[] = ["oldest", "newest"];

/** 거울의 승인 한 장에서 거르기와 정렬에 쓰는 곳만 읽는 모양(PendingApproval의 부분) */
export type InboxSource = {
  readonly threadId: ThreadId;
  readonly request: { readonly requestedAt: number };
};

/** 대기열 승인 한 장의 대화와 요청 시각. 대기열 순서(`ids`)를 지킨다 */
export type InboxRow = {
  readonly id: EventId;
  readonly threadId: ThreadId;
  readonly requestedAt: number;
};

/** 대기열 id마다 대화와 요청 시각을 모은다. 거울에 기록이 없는 id는 건너뛴다 */
export function inboxRowsOf(
  ids: readonly EventId[],
  byId: Readonly<Record<string, InboxSource>>,
): readonly InboxRow[] {
  return ids.flatMap((id) => {
    const source = byId[id];
    if (source === undefined) return [];
    return [{ id, threadId: source.threadId, requestedAt: source.request.requestedAt }];
  });
}

/** 대기 승인이 있는 대화를 승인 순서대로 한 번씩 모은다. 대화 셀렉트의 항목이다 */
export function inboxThreadIdsOf(rows: readonly InboxRow[]): readonly ThreadId[] {
  return [...new Set(rows.map((row) => row.threadId))];
}

/** 고른 대화가 아직 대기 승인이 있는 대화면 그대로, 아니면 `all`이다. 없어진 대화를 고른 채 빈 목록을 보이지 않게 한다 */
export function inboxThreadOf(thread: InboxThread, threadIds: readonly ThreadId[]): InboxThread {
  return thread === "all" || threadIds.includes(thread) ? thread : "all";
}

/** 거르기와 정렬을 거친 승인 id. 정렬은 요청 시각 기준이고, 같은 시각이면 대기열 순서를 지킨다 */
export function arrangeInboxApprovals(
  rows: readonly InboxRow[],
  options: { readonly thread: InboxThread; readonly sort: InboxSort },
): readonly EventId[] {
  const thread = inboxThreadOf(options.thread, inboxThreadIdsOf(rows));
  const picked = rows.filter((row) => thread === "all" || row.threadId === thread);
  const ordered = picked.toSorted((a, b) =>
    options.sort === "newest" ? b.requestedAt - a.requestedAt : a.requestedAt - b.requestedAt,
  );
  return ordered.map((row) => row.id);
}
