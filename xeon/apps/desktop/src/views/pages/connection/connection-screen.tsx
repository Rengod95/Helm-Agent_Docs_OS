import { removeTarget, type TargetEntry } from "@fresnel/client";
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { toast } from "@caustic/react";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useEngineState, useLinkPhase } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useConnectError, useEngineTarget } from "../../../state/ui/index.ts";
import { useCommands } from "../../commands.ts";
import {
  canConnect,
  checkForm,
  choiceOfValue,
  clientsReasonOf,
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  LOCAL_CHOICE,
  newTargetId,
  toConnectTarget,
  type ServiceAction,
  type TargetChoice,
} from "./connection-model.ts";
import { ServerModeSectionContainer } from "./connection-server-container.tsx";
import { ConnectionScreenView, type ConnectionScreenHandlers } from "./connection-view.tsx";

// 연결 화면(P-08)의 동작. 대상 목록과 상태는 명령(`commands.connection`)으로 부르고, 화면 상태는 `connectionReducer`가 든다.
// 엔진과 연결의 변화는 값이 바뀔 때마다 `engineSeen`으로 넘겨 진행 단계를 맞춘다. 그림은 `connection-view.tsx`가 그린다.

export function ConnectionScreen(): ReactNode {
  const commands = useCommands();
  const engine = useEngineState();
  const link = useLinkPhase();
  const connectError = useConnectError();
  const engineTarget = useEngineTarget();
  const shell = useShellActions();
  const [state, dispatch] = useReducer(connectionReducer, INITIAL_CONNECTION_STATE);
  // 화면을 열 때 엔진이 붙은 대상을 잡아 둔다. 목록을 읽은 뒤 이 대상으로 고른 칸과 엔진 칸을 맞춘다(떠났다 돌아와도 같은 대상을 고른다)
  const [openedTarget] = useState(() => engineTarget);
  // 늦게 온 상태 읽기가 새 읽기를 덮지 않도록 읽기마다 번호를 매긴다
  const latest = useRef(0);
  const live = link === "live";

  const loadTargets = useCallback(async (): Promise<void> => {
    const loaded = await commands.connection.targets();
    if (!loaded.ok) {
      dispatch({ type: "targetsFailed" });
      return;
    }
    dispatch({ type: "targetsChanged", items: loaded.value, notice: null, added: null });
    dispatch({ type: "engineTargetSeen", target: openedTarget });
  }, [commands, openedTarget]);

  // 연결된 클라이언트 목록은 상태 카드와 따로 읽는다. 목록 읽기가 실패하거나 늦어도 상태 카드는 그대로 그려진다
  const latestClients = useRef(0);

  const loadClients = useCallback(async (): Promise<void> => {
    latestClients.current += 1;
    const seq = latestClients.current;
    dispatch({ type: "clientsLoading" });
    const listed = await commands.connection.clients();
    if (seq !== latestClients.current) return;
    dispatch(
      listed.ok
        ? { type: "clientsLoaded", clients: listed.value }
        : { type: "clientsFailed", reason: clientsReasonOf(listed.error) },
    );
  }, [commands]);

  const loadStatus = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    dispatch({ type: "statusLoading" });
    // 목록은 상태를 읽을 때 같이 다시 읽는다(기다리지 않는다)
    detach(loadClients(), rethrow);
    const loaded = await commands.connection.load();
    if (seq !== latest.current) return;
    if (loaded.ok) {
      dispatch({ type: "statusLoaded", snapshot: loaded.value });
    } else {
      dispatch({
        type: "statusFailed",
        reason: loaded.error.kind === "offline" ? "offline" : "failed",
      });
    }
  }, [commands, loadClients]);

  // 화면이 열릴 때 대상 목록을 읽는다
  useEffect(() => {
    detach(loadTargets(), rethrow);
  }, [loadTargets]);

  // 연결이 살아날 때마다 상태와 클라이언트 목록을 다시 읽는다. 연결이 없으면 둘 다 오프라인으로 바꾼다
  useEffect(() => {
    if (live) {
      detach(loadStatus(), rethrow);
    } else {
      dispatch({ type: "statusFailed", reason: "offline" });
      dispatch({ type: "clientsFailed", reason: "offline" });
    }
  }, [live, loadStatus]);

  // 엔진 상태, 연결 상태, 연결 실패 코드가 바뀔 때마다 진행을 맞춘다. 진행 중이 아니면 아무 일도 없다
  useEffect(() => {
    dispatch({ type: "engineSeen", observed: { engine, link, connectError } });
  }, [engine, link, connectError]);

  const saveTargets = async (
    list: readonly TargetEntry[],
    notice: MessageId | null,
    added: TargetEntry | null,
  ): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const saved = await commands.connection.saveTargets(list);
    dispatch({ type: "busy", busy: false });
    if (!saved.ok) {
      dispatch({
        type: "notice",
        notice: { tone: "danger", id: "desktop.connection.targets.saveFailed" },
      });
      return;
    }
    dispatch({
      type: "targetsChanged",
      items: list,
      notice: notice === null ? null : { tone: "success", id: notice },
      added,
    });
  };

  /** 셸에 대상 바꾸기를 보낸다. 거절되면 이전 대상으로 되돌린다(모델이 한다). 진행은 관찰이 알린다 */
  const requestRetarget = async (choice: TargetChoice): Promise<void> => {
    const done = await commands.connection.retarget(toConnectTarget(choice));
    if (!done.ok) dispatch({ type: "connectRejected", kind: done.error });
  };

  const connect = (choice: TargetChoice): void => {
    dispatch({ type: "connectStarted", target: choice, observed: { engine, link, connectError } });
    detach(requestRetarget(choice), rethrow);
  };

  const retry = (): void => {
    const failure = state.failure;
    if (failure === null) return;
    dispatch({
      type: "connectStarted",
      target: failure.target,
      observed: { engine, link, connectError },
    });
    // 셸이 거절했으면 같은 대상으로 다시 보내고, 엔진이나 연결이 실패했으면 다시 띄우거나 다시 잇는다
    detach(
      failure.retry === "connect" ? requestRetarget(failure.target) : commands.connection.retry(),
      rethrow,
    );
  };

  const submitForm = (): void => {
    const form = state.form;
    if (form === null || state.busy) return;
    const checked = checkForm(state.items, form, newTargetId(Date.now()));
    if (!checked.ok) {
      dispatch({ type: "formFailed", errors: checked.errors });
      return;
    }
    detach(saveTargets(checked.list, "desktop.connection.targets.added", checked.entry), rethrow);
  };

  const remove = (id: string): void => {
    detach(
      saveTargets(removeTarget(state.items, id), "desktop.connection.targets.removed", null),
      rethrow,
    );
  };

  const writeServiceMode = async (enabled: boolean): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const written = await commands.connection.setServiceMode(enabled);
    dispatch({ type: "busy", busy: false });
    if (written.ok) {
      dispatch({ type: "serviceModeSet", enabled });
    } else {
      dispatch({
        type: "notice",
        notice: { tone: "danger", id: "desktop.connection.actionFailed" },
      });
    }
    // 켜거나 끈 뒤 상태 카드와 스위치를 다시 읽는다. 엔진이 다시 뜨는 동안이면 연결이 살아날 때 한 번 더 읽는다
    await loadStatus();
  };

  /** 이 기기 서비스 카드의 시작이나 멈추기. 실패는 카드에 한 줄로 남기고, 끝나면 상태를 다시 읽는다 */
  const runServiceAction = async (action: ServiceAction): Promise<void> => {
    dispatch({ type: "serviceError", action: null });
    dispatch({ type: "serviceBusy", action });
    const done =
      action === "start"
        ? await commands.connection.startLocalService()
        : await commands.connection.stopLocalService();
    dispatch({ type: "serviceBusy", action: null });
    dispatch({ type: "serviceError", action: done.ok ? null : action });
    await loadStatus();
  };

  const writeRemoteRespond = async (enabled: boolean): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const written = await commands.connection.setRemoteRespond(enabled);
    dispatch({ type: "busy", busy: false });
    if (!written.ok) {
      dispatch({
        type: "notice",
        notice: { tone: "danger", id: "desktop.connection.actionFailed" },
      });
      return;
    }
    dispatch({ type: "remoteRespondSet", enabled });
  };

  /** 원격 서비스를 협조 종료한다(`host.shutdown`). 받아들여졌으면 참이다 */
  const stopRemoteHost = async (): Promise<boolean> => {
    const done = await commands.connection.stopService();
    return done.ok && done.value;
  };

  /** 이 기기의 서비스를 멈춘다. 엔진은 앱 안에서 다시 뜬다 */
  const stopLocalHost = async (): Promise<boolean> => {
    const done = await commands.connection.stopLocalService();
    return done.ok;
  };

  /** 서비스 멈추기 확인 뒤. 원격 대상이면 `host.shutdown`, 이 기기면 로컬 서비스 멈추기를 부른다 */
  const stopHost = async (): Promise<void> => {
    dispatch({ type: "stopConfirm", open: false });
    dispatch({ type: "busy", busy: true });
    const stopped =
      state.engineTarget.kind === "remote" ? await stopRemoteHost() : await stopLocalHost();
    dispatch({ type: "busy", busy: false });
    if (!stopped) {
      dispatch({
        type: "notice",
        notice: { tone: "danger", id: "desktop.connection.actionFailed" },
      });
      return;
    }
    dispatch({ type: "notice", notice: { tone: "success", id: "desktop.connection.stopped" } });
    await loadStatus();
  };

  const handlers: ConnectionScreenHandlers = {
    select: (value) => {
      const choice = choiceOfValue(state.items, value);
      if (choice !== null) dispatch({ type: "select", choice });
    },
    query: (text) => {
      dispatch({ type: "query", text });
    },
    connect: () => {
      if (canConnect(state)) connect(state.selected);
    },
    retry,
    backToLocal: () => {
      connect(LOCAL_CHOICE);
    },
    remove,
    openForm: () => {
      dispatch({ type: "formOpened" });
    },
    closeForm: () => {
      dispatch({ type: "formClosed" });
    },
    formField: (field, value) => {
      dispatch({ type: "formField", field, value });
    },
    submitForm,
    dismissNotice: () => {
      dispatch({ type: "notice", notice: null });
    },
    restart: () => {
      // 엔진 다시 시작은 진행 단계를 따로 잡지 않는다. 멈춘 엔진이 아니면 셸이 거절하고 세션이 다시 잇는다
      detach(commands.restartEngine(), rethrow);
    },
    copyDiagnostics: () => {
      detach(
        commands.copyDiagnostics().then((ok) => {
          if (ok) toast({ tone: "success", title: t("desktop.connection.status.copied") });
          return undefined;
        }),
        rethrow,
      );
    },
    retryClients: () => {
      detach(loadClients(), rethrow);
    },
    setServiceMode: (enabled) => {
      detach(writeServiceMode(enabled), rethrow);
    },
    startLocalService: () => {
      detach(runServiceAction("start"), rethrow);
    },
    stopLocalService: () => {
      detach(runServiceAction("stop"), rethrow);
    },
    setRemoteRespond: (enabled) => {
      detach(writeRemoteRespond(enabled), rethrow);
    },
    setStopConfirm: (open) => {
      dispatch({ type: "stopConfirm", open });
    },
    confirmStop: () => {
      detach(stopHost(), rethrow);
    },
    openExtensions: () => {
      // LightCraft 엔진(작업대) 화면으로 간다. 영역을 바꾸고 작업대 자리의 화면을 `engine`으로 둔다
      shell.switchArea("workbench");
      shell.updatePlace({ screen: "engine", scroll: 0 });
    },
  };

  return (
    <ConnectionScreenView
      state={state}
      engine={engine}
      locale={activeLocale()}
      handlers={handlers}
      serverSection={
        <ServerModeSectionContainer serviceRunning={state.service.kind === "running"} />
      }
    />
  );
}
