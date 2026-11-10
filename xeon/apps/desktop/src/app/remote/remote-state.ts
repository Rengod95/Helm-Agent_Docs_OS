import { assertNever } from "@fresnel/contracts";
import type { ServiceAutostart } from "../../transport/ipc.ts";
import type { AutostartError } from "../../views/commands.ts";
import type {
  PairingCode,
  RemoteDevice,
  RemoteError,
  RemoteStatus,
  RevokeTarget,
} from "./remote-types.ts";

// 원격 접속 화면의 상태와 전이. 순수 함수만 둔다: 명령을 부르는 일은 화면이 맡고, 결과 값을 이 reducer의 동작으로 옮긴다.
// 목록과 상태는 읽기 전에 `loading`이고, 읽기가 끝나면 `ready`나 `failed`가 된다. 기기 목록이 비었으면 `ready`에 `[]`다.

/** 읽기 한 칸. 읽는 중, 값이 있음, 읽기 실패 가운데 하나다 */
export type Loadable<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed"; readonly error: RemoteError };

/** 페어링 코드 발급 상태 */
export type PairingState =
  | { readonly kind: "none" }
  | { readonly kind: "issuing" }
  | { readonly kind: "issued"; readonly code: PairingCode }
  | { readonly kind: "failed"; readonly error: RemoteError };

/** 진행 중인 쓰기 동작. 같은 동작을 두 번 보내지 않도록 버튼을 잠근다. `autostart`는 로그인 자동 시작 켜기·끄기다 */
type RemoteBusy = "none" | "enabling" | "disabling" | "revoking" | "autostart";

/**
 * 마지막 쓰기가 실패했다는 알림의 종류. `enableFailed`는 외부 접속 켜기, `disableFailed`는 끄기,
 * `serviceFailed`는 이 기기 서비스 띄우기·멈추기, `revokeFailed`는 기기 해제가 실패했다는 뜻이다.
 * `autostartFailed`는 로그인 자동 시작 켜기·끄기다. 이때만 알림에 셸이 준 닫힌 오류 코드가 붙는다.
 */
type RemoteNoticeKind =
  | "enableFailed"
  | "disableFailed"
  | "serviceFailed"
  | "revokeFailed"
  | "autostartFailed";

/** 쓰기 실패 알림 한 건. 다음 쓰기가 시작하면 없어진다. `code`는 자동 시작 실패일 때만 있고 나머지는 `null`이다 */
export interface RemoteNotice {
  readonly kind: RemoteNoticeKind;
  readonly code: AutostartError["code"] | null;
}

export interface RemoteScreenState {
  readonly status: Loadable<RemoteStatus>;
  readonly devices: Loadable<readonly RemoteDevice[]>;
  readonly pairing: PairingState;
  /** 외부 접속 켜기 확인 대화 상자(서버 모드 "원격 포함"에서 여는 것)가 떠 있는가. 기기 해제 확인이 아니다 */
  readonly confirmOpen: boolean;
  readonly busy: RemoteBusy;
  /** 마지막 쓰기의 실패 알림. 없으면 `null`이다 */
  readonly notice: RemoteNotice | null;
  /** 로그인 자동 시작 상태(`service_status`의 `autostart`). 읽기 전이면 `loading`, 못 읽었으면 `failed`다 */
  readonly autostart: Loadable<ServiceAutostart>;
  /** 로그인 자동 시작 켜기 확인 대화 상자가 떠 있는가. 끄기는 확인 없이 바로 보낸다 */
  readonly autostartConfirmOpen: boolean;
  /** 자동 시작을 켠 답이 Linux linger 안내를 냈는가. 다음 자동 시작 쓰기가 시작하면 없어진다(한 번만 보인다) */
  readonly autostartLinger: boolean;
}

export type RemoteAction =
  | { readonly type: "loadStarted" }
  | { readonly type: "statusLoaded"; readonly status: RemoteStatus }
  | { readonly type: "statusFailed"; readonly error: RemoteError }
  | { readonly type: "devicesLoaded"; readonly devices: readonly RemoteDevice[] }
  | { readonly type: "devicesFailed"; readonly error: RemoteError }
  | { readonly type: "pairStarted" }
  | { readonly type: "pairIssued"; readonly code: PairingCode }
  | { readonly type: "pairFailed"; readonly error: RemoteError }
  | { readonly type: "confirmOpened" }
  | { readonly type: "confirmClosed" }
  | { readonly type: "busySet"; readonly busy: RemoteBusy }
  /** 해제가 끝났다. 기기 하나면 그 줄을 빼고, 전부면 목록을 비운다. 목록을 아직 못 읽었으면 그대로다 */
  | { readonly type: "deviceRemoved"; readonly target: RevokeTarget }
  /** 쓰기가 실패했다고 알린다. 같은 자리에 있던 알림은 새 것으로 바뀐다. 자동 시작 실패면 `code`로 닫힌 코드를 싣는다 */
  | {
      readonly type: "noticeSet";
      readonly kind: RemoteNoticeKind;
      readonly code?: AutostartError["code"];
    }
  /** 알림을 없앤다(다음 쓰기가 시작할 때) */
  | { readonly type: "noticeCleared" }
  | { readonly type: "autostartLoaded"; readonly autostart: ServiceAutostart }
  /** 자동 시작 상태를 못 읽었다. 화면은 스위치 대신 다시 읽기 알림을 보인다 */
  | { readonly type: "autostartFailed" }
  | { readonly type: "autostartConfirmOpened" }
  | { readonly type: "autostartConfirmClosed" }
  | { readonly type: "autostartLingerSet"; readonly shown: boolean };

export const INITIAL_REMOTE_STATE: RemoteScreenState = {
  status: { kind: "loading" },
  devices: { kind: "loading" },
  pairing: { kind: "none" },
  confirmOpen: false,
  busy: "none",
  notice: null,
  autostart: { kind: "loading" },
  autostartConfirmOpen: false,
  autostartLinger: false,
};

/** 해제 결과를 목록에 옮긴다. 목록이 `ready`가 아니면 바꿀 것이 없다 */
function removeDevices(state: RemoteScreenState, target: RevokeTarget): RemoteScreenState {
  if (state.devices.kind !== "ready") return state;
  const kept: readonly RemoteDevice[] =
    "all" in target ? [] : state.devices.value.filter((device) => device.id !== target.id);
  return { ...state, devices: { kind: "ready", value: kept } };
}

export function reduce(state: RemoteScreenState, action: RemoteAction): RemoteScreenState {
  switch (action.type) {
    case "loadStarted":
      return {
        ...state,
        status: { kind: "loading" },
        devices: { kind: "loading" },
        autostart: { kind: "loading" },
      };
    case "statusLoaded":
      return { ...state, status: { kind: "ready", value: action.status } };
    case "statusFailed":
      return { ...state, status: { kind: "failed", error: action.error } };
    case "devicesLoaded":
      return { ...state, devices: { kind: "ready", value: action.devices } };
    case "devicesFailed":
      return { ...state, devices: { kind: "failed", error: action.error } };
    case "pairStarted":
      return { ...state, pairing: { kind: "issuing" } };
    case "pairIssued":
      return { ...state, pairing: { kind: "issued", code: action.code } };
    case "pairFailed":
      return { ...state, pairing: { kind: "failed", error: action.error } };
    case "confirmOpened":
      return { ...state, confirmOpen: true };
    case "confirmClosed":
      return { ...state, confirmOpen: false };
    case "busySet":
      return { ...state, busy: action.busy };
    case "deviceRemoved":
      return removeDevices(state, action.target);
    case "noticeSet":
      return { ...state, notice: { kind: action.kind, code: action.code ?? null } };
    case "noticeCleared":
      return { ...state, notice: null };
    case "autostartLoaded":
      return { ...state, autostart: { kind: "ready", value: action.autostart } };
    case "autostartFailed":
      return { ...state, autostart: { kind: "failed", error: { kind: "failed", message: null } } };
    case "autostartConfirmOpened":
      return { ...state, autostartConfirmOpen: true };
    case "autostartConfirmClosed":
      return { ...state, autostartConfirmOpen: false };
    case "autostartLingerSet":
      return { ...state, autostartLinger: action.shown };
    default:
      return assertNever(action, "RemoteAction");
  }
}
