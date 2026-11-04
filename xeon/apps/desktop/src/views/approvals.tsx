import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useApprovalIds, useOpenThreadId } from "../state/engine/index.ts";
import { InboxNotices } from "./notices.tsx";
import { ApprovalCardList } from "./approval-card/approval-card.tsx";

// 승인 대기열의 마운트 자리 두 곳. 카드 본문과 단추는 approval-card/가 그린다(네 종류가 세 자리에서 같다).
// 트랜스크립트 끝은 ApprovalQueue, 끝 영역 받은 요청 탭은 InboxApprovals다. P-03 목록은 아직 없어 ApprovalCardList를 그대로 쓴다.
// 대화 이름 링크는 트랜스크립트 밖에서만 보인다: 트랜스크립트 끝은 열린 대화를 `within`으로 넘기고, 받은 요청은 넘기지 않는다.

/** 끝 영역 받은 요청 탭. 트랜스크립트 아래와 같은 카드를 쓴다(`approval.resolved`로 함께 사라진다) */
export function InboxApprovals(): ReactNode {
  const ids = useApprovalIds();
  return (
    <div className="grid gap-4">
      {ids.length === 0 ? (
        <div className="dim">{t("desktop.approvals.inbox.empty")}</div>
      ) : (
        <ApprovalCardList ids={ids} label={t("desktop.approvals.queue.label")} />
      )}
      <InboxNotices />
    </div>
  );
}

export function ApprovalQueue(): ReactNode {
  const ids = useApprovalIds();
  const openThreadId = useOpenThreadId();
  if (ids.length === 0) return null;
  return (
    <section className="approvals" aria-label={t("desktop.approvals.queue.label")}>
      <h2>{t("desktop.approvals.queue.title", { count: ids.length })}</h2>
      <ApprovalCardList ids={ids} within={openThreadId} />
    </section>
  );
}
