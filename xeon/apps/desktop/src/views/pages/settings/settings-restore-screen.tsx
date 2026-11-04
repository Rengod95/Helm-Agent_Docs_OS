import { toast } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { createRestoreController, type RestorePhase } from "./settings-restore-model.ts";
import { RestoreView, type RestoreHandlers } from "./settings-restore-view.tsx";

// 데이터 복원 구역(P-09 고급 탭)의 동작. 명령(`commands.restore`)을 컨트롤러에 잇고, 되돌렸을 때만 토스트를 띄운다.
// 거절은 구역 안의 경고가 보이므로 토스트를 겹치지 않는다. 그림은 `settings-restore-view.tsx`가 그린다.

function announce(phase: RestorePhase): void {
  if (phase.kind !== "restored") return;
  toast({ tone: "success", title: t("desktop.settings.restore.done.toast") });
}

export function RestorePanel(): ReactNode {
  const commands = useCommands();
  const [controller] = useState(() =>
    createRestoreController(commands.restore, { settled: announce }),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const handlers: RestoreHandlers = {
    edit: controller.edit,
    ask: controller.ask,
    cancel: controller.cancel,
    confirm: () => {
      detach(controller.confirm(), rethrow);
    },
  };
  return <RestoreView state={state} handlers={handlers} />;
}
