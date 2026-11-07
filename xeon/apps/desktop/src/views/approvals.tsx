import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { ScrollArea } from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  useAllThreadSummaries,
  useApprovalMirror,
  useOpenThreadId,
} from "../state/engine/index.ts";
import { InboxNotices } from "./notices.tsx";
import { ApprovalCardList } from "./approval-card/approval-card.tsx";
import { InboxProposalsRow } from "./inbox-proposals-row.tsx";
import {
  arrangeInboxApprovals,
  inboxRowsOf,
  inboxThreadIdsOf,
  type InboxSort,
  type InboxThread,
} from "./inbox-model.ts";
import { useProposalPending } from "./proposal-pending-context.tsx";

// 승인 대기열의 마운트 자리 두 곳. 카드 본문과 단추는 approval-card/가 그린다(네 종류가 세 자리에서 같다).
// 트랜스크립트 끝은 ApprovalQueue, 끝 영역 받은 요청 탭은 InboxApprovals다. P-03 목록은 아직 없어 ApprovalCardList를 그대로 쓴다.
// 대화 이름 링크는 트랜스크립트 밖에서만 보인다: 트랜스크립트 끝은 열린 대화를 `within`으로 넘기고, 받은 요청은 넘기지 않는다.

/** 대화 셀렉트의 항목 하나: 대기 승인이 있는 대화. 이름이 없으면 title이 null이다 */
export type InboxThreadChoice = { readonly id: ThreadId; readonly title: string | null };

/** 대기 승인이 있는 대화를 승인 순서대로 돌려준다. 이름은 대화 요약에서 읽고 카드 머리와 같은 값이다 */
export function useInboxThreads(): readonly InboxThreadChoice[] {
  const approvals = useApprovalMirror();
  // 대기 승인이 있는 대화는 내부 대화여도 이름이 보여야 처리할 수 있다
  const summaries = useAllThreadSummaries();
  return inboxThreadIdsOf(inboxRowsOf(approvals.ids, approvals.byId)).map((id) => ({
    id,
    title: summaries.find((summary) => summary.threadId === id)?.title ?? null,
  }));
}

/** 끝 영역 받은 요청 탭과 받은 요청 화면. 트랜스크립트 아래와 같은 카드를 쓴다(`approval.resolved`로 함께 사라진다).
 * 대화와 정렬은 승인 구역만 거른다. 기본은 모든 대화이고 오래된 것 먼저다.
 * 대기 제안이 있으면 거르기가 "모두"일 때 맨 위에 제안 줄 하나를 둔다(`InboxProposalsRow`). 제안 줄은 대화와 정렬을 받지 않는다 */
export function InboxApprovals(props: {
  readonly show?: InboxFilter;
  readonly thread?: InboxThread;
  readonly sort?: InboxSort;
}): ReactNode {
  const approvals = useApprovalMirror();
  const pending = useProposalPending().count;
  const ids = arrangeInboxApprovals(inboxRowsOf(approvals.ids, approvals.byId), {
    thread: props.thread ?? "all",
    sort: props.sort ?? "oldest",
  });
  const show = props.show ?? "all";
  const heads = show === "all";
  return (
    <div className="grid gap-4">
      {show === "all" && pending > 0 ? <InboxProposalsRow count={pending} /> : null}
      {show === "notices" ? null : (
        <section className="grid gap-2">
          {heads ? (
            <h2 className="text-ui-strong text-text-primary">
              {t("desktop.inbox.filter.approvals")}
            </h2>
          ) : null}
          {ids.length === 0 ? (
            <div className="text-ui-sm text-text-tertiary">
              {t("desktop.approvals.inbox.empty")}
            </div>
          ) : (
            <ApprovalCardList ids={ids} label={t("desktop.approvals.queue.label")} />
          )}
        </section>
      )}
      {show === "approvals" ? null : (
        <section className="grid gap-2">
          <InboxNotices />
        </section>
      )}
    </div>
  );
}

/** 받은 요청 화면의 구역 거르기: 모두, 승인, 알림 */
export type InboxFilter = "all" | "approvals" | "notices";

export function ApprovalQueue(): ReactNode {
  const approvals = useApprovalMirror();
  const openThreadId = useOpenThreadId();
  // 열린 대화의 승인만 트랜스크립트 끝에 둔다. 다른 대화의 승인은 받은 요청과 사이드바 수가 맡는다
  const ids = inboxRowsOf(approvals.ids, approvals.byId)
    .filter((row) => row.threadId === openThreadId)
    .map((row) => row.id);
  const band = useRef<HTMLElement | null>(null);
  const idsKey = ids.join(",");
  // 새 카드가 오면 마지막 카드의 단추 줄까지 보이게 띠 안에서 스크롤한다(rtE R-1)
  useEffect(() => {
    if (idsKey === "") return;
    const bars = band.current?.querySelectorAll('[data-slot="approval-actions"]') ?? [];
    const last = bars[bars.length - 1];
    if (last instanceof HTMLElement && typeof last.scrollIntoView === "function") {
      last.scrollIntoView({ block: "nearest" });
    }
  }, [idsKey]);
  if (ids.length === 0) return null;
  return (
    // 입력창 바로 위 띠. 높이는 화면의 40%까지만 차지하고, 넘는 카드는 띠 안의 스크롤 영역에서 넘긴다.
    // 머리(개수)는 스크롤 밖에 둬 늘 보인다. 카드의 응답 단추 줄은 카드 안에서 바닥에 붙는다(approval-card.tsx).
    <section
      ref={band}
      className="flex min-h-0 max-h-[40dvh] flex-col gap-2"
      aria-label={t("desktop.approvals.queue.label")}
    >
      <h2 className="m-0 flex-none px-3 text-ui-strong text-text-primary">
        {t("desktop.approvals.queue.title", { count: ids.length })}
      </h2>
      <ScrollArea label={t("desktop.approvals.queue.label")} className="min-h-0 flex-1">
        <div className="px-3 py-1.5">
          <ApprovalCardList ids={ids} within={openThreadId} />
        </div>
      </ScrollArea>
    </section>
  );
}
