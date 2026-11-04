// 상태 표시줄의 다시 시작 줄(U-02). 필요한 일이 없으면 아무것도 그리지 않고, 셸이 없는 웹이면 글 한 줄만 그린다.
// 셸이 있으면 경고 글과 개수, 이유를 정보 아이콘 뒤에 두고 "지금 다시 시작" 단추를 둔다(단추는 엔진이 running일 때만 보인다).
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import type { RestartReason } from "../state/ui/index.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { RestartNowButton } from "./restart-confirm-dialog.tsx";
import { restartInfoTextOf, restartLineOf } from "./restart-model.ts";
import { useShellRestart } from "./shell-restart-context.ts";

export function RestartLine(props: { readonly reasons: readonly RestartReason[] }): ReactNode {
  const shellRestart = useShellRestart();
  const line = restartLineOf(props.reasons.length, shellRestart);
  if (line === "hidden") return null;
  if (line === "web") return <span className="warn">{t("desktop.restart.web")}</span>;
  return (
    <>
      <span className="warn">{t("desktop.restart.needed.title")}</span>
      <span>{t("desktop.restart.needed.count", { count: props.reasons.length })}</span>
      <InfoTip text={restartInfoTextOf(props.reasons)} />
      <RestartNowButton size="xs" />
    </>
  );
}
