// 상태 표시줄의 안전 모드 칸(U-06, d02 `safeBody`). 안전 모드로 떠 있을 때만 보인다. 칸은 `StatusCell`이고 글은 칸 설명(꺼진 것과 원인)에 둔다.
// Popover 본문의 "안전 모드 끄고 다시 시작" 단추는 셸에서만 그린다. 웹에는 단추가 없다. 설정이 켠 안전 모드의 안내는 정보 아이콘 뒤다.
import { t } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import { useEngineState } from "../state/engine/index.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { RestartButtons, type RestartChoice } from "./restart-confirm-dialog.tsx";
import { useSafeMode } from "./safe-mode-context.ts";
import {
  canSwitchSafeModeOf,
  safeModeExitNoteOf,
  safeModeSurfaceOf,
  safeModeTipOf,
} from "./safe-mode-model.ts";
import { useShellRestart } from "./shell-restart-context.ts";
import { StatusCell } from "./status-cell.tsx";

const EXIT: RestartChoice = {
  id: "exit",
  label: "desktop.safe.exit",
  variant: "outline",
  options: { safeMode: false, confirmed: true },
};

/**
 * 칸 Popover의 본문. 셸에서 안전 모드가 떠 있을 때만 "끄고 다시 시작" 단추를 그리고, 설정이 켠 안전 모드면 그 안내를 정보 아이콘 뒤에 둔다.
 * 웹이거나 안전 모드가 아니면 아무것도 그리지 않는다. Popover 본문은 열 때만 그려지므로 시험은 이 부품을 직접 그린다.
 */
export function SafeModeActions(): ReactNode {
  const snapshot = useSafeMode();
  const shellRestart = useShellRestart();
  const engine = useEngineState();
  if (snapshot === null || !shellRestart || safeModeSurfaceOf(snapshot, shellRestart) !== "chip")
    return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RestartButtons
        choices={[EXIT]}
        size="sm"
        allowed={canSwitchSafeModeOf(engine?.kind ?? null)}
      />
      {/* 설정으로 켠 안전 모드는 다시 시작이 이번 실행에서만 끈다(`--no-safe-mode`). 설정 값은 그대로라는 안내를 정보 아이콘 뒤에 둔다 */}
      {safeModeExitNoteOf(snapshot) ? <InfoTip text={t("desktop.safe.exit.info")} /> : null}
    </div>
  );
}

export function SafeModeChip(): ReactNode {
  const snapshot = useSafeMode();
  const shellRestart = useShellRestart();
  const [open, setOpen] = useState(false);
  if (snapshot === null || safeModeSurfaceOf(snapshot, shellRestart) !== "chip") return null;
  return (
    <StatusCell
      cellId="safe-mode"
      text={t("desktop.safe.chip")}
      dot="warning"
      title={t("desktop.safe.chip")}
      description={safeModeTipOf(snapshot)}
      open={open}
      onOpenChange={setOpen}
      body={<SafeModeActions />}
    />
  );
}
