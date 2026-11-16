import { t } from "@fresnel/client/i18n";
import { Button } from "@caustic/react";
import type { ReactNode } from "react";
import { useShellActions } from "../state/shell/index.ts";
import { RequestCard } from "./pages/shared/request-card.tsx";

// 받은 요청의 제안 줄(P-03 "제안 대기" 묶음의 한 줄). 대기 제안이 있고 거르기가 "모두"일 때만 `InboxApprovals`가 그린다.
// 행마다 펼치지 않는다. 누르면 제안 화면(P-06)이 무대에 온다. 결정은 P-06에서 한다.
// 틀은 공용 요청 카드(주의 표시 + 주의 면, DP-191)다. caustic AgentRequest(proposal)는 스펙트럼 고리를 그려 쓰지 않는다(DP-188).

export function InboxProposalsRow(props: { readonly count: number }): ReactNode {
  const shell = useShellActions();
  return (
    <RequestCard
      kind="proposal"
      lead={t("desktop.shell.nav.proposals")}
      title={t("desktop.inbox.proposals.waiting", { count: props.count })}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            shell.updatePlace({ screen: "proposals", scroll: 0 });
          }}
        >
          {t("desktop.inbox.proposals.open")}
        </Button>
      }
    />
  );
}
