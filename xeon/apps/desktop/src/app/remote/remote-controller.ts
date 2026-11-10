import { detach, type Result } from "@fresnel/contracts";
import type { ConnectionCommands } from "../../views/commands.ts";
import { isPairingExpired, type ServerMode } from "./remote-model.ts";
import {
  INITIAL_REMOTE_STATE,
  reduce,
  type RemoteAction,
  type RemoteScreenState,
} from "./remote-state.ts";
import type { RemoteAdapter, RemoteError, RemoteStatus, RevokeTarget } from "./remote-types.ts";

// 원격 접속 화면의 컨트롤러(React 없음). 어댑터와 서비스 명령을 부르고, 결과를 `remote-state.ts`의 `reduce`로 화면 상태에 옮긴다.
// 시계와 타이머는 밖에서 받는다. 읽기마다 순번을 달아, 새 읽기나 쓰기 뒤에 늦게 온 옛 응답은 버린다.
// 띄우는 중(`starting`)에는 상태를 3초마다, 시작한 뒤에는 기기 목록을 15초마다 다시 읽는다.

/** 띄우는 중인 상태를 다시 읽는 간격(밀리초) */
const STATUS_POLL_MS = 3000;
/** 시작한 뒤 기기 목록을 다시 읽는 간격(밀리초) */
const DEVICES_POLL_MS = 15000;
/** 기다리지 않는 읽기가 거부될 때 화면에 남기는 실패. 어댑터는 거부 대신 `Result`로 답하므로 실제로는 쓰이지 않는 안전장치다 */
const UNREADABLE: RemoteError = { kind: "failed", message: null };

/**
 * 컨트롤러의 바깥 자리. 어댑터와 서비스 명령은 그대로 부르고, 시계와 타이머와 알림은 주입받는다.
 * `TimerHandle`은 `setTimer`가 돌려주는 값의 타입이라 시험에서는 숫자, 화면에서는 `setTimeout` 핸들이다.
 */
export interface RemoteControllerDeps<TimerHandle> {
  readonly adapter: RemoteAdapter;
  readonly connection: Pick<ConnectionCommands, "startLocalService" | "stopLocalService">;
  /** 현재 시각(epoch 밀리초). 페어링 코드의 만료를 이것으로 본다 */
  readonly now: () => number;
  /** `ms` 뒤에 `fn`을 부르도록 건다. 돌려준 핸들은 `clearTimer`에 넘긴다 */
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  readonly clearTimer: (handle: TimerHandle) => void;
  /** 화면 상태가 바뀔 때마다 부른다 */
  readonly onChange: () => void;
}

/** 원격 접속 화면의 컨트롤러. 화면은 `state()`를 읽고 동작 함수를 부른다. 동작 함수는 끝날 때 끝나는 `Promise`를 돌려준다 */
export interface RemoteController {
  /** 지금 화면 상태. 만료한 페어링 코드는 `none`으로 보인다 */
  state(): RemoteScreenState;
  /** 시작: 상태와 기기 목록을 처음 읽고 기기 목록 주기 읽기를 건다. 이미 시작했으면 아무 일도 없다 */
  start(): void;
  /** 멈춤: 걸린 타이머를 모두 풀고, 이후 도착하는 읽기 응답은 버린다 */
  stop(): void;
  /**
   * 서버 모드를 고른다. `serviceRunning`은 이 기기 서비스가 도는지다.
   * 끄기와 서비스: 외부 접속이 꺼져 있다고 확실히 알 때만 끄기를 건너뛰고, 그 밖에는 먼저 끈다. 끄기는 서비스를 멈추고(떠 있을 때만), 서비스는 띄운다(안 떠 있을 때만).
   * 원격 포함: 서비스를 띄운 뒤 확인 대화 상자만 연다. 외부 접속 켜기는 확인한 뒤에만 보낸다.
   */
  selectMode(mode: ServerMode, serviceRunning: boolean): Promise<void>;
  /** 확인 대화 상자에서 확인: 외부 접속을 한 번 켠다(`setEnabled(true)`). 대화 상자가 떠 있을 때만 된다 */
  confirmRemote(): Promise<void>;
  /** 확인 대화 상자를 닫는다. 어떤 호출도 하지 않는다 */
  cancelConfirm(): void;
  /** 켜기가 실패했을 때 다시 켠다. 상태를 못 읽었거나 `failed`로 끝났을 때만 된다 */
  retryEnable(): Promise<void>;
  /** 페어링 코드를 발급한다. 발급이 끝나면 기기 목록을 다시 읽는다 */
  issuePairing(): Promise<void>;
  /** 기기 하나(`{ id }`)나 전부(`{ all: true }`)를 해제하고 기기 목록을 다시 읽는다 */
  revoke(target: RevokeTarget): Promise<void>;
  /** 상태를 다시 읽는다 */
  reloadStatus(): Promise<void>;
  /** 기기 목록을 다시 읽는다 */
  reloadDevices(): Promise<void>;
}

/** 원격 접속 화면의 컨트롤러를 만든다. 아직 시작하지 않은 상태다(`start()`로 시작한다) */
export function createRemoteController<TimerHandle>(
  deps: RemoteControllerDeps<TimerHandle>,
): RemoteController {
  const { adapter, connection } = deps;
  let current: RemoteScreenState = INITIAL_REMOTE_STATE;
  let started = false;
  // 쓰기 동작(끄기, 켜기, 해제, 서비스 띄우기)이 도는 중에는 다른 쓰기를 받지 않는다. 화면은 `busy`로 단추를 잠그고, 여기서도 한 번 더 막는다
  let writing = false;
  // 읽기 순번. 같은 읽기를 새로 부르거나 쓰기가 끝나면 올라가고, 올라가기 전에 나간 읽기의 응답은 버린다
  let statusSeq = 0;
  let devicesSeq = 0;
  /** 마지막으로 읽은 상태가 `running`이었는가. 아니었다가 바뀔 때만 기기 목록을 다시 읽는다 */
  let wasRunning = false;
  let statusTimer: TimerHandle | null = null;
  let devicesTimer: TimerHandle | null = null;

  function dispatch(action: RemoteAction): void {
    current = reduce(current, action);
    deps.onChange();
  }

  /** 쓰기가 시작한다. 지난 쓰기의 실패 알림은 이때 없앤다 */
  function clearNotice(): void {
    if (current.notice !== null) dispatch({ type: "noticeCleared" });
  }

  function clearStatusTimer(): void {
    if (statusTimer !== null) {
      deps.clearTimer(statusTimer);
      statusTimer = null;
    }
  }

  function clearDevicesTimer(): void {
    if (devicesTimer !== null) {
      deps.clearTimer(devicesTimer);
      devicesTimer = null;
    }
  }

  /**
   * 상태 응답을 화면 상태로 옮기고, 띄우는 중이면 다음 확인을 건다. 외부 접속이 꺼진 동안 읽은 기기 목록은 `remote-off`로 실패했으므로
   * 실행 중으로 바뀌는 순간 목록을 바로 다시 읽는다(15초 주기를 기다리지 않는다).
   */
  function statusReplied(reply: Result<RemoteStatus, RemoteError>): void {
    if (reply.ok) {
      dispatch({ type: "statusLoaded", status: reply.value });
    } else {
      dispatch({ type: "statusFailed", error: reply.error });
    }
    const running = reply.ok && reply.value.state === "running";
    if (running && !wasRunning && started) detachDevicesRead();
    wasRunning = running;
    syncStatusPoll();
  }

  /** 쓰기가 낸 상태 응답. 쓰기 전에 나간 읽기는 옛 값이라 버린다 */
  function statusWritten(reply: Result<RemoteStatus, RemoteError>): void {
    statusSeq += 1;
    statusReplied(reply);
  }

  /** 띄우는 중이고 시작한 상태에서만 상태를 다시 읽는 타이머를 건다. 그 밖에는 걸린 것을 푼다 */
  function syncStatusPoll(): void {
    clearStatusTimer();
    const status = current.status;
    if (!started || status.kind !== "ready" || status.value.state !== "starting") return;
    statusTimer = deps.setTimer(() => {
      statusTimer = null;
      detachStatusRead();
    }, STATUS_POLL_MS);
  }

  async function reloadStatus(): Promise<void> {
    statusSeq += 1;
    const seq = statusSeq;
    const reply = await adapter.status();
    if (seq !== statusSeq) return;
    statusReplied(reply);
  }

  async function reloadDevices(): Promise<void> {
    devicesSeq += 1;
    const seq = devicesSeq;
    const reply = await adapter.devices();
    if (seq !== devicesSeq) return;
    if (reply.ok) {
      dispatch({ type: "devicesLoaded", devices: reply.value });
    } else {
      dispatch({ type: "devicesFailed", error: reply.error });
    }
  }

  /** 기다리지 않고 상태를 읽는다. 거부가 나면 화면 상태에 실패로 남긴다 */
  function detachStatusRead(): void {
    detach(reloadStatus(), () => {
      dispatch({ type: "statusFailed", error: UNREADABLE });
    });
  }

  /** 기다리지 않고 기기 목록을 읽는다. 거부가 나면 화면 상태에 실패로 남긴다 */
  function detachDevicesRead(): void {
    detach(reloadDevices(), () => {
      dispatch({ type: "devicesFailed", error: UNREADABLE });
    });
  }

  /** 기기 목록 주기 읽기. 한 번 울리면 다음 주기를 먼저 건다 */
  function armDevicesPoll(): void {
    clearDevicesTimer();
    devicesTimer = deps.setTimer(() => {
      devicesTimer = null;
      armDevicesPoll();
      detachDevicesRead();
    }, DEVICES_POLL_MS);
  }

  /** 외부 접속이 꺼져 있다고 확실히 읽었는가. 상태를 못 읽었거나 켜져 있으면 `false`다(끄기를 보낸다) */
  function knownDisabled(): boolean {
    const status = current.status;
    return status.kind === "ready" && !status.value.enabled;
  }

  /** 다시 켤 수 있는 때다. 상태 읽기가 실패했거나 외부 접속이 `failed`로 끝났을 때 */
  function retryable(): boolean {
    const status = current.status;
    return status.kind === "failed" || (status.kind === "ready" && status.value.state === "failed");
  }

  /** 외부 접속을 끈다. 실패하면 끄기 실패 알림을 남기고, 호출한 쪽이 다음 단계를 이어 간다 */
  async function disableRemote(): Promise<void> {
    dispatch({ type: "busySet", busy: "disabling" });
    const reply = await adapter.setEnabled(false);
    dispatch({ type: "busySet", busy: "none" });
    if (!reply.ok) dispatch({ type: "noticeSet", kind: "disableFailed" });
    statusWritten(reply);
  }

  async function enableRemote(): Promise<void> {
    dispatch({ type: "busySet", busy: "enabling" });
    const reply = await adapter.setEnabled(true);
    dispatch({ type: "busySet", busy: "none" });
    if (!reply.ok) dispatch({ type: "noticeSet", kind: "enableFailed" });
    statusWritten(reply);
  }

  /** 이 기기 서비스를 띄운다. 실패하면 서비스 실패 알림을 남기고 `false`다 */
  async function startService(): Promise<boolean> {
    const reply = await connection.startLocalService();
    if (!reply.ok) dispatch({ type: "noticeSet", kind: "serviceFailed" });
    return reply.ok;
  }

  /** 이 기기 서비스를 멈춘다. 실패하면 서비스 실패 알림을 남긴다 */
  async function stopService(): Promise<void> {
    const reply = await connection.stopLocalService();
    if (!reply.ok) dispatch({ type: "noticeSet", kind: "serviceFailed" });
  }

  return {
    state() {
      const pairing = current.pairing;
      if (pairing.kind === "issued" && isPairingExpired(pairing.code, deps.now())) {
        return { ...current, pairing: { kind: "none" } };
      }
      return current;
    },

    start() {
      if (started) return;
      started = true;
      dispatch({ type: "loadStarted" });
      detachStatusRead();
      detachDevicesRead();
      armDevicesPoll();
    },

    stop() {
      started = false;
      wasRunning = false;
      statusSeq += 1;
      devicesSeq += 1;
      clearStatusTimer();
      clearDevicesTimer();
    },

    async selectMode(mode, serviceRunning) {
      if (writing) return;
      writing = true;
      try {
        clearNotice();
        if (mode === "service+remote") {
          // 외부 접속은 서비스가 떠 있어야 켤 수 있다. 서비스를 띄우지 못하면 대화 상자를 열지 않는다
          if (!serviceRunning && !(await startService())) return;
          dispatch({ type: "confirmOpened" });
          return;
        }
        // 외부 접속이 꺼져 있다고 확실할 때만 끄기를 건너뛴다. 끄기가 실패해도 서비스 단계는 이어 간다
        if (!knownDisabled()) await disableRemote();
        if (mode === "off") {
          if (serviceRunning) await stopService();
          return;
        }
        if (!serviceRunning) await startService();
      } finally {
        writing = false;
      }
    },

    async confirmRemote() {
      if (writing || !current.confirmOpen) return;
      writing = true;
      try {
        clearNotice();
        dispatch({ type: "confirmClosed" });
        await enableRemote();
      } finally {
        writing = false;
      }
    },

    cancelConfirm() {
      if (current.confirmOpen) dispatch({ type: "confirmClosed" });
    },

    async retryEnable() {
      if (writing || !retryable()) return;
      writing = true;
      try {
        clearNotice();
        await enableRemote();
      } finally {
        writing = false;
      }
    },

    async issuePairing() {
      if (current.pairing.kind === "issuing") return;
      dispatch({ type: "pairStarted" });
      const reply = await adapter.pair();
      if (reply.ok) {
        dispatch({ type: "pairIssued", code: reply.value });
      } else {
        dispatch({ type: "pairFailed", error: reply.error });
      }
      await reloadDevices();
    },

    async revoke(target) {
      if (writing) return;
      writing = true;
      try {
        clearNotice();
        dispatch({ type: "busySet", busy: "revoking" });
        const reply = await adapter.revoke(target);
        dispatch({ type: "busySet", busy: "none" });
        if (reply.ok) {
          dispatch({ type: "deviceRemoved", target });
        } else {
          dispatch({ type: "noticeSet", kind: "revokeFailed" });
        }
        await reloadDevices();
      } finally {
        writing = false;
      }
    },

    reloadStatus,
    reloadDevices,
  };
}
