import type { PreviousRemoved, StorageUsage } from "../../../transport/ipc.ts";
import type { StorageCommands, StorageFailure } from "../../commands.ts";

// 설정 고급 탭의 저장 공간 구역(P-09)의 상태와 흐름. 그림은 `settings-storage-view.tsx`, 화면 연결은 `settings-storage-screen.tsx`.
// 사용량은 셸이 `fresnel db usage`로 읽은 값이다. 원격 엔진이면 데이터 폴더가 이 기기의 것이 아니므로 읽지 않는다.
// 지우기는 복원 전 사본을 하나씩 한다. 확인하면 그 이름으로 `removePrevious`를 한 번 부르고, 지웠으면 사용량을 다시 읽는다.

type StorageLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly usage: StorageUsage }
  | { readonly kind: "failed"; readonly failure: StorageFailure }
  | { readonly kind: "remote" };

export interface StorageState {
  readonly load: StorageLoad;
  /** 지우기 확인 대화 상자가 가리키는 사본 이름. 대화 상자가 닫혀 있으면 `null`이다 */
  readonly removing: string | null;
  /** 지우기 명령이 가는 중이다 */
  readonly removeBusy: boolean;
  /** 마지막 지우기가 실패했으면 그 까닭 */
  readonly removeFailure: StorageFailure | null;
}

export type StorageRowKey =
  | "conversations"
  | "attachments"
  | "measurements"
  | "logs"
  | "restorePrevious";

export interface StorageRow {
  readonly key: StorageRowKey;
  /** 바이트 수 */
  readonly bytes: number;
}

/** 사용량을 화면의 줄 순서로 바꾼다. 줄의 글은 화면이 고른다 */
export function storageRowsOf(usage: StorageUsage): readonly StorageRow[] {
  return [
    { key: "conversations", bytes: usage.conversations },
    { key: "attachments", bytes: usage.attachments },
    { key: "measurements", bytes: usage.measurements },
    { key: "logs", bytes: usage.logs },
    { key: "restorePrevious", bytes: usage.restorePrevious },
  ];
}

/** `db restore`가 만든 복원 전 사본 폴더 이름: UTC 시각 `YYYYMMDDTHHMMSSmmmZ` */
const PREVIOUS_NAME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/;

/**
 * 사본 이름을 UTC 시각으로 읽는다. 꼴이 맞지 않거나 없는 날짜(13월 등)이면 `null`이다.
 * 날짜를 되돌려 맞춰 보므로 `Date.UTC`가 넘긴 값을 조용히 고치는 경우도 거른다.
 */
export function previousTimeOf(name: string): Date | null {
  const match = PREVIOUS_NAME.exec(name);
  if (match === null) return null;
  const part = (index: number): number => Number(match[index]);
  const year = part(1);
  const month = part(2);
  const day = part(3);
  const hour = part(4);
  const minute = part(5);
  const second = part(6);
  const millis = part(7);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  const same =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return same ? date : null;
}

/** 사본 이름을 이 기기의 날짜와 시각으로 적는다. 읽지 못하면 이름 그대로다 */
export function previousLabelOf(name: string, locale: string): string {
  const time = previousTimeOf(name);
  if (time === null) return name;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(time);
}

export interface StorageController {
  readonly getState: () => StorageState;
  readonly subscribe: (listener: () => void) => () => void;
  /** 사용량을 읽는다. 원격 엔진이면 읽지 않고 `remote`가 된다. 다시 읽는 동안에는 이전 값을 그대로 둔다 */
  readonly load: () => Promise<void>;
  /** 지우기 확인 대화 상자를 연다. 사용량을 읽은 뒤 사본 목록에 있는 이름만 연다 */
  readonly ask: (name: string) => void;
  /** 확인 대화 상자를 닫는다. 명령은 부르지 않는다 */
  readonly cancel: () => void;
  /** 확인이다. 대화 상자가 가리키는 이름으로 `removePrevious`를 한 번 부르고, 지웠으면 사용량을 다시 읽는다 */
  readonly confirm: () => Promise<void>;
}

export interface StorageControllerOptions {
  /** 사본을 지웠을 때 한 번 부른다. 화면은 토스트를 여기서 띄운다 */
  readonly removed?: (removed: PreviousRemoved) => void;
}

export function createStorageController(
  port: Pick<StorageCommands, "engineTarget" | "usage" | "removePrevious">,
  options: StorageControllerOptions = {},
): StorageController {
  let state: StorageState = {
    load: { kind: "loading" },
    removing: null,
    removeBusy: false,
    removeFailure: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: StorageState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  // 늦게 도착한 옛 읽기가 새 값을 덮지 않도록 읽기마다 번호를 매긴다
  let readSeq = 0;

  const reload = async (): Promise<void> => {
    readSeq += 1;
    const seq = readSeq;
    if (port.engineTarget()?.kind === "remote") {
      set({ ...state, load: { kind: "remote" } });
      return;
    }
    if (state.load.kind !== "ready") set({ ...state, load: { kind: "loading" } });
    const result = await port.usage();
    if (seq !== readSeq) return;
    set({
      ...state,
      load: result.ok
        ? { kind: "ready", usage: result.value }
        : { kind: "failed", failure: result.error },
    });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: reload,
    ask: (name) => {
      if (state.load.kind !== "ready") return;
      if (!state.load.usage.previous.some((copy) => copy.name === name)) return;
      set({ ...state, removing: name, removeFailure: null });
    },
    cancel: () => {
      set({ ...state, removing: null });
    },
    confirm: async () => {
      const name = state.removing;
      if (name === null) return;
      set({ ...state, removing: null, removeBusy: true, removeFailure: null });
      const result = await port.removePrevious(name);
      if (!result.ok) {
        set({ ...state, removeBusy: false, removeFailure: result.error });
        return;
      }
      set({ ...state, removeBusy: false });
      options.removed?.(result.value);
      await reload();
    },
  };
}

// 컨트롤러는 앱이 사는 동안 하나를 들고 있는다. 설정 화면이 다시 마운트돼도 지우기 결과가 그대로 보이게 한다.
const shared = new WeakMap<object, StorageController>();

/** `port`마다 한 번만 만든 컨트롤러. 화면이 다시 마운트돼도 같은 상태를 돌려준다 */
export function sharedStorageController(
  port: Pick<StorageCommands, "engineTarget" | "usage" | "removePrevious"> & object,
  options: StorageControllerOptions = {},
): StorageController {
  const known = shared.get(port);
  if (known !== undefined) return known;
  const made = createStorageController(port, options);
  shared.set(port, made);
  return made;
}
