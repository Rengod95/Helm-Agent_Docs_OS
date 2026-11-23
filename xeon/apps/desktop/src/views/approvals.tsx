import { t } from "@fresnel/client/i18n";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import { ScrollArea } from "@caustic/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  useAllThreadSummaries,
  useApprovalMirror,
  useOpenThreadId,
} from "../state/engine/index.ts";
import { InboxNotices, type NoticeFeed } from "./notices.tsx";
import type { NoticeEntry } from "./notices-model.ts";
import { ApprovalCardList } from "./approval-card/approval-card.tsx";
import { InboxProposalsRow } from "./inbox-proposals-row.tsx";
import {
  arrangeInboxApprovals,
  inboxAllThreadIdsOf,
  inboxRowsOf,
  queueCountsOf,
  type InboxSort,
  type InboxThread,
} from "./inbox-model.ts";
import { useProposalPending } from "./proposal-pending-context.tsx";
import { Presence } from "../lib/motion-presets.tsx";

// 승인 대기열의 마운트 자리 두 곳. 카드 본문과 단추는 approval-card/가 그린다(네 종류가 세 자리에서 같다).
// 트랜스크립트 끝은 ApprovalQueue, 끝 영역 받은 요청 탭은 InboxApprovals다. P-03 목록은 아직 없어 ApprovalCardList를 그대로 쓴다.
// 대화 이름 링크는 트랜스크립트 밖에서만 보인다: 트랜스크립트 끝은 열린 대화를 `within`으로 넘기고, 받은 요청은 넘기지 않는다.

/** 대화 셀렉트의 항목 하나: 대기 승인이 있는 대화. 이름이 없으면 title이 null이다 */
export type InboxThreadChoice = { readonly id: ThreadId; readonly title: string | null };

/**
 * 대화 셀렉트의 항목: 대기 승인이 있는 대화(승인 순서)와 알림만 있는 대화. 이름은 대화 요약에서 읽고 카드 머리와 같은 값이다.
 * `noticeEntries`는 받은 요청 화면이 든 알림 목록이다
 */
export function useInboxThreads(
  noticeEntries: readonly NoticeEntry[],
): readonly InboxThreadChoice[] {
  const approvals = useApprovalMirror();
  // 대기 승인이 있는 대화는 내부 대화여도 이름이 보여야 처리할 수 있다
  const summaries = useAllThreadSummaries();
  return inboxAllThreadIdsOf(inboxRowsOf(approvals.ids, approvals.byId), noticeEntries).map(
    (id) => ({
      id,
      title: summaries.find((summary) => summary.threadId === id)?.title ?? null,
    }),
  );
}

/** 끝 영역 받은 요청 탭과 받은 요청 화면. 트랜스크립트 아래와 같은 카드를 쓴다(`approval.resolved`로 함께 사라진다).
 * 대화는 승인과 알림 구역을 함께 거르고, 정렬은 승인 구역만 거른다(알림은 늘 새것 먼저, DP-216). 기본은 모든 대화이고 오래된 것 먼저다.
 * 대기 제안이 있으면 거르기가 "모두"일 때 맨 위에 제안 줄 하나를 둔다(`InboxProposalsRow`). 제안 줄은 대화와 정렬을 받지 않는다 */
export function InboxApprovals(props: {
  readonly show?: InboxFilter;
  readonly thread?: InboxThread;
  readonly sort?: InboxSort;
  /** 받은 요청 화면이 든 알림 목록. 없으면 알림 구역이 자기 목록을 읽는다(끝 영역 탭) */
  readonly feed?: NoticeFeed | undefined;
}): ReactNode {
  const approvals = useApprovalMirror();
  const pending = useProposalPending().count;
  const thread = props.thread ?? "all";
  const sort = props.sort ?? "oldest";
  const ids = arrangeInboxApprovals(inboxRowsOf(approvals.ids, approvals.byId), { thread, sort });
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
            <div className="text-ui text-text-tertiary">{t("desktop.approvals.inbox.empty")}</div>
          ) : (
            <ApprovalCardList ids={ids} label={t("desktop.approvals.queue.label")} />
          )}
        </section>
      )}
      {show === "approvals" ? null : (
        <section className="grid gap-2">
          <InboxNotices feed={props.feed} thread={thread} />
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
  const rows = inboxRowsOf(approvals.ids, approvals.byId).filter(
    (row) => row.threadId === openThreadId,
  );
  const ids = rows.map((row) => row.id);
  const counts = queueCountsOf(rows);
  const band = useRef<HTMLElement | null>(null);
  const idsKey = ids.join(",");
  // 새 카드가 오면 마지막 카드가 아래 가장자리(테두리)까지 보이게 띠 안에서 스크롤한다(rtE R-1, DP-225). 카드 하나의 높이는 띠 상한 안이라 다 들어간다
  useEffect(() => {
    if (idsKey === "") return;
    const cards = band.current?.querySelectorAll('[data-slot="approval-card"]') ?? [];
    const last = cards[cards.length - 1];
    if (last instanceof HTMLElement && typeof last.scrollIntoView === "function") {
      last.scrollIntoView({ block: "nearest" });
    }
  }, [idsKey]);
  // 띠가 입력창 위로 올라와 가라앉고, 마지막 승인에 답하면 내려가며 사라진다(dzM2 시안 §8). 대화를 처음 열 때는 움직이지 않는다
  return (
    <Presence
      show={ids.length > 0}
      variant="band"
      initial={false}
      className="flex min-h-0 flex-col"
    >
      {ids.length === 0 ? null : (
        <ApprovalBand band={band} ids={ids} counts={counts} within={openThreadId} />
      )}
    </Presence>
  );
}

/** 묶음 제목: 승인은 "승인 대기", 질문은 "답변 대기", 둘이 섞이면 각각 센다 */
function queueTitle(counts: { readonly approvals: number; readonly questions: number }): string {
  if (counts.approvals > 0 && counts.questions > 0) {
    return t("desktop.approvals.queue.titleMixed", counts);
  }
  if (counts.questions > 0) {
    return t("desktop.approvals.queue.titleQuestions", { count: counts.questions });
  }
  return t("desktop.approvals.queue.title", { count: counts.approvals });
}

function ApprovalBand(props: {
  readonly band: RefObject<HTMLElement | null>;
  readonly ids: readonly EventId[];
  readonly counts: { readonly approvals: number; readonly questions: number };
  readonly within: ThreadId | null;
}): ReactNode {
  const { band, ids } = props;
  const openThreadId = props.within;
  return (
    // 입력창 바로 위 띠(DP-225). 높이는 화면의 50%까지이고(선택지 넷과 직접 입력이 있는 질문이 900px 창에서 스크롤 없이 들어간다), 카드 하나는 그 안에 다 들어가 본문만 스크롤한다(`--approval-card-max`:
    // 띠 상한에서 머리 18 + 사이 8을 뺀 값). 카드가 여럿이면 카드마다 같은 상한을 갖고 띠가 스크롤한다(가장자리 흐림).
    // 머리(개수)는 스크롤 밖에 둬 늘 보인다. 쌓임 그릇이 높이를 줄이면 카드 하나일 때는 카드가 함께 줄어 단추 줄이 늘 보인다.
    <section
      ref={band}
      data-approval-band=""
      className="flex max-h-[calc(var(--app-dvh)*0.5)] min-h-0 flex-col gap-2 [--approval-card-max:calc(var(--app-dvh)*0.5-1.625rem)]"
      aria-label={t("desktop.approvals.queue.label")}
    >
      <h2 className="m-0 flex-none text-ui-strong text-text-primary">{queueTitle(props.counts)}</h2>
      {ids.length === 1 ? (
        <ApprovalCardList ids={ids} within={openThreadId} />
      ) : (
        <ScrollArea fade label={t("desktop.approvals.queue.label")} className="min-h-0 flex-1">
          <ApprovalCardList ids={ids} within={openThreadId} />
        </ScrollArea>
      )}
    </section>
  );
}
