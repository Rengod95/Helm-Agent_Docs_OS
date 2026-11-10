import { useEffect, useMemo, useReducer } from "react";
import type { ConnectionCommands } from "../../views/commands.ts";
import { createRemoteController, type RemoteController } from "./remote-controller.ts";
import type { ServerMode } from "./remote-model.ts";
import type { RemoteScreenState } from "./remote-state.ts";
import type { RemoteAdapter, RevokeTarget } from "./remote-types.ts";

// 원격 접속 화면의 React 훅. 컨트롤러를 한 번 만들고, 화면이 마운트되면 `start`, 떠나면 `stop`을 부른다.
// 상태가 바뀌면 컨트롤러의 `onChange`가 다시 그리기를 부르고, 그릴 때 `state()`를 새로 읽는다.
// 어댑터와 연결 명령은 안정된 참조여야 한다(바뀌면 컨트롤러를 새로 만들어 다시 시작한다). 시계와 타이머는 실제 것을 쓴다.

/** 화면이 부르는 동작. 컨트롤러 동작과 같고, 상태 읽기는 `state`로만 한다 */
export interface RemoteActions {
  selectMode(mode: ServerMode, serviceRunning: boolean): Promise<void>;
  confirmRemote(): Promise<void>;
  cancelConfirm(): void;
  retryEnable(): Promise<void>;
  issuePairing(): Promise<void>;
  revoke(target: RevokeTarget): Promise<void>;
  reloadStatus(): Promise<void>;
  reloadDevices(): Promise<void>;
}

/** 훅의 결과. `state`는 그릴 때 읽은 값이다 */
export interface RemoteScreen {
  readonly state: RemoteScreenState;
  readonly actions: RemoteActions;
}

/** 훅이 받는 서비스 명령(띄우기와 멈추기) */
export type RemoteServiceCommands = Pick<
  ConnectionCommands,
  "startLocalService" | "stopLocalService"
>;

/** 원격 접속 화면의 상태와 동작을 훅으로 준다. 마운트하면 상태를 읽기 시작하고, 떠나면 타이머를 모두 푼다 */
export function useRemoteController(
  adapter: RemoteAdapter,
  connection: RemoteServiceCommands,
): RemoteScreen {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const controller = useMemo(
    () =>
      createRemoteController<ReturnType<typeof setTimeout>>({
        adapter,
        connection,
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (handle) => {
          clearTimeout(handle);
        },
        onChange: () => {
          redraw();
        },
      }),
    [adapter, connection],
  );

  useEffect(() => {
    controller.start();
    return () => {
      controller.stop();
    };
  }, [controller]);

  const actions = useMemo(() => actionsOf(controller), [controller]);
  return { state: controller.state(), actions };
}

/** 컨트롤러 동작을 화면 동작으로 옮긴다. 동작마다 자기 함수로 감싸 컨트롤러의 상태 읽기가 새지 않게 한다 */
function actionsOf(controller: RemoteController): RemoteActions {
  return {
    selectMode: (mode, serviceRunning) => controller.selectMode(mode, serviceRunning),
    confirmRemote: () => controller.confirmRemote(),
    cancelConfirm: () => {
      controller.cancelConfirm();
    },
    retryEnable: () => controller.retryEnable(),
    issuePairing: () => controller.issuePairing(),
    revoke: (target) => controller.revoke(target),
    reloadStatus: () => controller.reloadStatus(),
    reloadDevices: () => controller.reloadDevices(),
  };
}
