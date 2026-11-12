import { toast } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../../folder-pick.ts";
import { useCommands } from "../../commands.ts";
import { sharedRestoreController, type RestorePhase } from "./settings-restore-model.ts";
import { sharedBackupController } from "./settings-backup-model.ts";
import { RestoreView, type RestoreHandlers } from "./settings-restore-view.tsx";

// 데이터 복원 구역(P-09 고급 탭)의 동작. 명령(`commands.restore`)을 컨트롤러에 잇고, 되돌렸을 때만 토스트를 띄운다.
// 거절은 구역 안의 경고가 보이므로 토스트를 겹치지 않는다. 그림은 `settings-restore-view.tsx`가 그린다.

function announce(phase: RestorePhase): void {
  if (phase.kind !== "restored") return;
  toast({ tone: "success", title: t("desktop.settings.restore.done.toast") });
}

export function RestorePanel(props: {
  /** 폴더 선택 창을 부르는 invoke. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly folderPick?: FolderPickInvoke | undefined;
}): ReactNode {
  const commands = useCommands();
  const [pickError, setPickError] = useState<string | null>(null);
  const controller = sharedRestoreController(commands.restore, { settled: announce });
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  // 이번 실행에서 만든 백업. 복원 칸을 한 번에 채우는 칩이 된다(백업 목록을 읽는 명령은 없다)
  const backup = sharedBackupController(commands.storage);
  const backupState = useSyncExternalStore(backup.subscribe, backup.getState);
  const recent = backupState.phase.kind === "done" ? backupState.phase.report.destDir : null;
  const handlers: RestoreHandlers = {
    edit: controller.edit,
    ask: controller.ask,
    cancel: controller.cancel,
    confirm: () => {
      detach(controller.confirm(), rethrow);
    },
  };
  const folderPick = props.folderPick;
  // 취소는 입력란을 그대로 둔다. 창을 못 연 실패도 입력란은 그대로 두고 한 줄로만 알린다
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setPickError(t("desktop.workspace.pickFailed"));
      return;
    }
    if (picked.value === undefined) return;
    setPickError(null);
    controller.edit(picked.value);
  };
  return (
    <RestoreView
      state={state}
      handlers={handlers}
      onPick={folderPick === undefined ? undefined : () => detach(pick(folderPick), rethrow)}
      pickError={pickError}
      recent={recent}
    />
  );
}
