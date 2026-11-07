import { toast } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../../folder-pick.ts";
import { useCommands } from "../../commands.ts";
import { sharedBackupController, type BackupPhase } from "./settings-backup-model.ts";
import { BackupView, type BackupHandlers } from "./settings-backup-view.tsx";

// 백업 만들기 구역(P-09 고급 탭)의 동작. 명령(`commands.storage`)을 컨트롤러에 잇고, 만들었을 때만 토스트를 띄운다.
// 거절은 구역 안의 경고가 보이므로 토스트를 겹치지 않는다. 그림은 `settings-backup-view.tsx`가 그린다.

function announce(phase: BackupPhase): void {
  if (phase.kind !== "done") return;
  toast({ tone: "success", title: t("desktop.settings.backup.done.toast") });
}

export function BackupPanel(props: {
  /** 폴더 선택 창을 부르는 invoke. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly folderPick?: FolderPickInvoke | undefined;
}): ReactNode {
  const commands = useCommands();
  const [pickError, setPickError] = useState<string | null>(null);
  const controller = sharedBackupController(commands.storage, { settled: announce });
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const handlers: BackupHandlers = {
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
    <BackupView
      state={state}
      handlers={handlers}
      onPick={folderPick === undefined ? undefined : () => detach(pick(folderPick), rethrow)}
      pickError={pickError}
    />
  );
}
