// 크래프트 컨트롤러: 목록 읽기와 켜기·끄기. 상태는 스토어에, 요청은 `commands.workbench`에 있고 여기서 둘을 잇는다.
// 목록 뒤의 자세히(`ext.get`), 실패 장부(`ext.health`), 훅 순서는 보조 읽기다. 실패해도 목록 상태는 그대로이고 이전 값을 둔다(알림 없음).
import { profileFailureOf, toggleRequestOf } from "@fresnel/client/workbench";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { toast } from "@caustic/react";
import { useCallback, useEffect, useMemo } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbenchActions, useWorkbenchScope } from "../../state/workbench/index.ts";
import { useCommands, type WorkbenchCommands } from "../commands.ts";
import { scopeArg } from "../craft/craft-scope.ts";
import { showFailureToast } from "./failure-toast.ts";
import { useSafeMode } from "../safe-mode-context.ts";
import { mapLimited } from "./load-details.ts";
import { orderTableOf } from "./order-merge.ts";
import { profileAppliesText, profileFailureText } from "./profile-text.ts";
import { removeDoneCopyOf, removeOutcomeOfError, type RemoveOutcome } from "./remove-model.ts";

/** `ext.get`을 동시에 보내는 상한. 확장이 많아도 엔진에 한꺼번에 몰리지 않는다 */
const DETAIL_IN_FLIGHT = 8;

/** 기다리지 않는 호출. 실패는 컨트롤러가 이미 토스트로 알렸다 */
export function detachVoid(work: Promise<void>): void {
  detach(work, rethrow);
}

/**
 * 확장 목록이 바뀌었을 알림(`onChanged`)마다 `reload`로 다시 읽는다. 자동 꺼짐 배지와 개수는 스토어 값을 그대로 그리므로,
 * 스토어가 다시 채워지면 화면은 다시 마운트하지 않아도 따라간다. 반환값은 구독 해제
 */
export function reloadOnExtChanges(
  workbench: Pick<WorkbenchCommands, "onChanged">,
  reload: () => Promise<void>,
): () => void {
  return workbench.onChanged(() => {
    detachVoid(reload());
  });
}

export interface WorkbenchController {
  reload(): Promise<void>;
  /** 훅 순서만 다시 읽는다(`hooks.list`와 `hooks.order.get`). 저장·되돌리기 뒤에 쓴다 */
  reloadOrders(): Promise<void>;
  toggle(name: string, target: boolean): Promise<void>;
  reenable(name: string): Promise<void>;
  /** "끄기" 답(설정에 끄고 `ext.disableConfirm`). 실패하면 토스트를 띄우고, 성공하면 목록을 다시 읽는다. "켜 두기"는 `reenable`이다 */
  keepOff(name: string): Promise<void>;
  /**
   * 설치본을 지운다(`ext.remove`). `dropData`가 참이면 저장 테이블도 지운다. 성공하면 토스트로 적용 시점을 알리고 목록을 다시 읽는다.
   * 지웠으면 true. 실패하면 토스트를 띄우고 false이며, 저장 데이터를 지우다 실패했을 때도 목록을 다시 읽는다(호스트가 확장을 먼저 내린다)
   */
  remove(name: string, options?: { readonly dropData?: boolean }): Promise<RemoveOutcome>;
  /** 외부 훅 "끄기" 답(`hooks.disableConfirm`). 성공하면 목록을 다시 읽고 true, 실패하면 false(알림이 한 줄 오류와 "다시 시도"를 보인다) */
  hookKeepOff(hook: string): Promise<boolean>;
  /** 외부 훅 "켜 두기"와 "다시 켜기" 답(`hooks.reenable`). 결과는 `hookKeepOff`와 같다 */
  hookKeepOn(hook: string): Promise<boolean>;
  /** 프로필을 이 대화에 쓴다. 성공은 쓴 설정 수와 적용 시점을, 실패는 실패 갈래를 토스트로 알린다 */
  applyProfile(id: string, threadId: ThreadId): Promise<boolean>;
}

export function useWorkbenchController(): WorkbenchController {
  const commands = useCommands();
  const actions = useWorkbenchActions();
  const scope = useWorkbenchScope();
  const phase = useLinkPhase();
  // 안전 모드면 훅 질문과 꺼짐을 스토어에 담지 않는다(탭 칸과 개수도 0이 된다). 값이 바뀌면 목록을 다시 읽는다
  const safe = useSafeMode()?.active === true;

  // 두 호출이 모두 성공했을 때만 표를 바꾼다. 하나라도 실패하면 이전 표를 그대로 둔다
  const reloadOrders = useCallback(async (): Promise<void> => {
    const [hooks, applied] = await Promise.all([
      commands.workbench.hooks(),
      commands.workbench.orderGet(),
    ]);
    // 훅 질문과 꺼짐은 순서와 따로 읽은 값이라 `hooks.list`만 성공해도 반영한다
    if (hooks.ok) actions.hookNoticesLoaded(hooks.value, safe);
    if (hooks.ok && applied.ok) {
      actions.ordersLoaded(orderTableOf(hooks.value, applied.value.hooks));
    }
  }, [actions, commands, safe]);

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
      const done = await commands.workbench.toggle({
        ...plan.request,
        scope: scopeArg(scope).settingsScope,
      });
      if (!done.ok) {
        actions.clearPending(name);
        showFailureToast({ title: t("desktop.workbench.toggle.failed") });
        return;
      }
      await reload();
    },
    [actions, commands, scope, reload],
  );

  const reenable = useCallback(
    async (name: string): Promise<void> => {
      const done = await commands.workbench.reenable(name);
      if (!done.ok) {
        showFailureToast({ title: t("desktop.workbench.toggle.failed") });
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
        showFailureToast({ title: t("desktop.workbench.toggle.failed") });
        return;
      }
      await reload();
    },
    [commands, reload],
  );

  const remove = useCallback(
    async (name: string, options?: { readonly dropData?: boolean }): Promise<RemoveOutcome> => {
      const done = await commands.workbench.remove(name, options);
      if (!done.ok) {
        const outcome = removeOutcomeOfError(done.error);
        const notFound = outcome === "gone";
        toast({
          tone: "danger",
          title: t("desktop.workbench.remove.failed"),
          ...(notFound ? { description: t("desktop.workbench.remove.failed.notFound") } : {}),
        });
        // 이미 없는 이름이면 목록이 낡은 것이다. 저장 데이터를 지우다 실패했으면 호스트가 확장을 먼저 내렸으니 목록을 다시 읽는다
        if (notFound || options?.dropData === true) await reload();
        return outcome;
      }
      const copy = removeDoneCopyOf(done.value.appliesAt, done.value.dataDropped);
      toast({
        tone: "success",
        title: t(copy.title),
        ...(copy.data === null
          ? {}
          : { description: t("desktop.workbench.remove.done.withData", { count: copy.data }) }),
      });
      actions.closeDetail();
      actions.clearPick();
      await reload();
      return "removed";
    },
    [actions, commands, reload],
  );
  const hookAnswer = useCallback(
    async (call: Promise<{ readonly ok: boolean }>): Promise<boolean> => {
      const done = await call;
      if (!done.ok) return false;
      await reloadOrders();
      return true;
    },
    [reloadOrders],
  );
  const hookKeepOff = useCallback(
    (hook: string): Promise<boolean> => hookAnswer(commands.workbench.hookKeepOff(hook)),
    [commands, hookAnswer],
  );
  const hookKeepOn = useCallback(
    (hook: string): Promise<boolean> => hookAnswer(commands.workbench.hookReenable(hook)),
    [commands, hookAnswer],
  );

  // 화면을 열 때와 엔진이 (다시) 살아날 때 읽는다
  useEffect(() => {
    if (phase === "live") detach(reload(), rethrow);
  }, [phase, reload]);

  // 열린 동안 바뀐 것(다른 창의 설정, 백그라운드 자동 끄기)도 목록에 든다. 연결이 새로 서면 구독을 다시 한다
  useEffect(() => {
    if (phase !== "live") return undefined;
    return reloadOnExtChanges(commands.workbench, reload);
  }, [commands, phase, reload]);

  const applyProfile = useCallback(
    async (id: string, threadId: ThreadId): Promise<boolean> => {
      const done = await commands.workbench.applyProfile(id, threadId);
      if (!done.ok) {
        const code = done.error.kind === "rejected" ? done.error.code : null;
        toast({ tone: "danger", title: t(profileFailureText(profileFailureOf(code))) });
        return false;
      }
      toast({
        tone: "success",
        title: t("desktop.inspect.profile.applied", { count: done.value.written.length }),
        description: t(profileAppliesText(done.value.appliesAt)),
      });
      return true;
    },
    [commands],
  );

  // 원천이 identity로 다시 그릴지 정하므로 같은 객체를 돌려준다
  return useMemo(
    () => ({
      reload,
      reloadOrders,
      toggle,
      reenable,
      keepOff,
      hookKeepOff,
      hookKeepOn,
      remove,
      applyProfile,
    }),
    [
      reload,
      reloadOrders,
      toggle,
      reenable,
      keepOff,
      hookKeepOff,
      hookKeepOn,
      remove,
      applyProfile,
    ],
  );
}
