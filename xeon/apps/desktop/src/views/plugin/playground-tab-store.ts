import { detach, rethrow } from "@fresnel/contracts";
import { useSyncExternalStore } from "react";
import type { Commands } from "../commands.ts";
import { notePluginScreen } from "./plugin-pick.ts";
import { EMPTY_TAB_PREFS, touchedOf, type PlaygroundTabsPrefs } from "./playground-tabs.ts";

// 머리 줄 플레이그라운드 탭의 실행 상태(DP-90). 고정 순서(로컬 설정에서 읽고 쓴다), 지금 탭, 플러그인마다 고른 화면,
// 열어 둔 탭(최근 본 순서, 상한 8). 화면 트리 어디서나 같은 값을 읽도록 모듈 하나에 둔다(`plugin-pick.ts`와 같은 식).

export interface TabRunState {
  /** 로컬 설정을 읽기 전이면 undefined */
  readonly prefs: PlaygroundTabsPrefs | undefined;
  /** 지금(또는 마지막으로) 연 탭의 플러그인 이름 */
  readonly active: string | undefined;
  /** 플러그인 이름 → 고른 화면 키(`<확장>/<화면 id>`) */
  readonly screens: ReadonlyMap<string, string>;
  /** 화면을 내리지 않고 숨겨 두는 탭(최근 본 순서) */
  readonly kept: readonly string[];
}

let state: TabRunState = { prefs: undefined, active: undefined, screens: new Map(), kept: [] };
const listeners = new Set<() => void>();
/** 로컬 설정을 읽은 명령 개체(다시 읽지 않는다) */
let loadedFrom: Commands | undefined;

function set(next: TabRunState): void {
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useTabRunState(): TabRunState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** 처음 한 번 로컬 설정에서 고정 순서를 읽는다. 저장한 적이 없으면 빈 값이다 */
export function ensureTabPrefs(commands: Commands): void {
  if (loadedFrom === commands) return;
  loadedFrom = commands;
  set({ ...state, prefs: commands.playgroundTabs() ?? EMPTY_TAB_PREFS });
}

/** 고정 순서를 바꾸고 저장한다. 같은 값이면 아무것도 하지 않는다 */
export function saveTabPrefs(commands: Commands, prefs: PlaygroundTabsPrefs): void {
  if (prefs === state.prefs) return;
  set({ ...state, prefs });
  detach(
    commands.savePlaygroundTabs(prefs).then(() => undefined),
    rethrow,
  );
}

/** 탭을 연다(화면을 주면 그 화면으로). 열어 둔 탭 목록 맨 앞으로 올린다 */
export function openTab(name: string, screenKey?: string): void {
  const screens =
    screenKey === undefined ? state.screens : new Map([...state.screens, [name, screenKey]]);
  set({ ...state, active: name, screens, kept: touchedOf(state.kept, name) });
  if (screenKey !== undefined) notePluginScreen(screenKey);
}

/** 탭을 닫는다(고정 해제나 플러그인이 사라졌을 때). 열어 둔 화면을 내린다 */
export function dropTab(name: string): void {
  if (!state.kept.includes(name) && state.active !== name) return;
  set({
    ...state,
    active: state.active === name ? undefined : state.active,
    kept: state.kept.filter((item) => item !== name),
  });
}

/** 탭 화면의 셸 화면 id(대화 영역, keepAlive). 등록은 `desktop-registry.tsx`다 */
export const PLAYGROUND_TAB_SCREEN = "playground-tab";
