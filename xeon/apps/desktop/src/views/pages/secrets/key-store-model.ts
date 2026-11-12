import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import type {
  SecretKeyMoveResult,
  SecretKeyStatusResult,
  SecretKeyWhere,
} from "@fresnel/contracts/wire";
import { assertNever } from "@fresnel/contracts";
import type { SecretCommandError } from "../../commands.ts";
import { commandErrorText, type MessageRef } from "./secret-text.ts";

// 시크릿 구역의 "열쇠 보관" 줄(L0.secrets.spec §4.7 (b)·(c), [결정: 2026-11-12 사용자]). 위치와 방식만 다룬다. 값과 식별자는 없다.
// 그림은 `key-store-row.tsx`, 확인 대화 상자는 `key-store-confirm.tsx`가 맡는다.

/** 열쇠 보관 방식. `secret.keyStatus`의 `source`(auto·auto-file)는 이 둘 가운데 하나로 고른 것으로 보인다 */
export type KeyWhere = SecretKeyWhere;

/** 위치 읽기 상태. 읽기 전이면 줄은 기다린다 */
export type KeyStoreRead =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: SecretKeyStatusResult }
  | { readonly kind: "failed"; readonly error: SecretCommandError };

/** 옮기기 한 번의 상태. 실패하면 화면은 위치를 다시 읽어 제자리 상태를 보인다 */
export type KeyStoreMove =
  | { readonly kind: "idle" }
  | { readonly kind: "moving"; readonly to: KeyWhere }
  | { readonly kind: "done"; readonly result: SecretKeyMoveResult }
  | { readonly kind: "failed"; readonly error: SecretCommandError };

/** 줄 아래 메시지 한 줄. `fix`가 있으면 그 밑에 고치는 법 한 문장을 둔다 */
export interface KeyStoreNote {
  readonly tone: "warning" | "danger";
  readonly text: MessageRef;
  readonly fix: MessageRef | null;
}

export interface KeyStoreView {
  /** 세그먼트에서 고른 방식. 위치를 읽기 전이면 `null`이다 */
  readonly selected: KeyWhere | null;
  /** 줄을 끈다: 연결이 없거나, 위치를 읽지 못했거나, 옮기는 중이거나, 이 컴퓨터에서만 바꿀 수 있을 때 */
  readonly disabled: boolean;
  /** 이 컴퓨터에서만 바꿀 수 있다(원격 연결이거나 옮기기가 `localOnly`로 거절됐다) */
  readonly readOnly: boolean;
  /** 이름표 아래 상태 글. 읽기 전이면 `null` */
  readonly status: MessageRef | null;
  readonly notes: readonly KeyStoreNote[];
}

/** 줄이 든 두 상태. 화면이 reducer로 바꾼다(효과 안에서 상태를 직접 쓰지 않는다) */
export interface KeyStoreState {
  readonly read: KeyStoreRead;
  readonly move: KeyStoreMove;
}

export const INITIAL_KEY_STORE: KeyStoreState = { read: { kind: "idle" }, move: { kind: "idle" } };

export type KeyStoreAction =
  | { readonly type: "read"; readonly read: KeyStoreRead }
  | { readonly type: "move"; readonly move: KeyStoreMove };

export function keyStoreReducer(state: KeyStoreState, action: KeyStoreAction): KeyStoreState {
  switch (action.type) {
    case "read":
      return { ...state, read: action.read };
    case "move":
      return { ...state, move: action.move };
    default:
      return assertNever(action, "KeyStoreAction");
  }
}

function ref(id: MessageId, args: MessageArgs = {}): MessageRef {
  return { id, args };
}

/** 세그먼트의 선택. 방식을 고른 것이면 그 방식, 자동이면 열쇠가 있는 쪽, 없으면 쓸 수 있는 쪽이다 */
export function keyStoreSelectedOf(status: SecretKeyStatusResult): KeyWhere {
  if (status.source === "keychain" || status.source === "file") return status.source;
  if (status.in === "keychain" || status.in === "file") return status.in;
  return status.keychainUsable ? "keychain" : "file";
}

/** 열쇠가 어디에 있는지 한 문장 */
function keyStoreStatusOf(status: SecretKeyStatusResult): MessageRef {
  if (status.in === "keychain") return ref("desktop.secrets.keyStore.inKeychain");
  if (status.in === "file")
    return ref("desktop.secrets.keyStore.inFile", { path: status.filePath });
  return ref("desktop.secrets.keyStore.none");
}

/** 옮기기가 끝난 뒤의 성공 문장. 옮긴 것이면 "옮겼어요", 옮길 열쇠가 없어 설정만 바꿨으면 "이제 이 방식으로 만들어요" */
export function keyStoreDoneOf(result: SecretKeyMoveResult): MessageRef {
  return result.moved
    ? ref("desktop.secrets.keyStore.moved")
    : ref("desktop.secrets.keyStore.setOnly");
}

/** 옮기기 실패의 해결 한 문장. 원인 문장에 고치는 법이 이미 있으면(키 저장소 잠금) `null`이다 */
function fixOf(error: SecretCommandError): MessageRef | null {
  if (error.kind === "writeFailed") return ref("desktop.secrets.keyStore.fix.writeFailed");
  if (error.kind === "failed") return ref("desktop.secrets.keyStore.fix.failed");
  return null;
}

/**
 * 줄의 그림 상태. 읽기 결과, 옮기기 상태, 원격 여부(연결 대상이 원격이면 `remote`)로 정한다.
 * 옮기는 동안은 고른 쪽을 옮기려는 쪽으로 보인다. 옮긴 뒤에는 화면이 위치를 다시 읽는다.
 */
export function keyStoreViewOf(input: {
  readonly read: KeyStoreRead;
  readonly move: KeyStoreMove;
  readonly remote: boolean;
  readonly live: boolean;
}): KeyStoreView {
  const { read, move } = input;
  const readOnly = input.remote || (move.kind === "failed" && move.error.kind === "localOnly");
  const selected =
    move.kind === "moving"
      ? move.to
      : read.kind === "ready"
        ? keyStoreSelectedOf(read.status)
        : null;
  const status =
    move.kind === "moving"
      ? ref("desktop.secrets.keyStore.moving")
      : read.kind === "ready"
        ? keyStoreStatusOf(read.status)
        : read.kind === "failed"
          ? commandErrorText(read.error)
          : read.kind === "loading"
            ? ref("desktop.secrets.keyStore.loading")
            : null;
  const notes: KeyStoreNote[] = [];
  if (readOnly) {
    notes.push({ tone: "warning", text: ref("desktop.secrets.keyStore.readOnly"), fix: null });
  }
  if (read.kind === "ready" && read.status.fileMissing) {
    notes.push({
      tone: "danger",
      text: ref("desktop.secrets.keyStore.fileMissing", { path: read.status.filePath }),
      fix: null,
    });
  }
  if (move.kind === "done" && move.result.moved && !move.result.oldRemoved) {
    notes.push({ tone: "warning", text: ref("desktop.secrets.keyStore.oldKept"), fix: null });
  }
  if (move.kind === "failed" && move.error.kind !== "localOnly") {
    notes.push({
      tone: "danger",
      text: commandErrorText(move.error),
      fix: fixOf(move.error),
    });
  }
  return {
    selected,
    disabled: !input.live || read.kind !== "ready" || move.kind === "moving" || readOnly,
    readOnly,
    status,
    notes,
  };
}
