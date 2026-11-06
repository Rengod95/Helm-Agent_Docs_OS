import { assertNever } from "@fresnel/contracts";
import {
  canCheck,
  canDownload,
  canInstall,
  INITIAL_UPDATE_STATE,
  reduceUpdate,
  retryStepOf,
  type UpdateEvent,
  type UpdateState,
} from "./update-model.ts";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  readUpdaterStatus,
  type UpdateChannelOf,
  type UpdateInvoke,
} from "./update-invoke.ts";

// 업데이트 흐름의 동작(B-10). 상태는 `update-model.ts`의 리듀서가 바꾸고, 이 컨트롤러는 명령을 어떤 순서로 부를지와
// 겹침을 맡는다. 확인, 내려받기, 설치 가운데 하나가 도는 동안의 다른 호출은 무시한다.
// 화면은 `useSyncExternalStore(controller.subscribe, controller.getState)`로 읽는다. 설치가 성공하면 앱이 다시 시작되므로
// 설치 호출은 돌아오지 않는다.

export interface UpdateController {
  /** 지금 상태. 바뀌지 않으면 같은 객체를 돌려준다 */
  readonly getState: () => UpdateState;
  readonly subscribe: (listener: () => void) => () => void;
  /** 지금 실행 중인 버전. 시작 때 설정을 읽기 전에는 `null`이다 */
  readonly currentVersion: () => string | null;
  /** 앱을 열 때 한 번 부른다. 설정이 안 됐으면 `unconfigured`로 끝나고, 되어 있으면 조용히 확인한다 */
  readonly start: () => Promise<void>;
  /** 새 버전이 있는지 확인한다(설정 줄의 단추) */
  readonly check: () => Promise<void>;
  /** 찾은 업데이트를 내려받는다 */
  readonly download: () => Promise<void>;
  /** 내려받은 것을 설치하고 앱을 다시 시작한다. 진행 중인 턴을 묻는 것은 화면이 먼저 한다 */
  readonly installAndRestart: () => Promise<void>;
  /** 실패나 오프라인에서 멈춘 단계를 다시 한다. 멈춘 단계가 없으면 아무 일도 없다 */
  readonly retry: () => Promise<void>;
}

export interface UpdatePort {
  readonly invoke: UpdateInvoke;
  readonly createChannel: UpdateChannelOf;
}

export function createUpdateController(port: UpdatePort): UpdateController {
  let state: UpdateState = INITIAL_UPDATE_STATE;
  let version: string | null = null;
  let busy = false;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const dispatch = (event: UpdateEvent): void => {
    const next = reduceUpdate(state, event);
    if (next === state) return;
    state = next;
    emit();
  };
  /** 다른 작업이 도는 동안에는 아무것도 하지 않는다. 작업이 끝나면(성공이든 실패든) 다시 열린다 */
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
  };

  const start = (): Promise<void> =>
    run(async () => {
      const status = await readUpdaterStatus(port.invoke);
      if (status.ok) {
        version = status.value.currentVersion;
        emit();
        if (!status.value.configured) {
          dispatch({ kind: "checkFinished", outcome: { kind: "notConfigured" } });
          return;
        }
      }
      // 설정을 읽지 못했으면 확인 명령이 설정 안 됨을 알려 준다(명령이 같은 규칙으로 답한다)
      dispatch({ kind: "checkStarted" });
      dispatch({ kind: "checkFinished", outcome: await checkForUpdate(port.invoke) });
    });

  const check = (): Promise<void> =>
    run(async () => {
      if (!canCheck(state)) return;
      dispatch({ kind: "checkStarted" });
      dispatch({ kind: "checkFinished", outcome: await checkForUpdate(port.invoke) });
    });

  const download = (): Promise<void> =>
    run(async () => {
      if (!canDownload(state)) return;
      dispatch({ kind: "downloadStarted" });
      const outcome = await downloadUpdate(port.invoke, port.createChannel, (progress) => {
        dispatch({ kind: "progress", downloaded: progress.downloaded, total: progress.total });
      });
      dispatch({ kind: "downloadFinished", outcome });
    });

  const installAndRestart = (): Promise<void> =>
    run(async () => {
      if (!canInstall(state)) return;
      dispatch({ kind: "installStarted" });
      dispatch({ kind: "installFinished", outcome: await installUpdate(port.invoke) });
    });

  const retry = (): Promise<void> => {
    const step = retryStepOf(state);
    switch (step) {
      case "check":
        return check();
      case "download":
        return download();
      case "install":
        return installAndRestart();
      case null:
        return Promise.resolve();
      default:
        return assertNever(step, "UpdateStage");
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    currentVersion: () => version,
    start,
    check,
    download,
    installAndRestart,
    retry,
  };
}
