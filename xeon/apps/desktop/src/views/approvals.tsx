import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useApprovalIds, useOpenThreadId } from "../state/engine/index.ts";
import { InboxNotices } from "./notices.tsx";
import { ApprovalCardList } from "./approval-card/approval-card.tsx";

// 승인 대기열의 마운트 자리 두 곳. 카드 본문과 단추는 approval-card/가 그린다(네 종류가 세 자리에서 같다).
// 트랜스크립트 끝은 ApprovalQueue, 끝 영역 받은 요청 탭은 InboxApprovals다. P-03 목록은 아직 없어 ApprovalCardList를 그대로 쓴다.
// 대화 이름 링크는 트랜스크립트 밖에서만 보인다: 트랜스크립트 끝은 열린 대화를 `within`으로 넘기고, 받은 요청은 넘기지 않는다.

/** 끝 영역 받은 요청 탭. 트랜스크립트 아래와 같은 카드를 쓴다(`approval.resolved`로 함께 사라진다) */
export function InboxApprovals(props: { readonly show?: InboxFilter }): ReactNode {
  const ids = useApprovalIds();
  const show = props.show ?? "all";
  const heads = show === "all";
  return (
    <div className="grid gap-4">
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
  const ids = useApprovalIds();
  const openThreadId = useOpenThreadId();
  if (ids.length === 0) return null;
  return (
    // 대기열이 길면 이 자리만 스크롤한다(입력창과 바닥 고정 요소는 밀리지 않는다)
    <section
      className="grid max-h-80 gap-2 overflow-y-auto px-3"
      aria-label={t("desktop.approvals.queue.label")}
    >
      <h2 className="m-0 text-ui-strong text-text-primary">
        {t("desktop.approvals.queue.title", { count: ids.length })}
      </h2>
      <ApprovalCardList ids={ids} within={openThreadId} />
    </section>
  );
}
