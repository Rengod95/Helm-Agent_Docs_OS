// 상태 표시줄의 안전 모드 칩(U-06). 안전 모드로 떠 있을 때만 보인다. 꺼진 것과 원인은 정보 아이콘 뒤에 두고,
// 셸에서만 "안전 모드 끄고 다시 시작" 단추를 준다. 웹에는 칩 글과 정보 아이콘만 남는다.
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useEngineState } from "../state/engine/index.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { RestartButtons, type RestartChoice } from "./restart-confirm-dialog.tsx";
import { useSafeMode } from "./safe-mode-context.ts";
import { canSwitchSafeModeOf, safeModeSurfaceOf, safeModeTipOf } from "./safe-mode-model.ts";
import { useShellRestart } from "./shell-restart-context.ts";

const EXIT: RestartChoice = {
  id: "exit",
  label: "desktop.safe.exit",
  variant: "outline",
  options: { safeMode: false, confirmed: true },
};

export function SafeModeChip(): ReactNode {
  const snapshot = useSafeMode();
  const shellRestart = useShellRestart();
  const engine = useEngineState();
  if (snapshot === null || safeModeSurfaceOf(snapshot, shellRestart) !== "chip") return null;
  return (
    <>
      <span className="warn" data-slot="safe-mode-chip">
        {t("desktop.safe.chip")}
      </span>
      <InfoTip text={safeModeTipOf(snapshot)} />
      {shellRestart ? (
        <>
          <RestartButtons
            choices={[EXIT]}
            size="xs"
            allowed={canSwitchSafeModeOf(engine?.kind ?? null)}
          />
          {/* 설정에서 안전 모드를 기본으로 켜 두었으면 다시 시작해도 꺼지지 않는다. 그 안내를 정보 아이콘 뒤에 둔다 */}
          <InfoTip text={t("desktop.safe.exit.info")} />
        </>
      ) : null}
    </>
  );
}
