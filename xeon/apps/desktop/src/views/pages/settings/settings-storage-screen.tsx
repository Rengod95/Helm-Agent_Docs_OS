import { toast } from "@caustic/react";
import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useCommands, type StorageCommands } from "../../commands.ts";
import { sharedStorageController } from "./settings-storage-model.ts";
import { StorageView, type StorageHandlers } from "./settings-storage-view.tsx";

// 저장 공간 구역(P-09 고급 탭)의 동작. 명령(`commands.storage`)을 컨트롤러에 잇고, 구역이 열릴 때 사용량을 한 번 읽는다.
// 지우기 결과는 토스트로 알리고, 실패는 구역 안의 경고로 둔다. 그림은 `settings-storage-view.tsx`가 그린다.

function announceRemoved(): void {
  toast({ tone: "success", title: t("desktop.settings.storage.previous.removed.toast") });
}

async function openFolder(storage: StorageCommands): Promise<void> {
  const opened = await storage.openDataDir();
  if (!opened) toast({ tone: "danger", title: t("desktop.settings.storage.folder.openFailed") });
}

export function StoragePanel(): ReactNode {
  const commands = useCommands();
  const controller = sharedStorageController(commands.storage, { removed: announceRemoved });
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  // 구역이 나타나면 사용량을 읽는다. 다시 마운트돼도 다시 읽는다
  useEffect(() => {
    detach(controller.load(), rethrow);
  }, [controller]);
  const handlers: StorageHandlers = {
    refresh: () => {
      detach(controller.load(), rethrow);
    },
    openDataDir: () => {
      detach(openFolder(commands.storage), rethrow);
    },
    ask: controller.ask,
    cancel: controller.cancel,
    confirm: () => {
      detach(controller.confirm(), rethrow);
    },
  };
  return <StorageView state={state} handlers={handlers} locale={activeLocale()} />;
}
