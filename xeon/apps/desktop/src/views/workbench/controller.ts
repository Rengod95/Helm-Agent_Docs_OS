// 크래프트 컨트롤러: 목록 읽기와 켜기·끄기. 상태는 스토어에, 요청은 `commands.workbench`에 있고 여기서 둘을 잇는다.
// 목록 뒤의 자세히(`ext.get`), 실패 장부(`ext.health`), 훅 순서는 보조 읽기다. 실패해도 목록 상태는 그대로이고 이전 값을 둔다(알림 없음).
import { toggleRequestOf } from "@fresnel/client/workbench";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { toast } from "@caustic/react";
import { useCallback, useEffect, useMemo } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";
import { mapLimited } from "./load-details.ts";
import { orderTableOf } from "./order-merge.ts";

/** `ext.get`을 동시에 보내는 상한. 확장이 많아도 엔진에 한꺼번에 몰리지 않는다 */
const DETAIL_IN_FLIGHT = 8;

/** 기다리지 않는 호출. 실패는 컨트롤러가 이미 토스트로 알렸다 */
export function detachVoid(work: Promise<void>): void {
  detach(work, rethrow);
}

export interface WorkbenchController {
  reload(): Promise<void>;
  /** 훅 순서만 다시 읽는다(`hooks.list`와 `hooks.order.get`). 저장·되돌리기 뒤에 쓴다 */
  reloadOrders(): Promise<void>;
  toggle(name: string, target: boolean): Promise<void>;
  reenable(name: string): Promise<void>;
  /** "계속 꺼 둘게요" 답. 끄고 목록을 다시 읽는다. "계속 켜 둘게요"는 `reenable`이다 */
  keepOff(name: string): Promise<void>;
}

export function useWorkbenchController(): WorkbenchController {
  const commands = useCommands();
  const actions = useWorkbenchActions();
  const phase = useLinkPhase();

  // 두 호출이 모두 성공했을 때만 표를 바꾼다. 하나라도 실패하면 이전 표를 그대로 둔다
  const reloadOrders = useCallback(async (): Promise<void> => {
    const [hooks, applied] = await Promise.all([
      commands.workbench.hooks(),
      commands.workbench.orderGet(),
    ]);
    if (hooks.ok && applied.ok) {
      actions.ordersLoaded(orderTableOf(hooks.value, applied.value.hooks));
    }
  }, [actions, commands]);

  // 항목마다 따로 읽는다. 실패한 확장은 이전 자세히 값을 그대로 둔다
  const reloadDetails = useCallback(
    async (names: readonly string[]): Promise<void> => {
      const got = await mapLimited(names, DETAIL_IN_FLIGHT, (name) => commands.workbench.get(name));
      for (const { item: name, result } of got) {
        if (result.ok && result.value.ok) actions.detailsLoaded(name, result.value.value);
      }
    },
    [actions, commands],
  );

  const reloadHealth = useCallback(async (): Promise<void> => {
    const got = await commands.workbench.health();
    if (got.ok) actions.healthLoaded(got.value);
  }, [actions, commands]);

  const reload = useCallback(async (): Promise<void> => {
    if (actions.snapshot().list !== "ready") actions.listLoading();
    const listed = await commands.workbench.list();
    if (!listed.ok) {
      actions.listFailed();
      return;
    }
    actions.listLoaded(listed.value);
    await Promise.all([
      reloadDetails(listed.value.map((entry) => entry.name)),
      reloadHealth(),
      reloadOrders(),
    ]);
  }, [actions, commands, reloadDetails, reloadHealth, reloadOrders]);

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

  const keepOff = useCallback(
    async (name: string): Promise<void> => {
      const done = await commands.workbench.keepOff(name);
      if (!done.ok) {
        toast({ tone: "danger", title: t("desktop.workbench.toggle.failed") });
        return;
      }
      await reload();
    },
    [commands, reload],
  );

  // 화면을 열 때와 엔진이 (다시) 살아날 때 읽는다
  useEffect(() => {
    if (phase === "live") detach(reload(), rethrow);
  }, [phase, reload]);

  // 원천이 identity로 다시 그릴지 정하므로 같은 객체를 돌려준다
  return useMemo(
    () => ({ reload, reloadOrders, toggle, reenable, keepOff }),
    [reload, reloadOrders, toggle, reenable, keepOff],
  );
}
