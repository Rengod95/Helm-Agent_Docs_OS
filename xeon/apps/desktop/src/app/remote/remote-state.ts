import { assertNever } from "@fresnel/contracts";
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

/** 진행 중인 쓰기 동작. 같은 동작을 두 번 보내지 않도록 버튼을 잠근다 */
export type RemoteBusy = "none" | "enabling" | "disabling" | "revoking";

/**
 * 마지막 쓰기가 실패했다는 알림의 종류. `enableFailed`는 외부 접속 켜기, `disableFailed`는 끄기,
 * `serviceFailed`는 이 기기 서비스 띄우기·멈추기, `revokeFailed`는 기기 해제가 실패했다는 뜻이다
 */
export type RemoteNoticeKind = "enableFailed" | "disableFailed" | "serviceFailed" | "revokeFailed";

/** 쓰기 실패 알림 한 건. 다음 쓰기가 시작하면 없어진다 */
export interface RemoteNotice {
  readonly kind: RemoteNoticeKind;
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
  /** 쓰기가 실패했다고 알린다. 같은 자리에 있던 알림은 새 것으로 바뀐다 */
  | { readonly type: "noticeSet"; readonly kind: RemoteNoticeKind }
  /** 알림을 없앤다(다음 쓰기가 시작할 때) */
  | { readonly type: "noticeCleared" };

export const INITIAL_REMOTE_STATE: RemoteScreenState = {
  status: { kind: "loading" },
  devices: { kind: "loading" },
  pairing: { kind: "none" },
  confirmOpen: false,
  busy: "none",
  notice: null,
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
      return { ...state, status: { kind: "loading" }, devices: { kind: "loading" } };
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
      return { ...state, notice: { kind: action.kind } };
    case "noticeCleared":
      return { ...state, notice: null };
    default:
      return assertNever(action, "RemoteAction");
  }
}
