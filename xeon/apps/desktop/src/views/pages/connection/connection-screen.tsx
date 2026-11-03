import { removeTarget, type TargetEntry } from "@fresnel/client";
import { activeLocale, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import { useEngineState, useLinkPhase } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useConnectError } from "../../../state/ui/index.ts";
import { useCommands } from "../../commands.ts";
import {
  canConnect,
  checkForm,
  choiceOfValue,
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  LOCAL_CHOICE,
  newTargetId,
  toConnectTarget,
  type TargetChoice,
} from "./connection-model.ts";
import { ConnectionScreenView, type ConnectionScreenHandlers } from "./connection-view.tsx";

// 연결 화면(P-08)의 동작. 대상 목록과 상태는 명령(`commands.connection`)으로 부르고, 화면 상태는 `connectionReducer`가 든다.
// 엔진과 연결의 변화는 값이 바뀔 때마다 `engineSeen`으로 넘겨 진행 단계를 맞춘다. 그림은 `connection-view.tsx`가 그린다.

export function ConnectionScreen(): ReactNode {
  const commands = useCommands();
  const engine = useEngineState();
  const link = useLinkPhase();
  const connectError = useConnectError();
  const shell = useShellActions();
  const [state, dispatch] = useReducer(connectionReducer, INITIAL_CONNECTION_STATE);
  // 늦게 온 상태 읽기가 새 읽기를 덮지 않도록 읽기마다 번호를 매긴다
  const latest = useRef(0);
  const live = link === "live";

  const loadTargets = useCallback(async (): Promise<void> => {
    const loaded = await commands.connection.targets();
    dispatch(
      loaded.ok
        ? { type: "targetsChanged", items: loaded.value, notice: null, added: null }
        : { type: "targetsFailed" },
    );
  }, [commands]);

  const loadStatus = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    dispatch({ type: "statusLoading" });
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
  }, [commands]);

  // 화면이 열릴 때 대상 목록을 읽는다
  useEffect(() => {
    detach(loadTargets(), rethrow);
  }, [loadTargets]);

  // 연결이 살아날 때마다 상태를 다시 읽는다. 연결이 없으면 오프라인으로 바꾼다
  useEffect(() => {
    if (live) detach(loadStatus(), rethrow);
    else dispatch({ type: "statusFailed", reason: "offline" });
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
    if (!written.ok) {
      dispatch({
        type: "notice",
        notice: { tone: "danger", id: "desktop.connection.actionFailed" },
      });
      return;
    }
    dispatch({ type: "serviceModeSet", enabled });
  };

  const stopService = async (): Promise<void> => {
    dispatch({ type: "stopConfirm", open: false });
    dispatch({ type: "busy", busy: true });
    const done = await commands.connection.stopService();
    dispatch({ type: "busy", busy: false });
    if (!done.ok) {
      dispatch({
        type: "notice",
        notice: { tone: "danger", id: "desktop.connection.actionFailed" },
      });
      return;
    }
    if (!done.value) {
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
    setServiceMode: (enabled) => {
      detach(writeServiceMode(enabled), rethrow);
    },
    setStopConfirm: (open) => {
      dispatch({ type: "stopConfirm", open });
    },
    confirmStop: () => {
      detach(stopService(), rethrow);
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
    />
  );
}
