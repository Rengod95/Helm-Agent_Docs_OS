// 크래프트 컨트롤러: 목록 읽기와 켜기·끄기. 상태는 스토어에, 요청은 `commands.workbench`에 있고 여기서 둘을 잇는다.
import { toggleRequestOf } from "@fresnel/client/workbench";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { toast } from "@caustic/react";
import { useCallback, useEffect } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";

/** 기다리지 않는 호출. 실패는 컨트롤러가 이미 토스트로 알렸다 */
export function detachVoid(work: Promise<void>): void {
  detach(work, rethrow);
}

export interface WorkbenchController {
  reload(): Promise<void>;
  toggle(name: string, target: boolean): Promise<void>;
  reenable(name: string): Promise<void>;
}

export function useWorkbenchController(): WorkbenchController {
  const commands = useCommands();
  const actions = useWorkbenchActions();
  const phase = useLinkPhase();

  const reload = useCallback(async (): Promise<void> => {
    if (actions.snapshot().list !== "ready") actions.listLoading();
    const listed = await commands.workbench.list();
    if (listed.ok) actions.listLoaded(listed.value);
    else actions.listFailed();
  }, [actions, commands]);

  const toggle = useCallback(
    async (name: string, target: boolean): Promise<void> => {
      const plan = toggleRequestOf(actions.snapshot(), name, target);
      if (!plan.ok) return;
      actions.markPending(name, target);
      const done = await commands.workbench.toggle(plan.request);
      if (!done.ok) {
        actions.clearPending(name);
        toast({ tone: "danger", title: t("desktop.workbench.toggle.failed") });
        return;
      }
      await reload();
    },
    [actions, commands, reload],
  );

  const reenable = useCallback(
    async (name: string): Promise<void> => {
      const done = await commands.workbench.reenable(name);
      if (!done.ok) {
        toast({ tone: "danger", title: t("desktop.workbench.toggle.failed") });
        return;
      }
      toast({ tone: "success", title: t("desktop.workbench.reenable.done") });
      await reload();
    },
    [commands, reload],
  );

  // 화면을 열 때와 엔진이 (다시) 살아날 때 읽는다
  useEffect(() => {
    if (phase === "live") detach(reload(), rethrow);
  }, [phase, reload]);

  return { reload, toggle, reenable };
}
