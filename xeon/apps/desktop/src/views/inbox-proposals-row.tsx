import { t } from "@fresnel/client/i18n";
import { AgentRequest, Button } from "@caustic/react";
import type { ReactNode } from "react";
import { useShellActions } from "../state/shell/index.ts";

// 받은 요청의 제안 줄(P-03 "제안 대기" 묶음의 한 줄). 대기 제안이 있고 거르기가 "모두"일 때만 `InboxApprovals`가 그린다.
// 행마다 펼치지 않는다. 누르면 제안 화면(P-06)이 무대에 온다. 결정은 P-06에서 한다.

export function InboxProposalsRow(props: { readonly count: number }): ReactNode {
  const shell = useShellActions();
  return (
    <AgentRequest
      kind="proposal"
      lead={t("desktop.shell.nav.proposals")}
      title={t("desktop.inbox.proposals.waiting", { count: props.count })}
      actions={[]}
    >
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            shell.updatePlace({ screen: "proposals", scroll: 0 });
          }}
        >
          {t("desktop.inbox.proposals.open")}
        </Button>
      </div>
    </AgentRequest>
  );
}
