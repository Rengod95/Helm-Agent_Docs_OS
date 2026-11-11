import { useSyncExternalStore } from "react";
import type { PlacedEntry } from "../../plugin-ui/placements.ts";
import type { PluginUiState } from "../../plugin-ui/runtime.ts";

// 플러그인 화면 목록(옆 "플러그인" 탭이 쓴다)과, 크래프트·머리 줄 탭 메뉴에서 고른 화면이나 플러그인을
// 플레이그라운드 화면(대화 영역 `plugins`)과 옆 탭에 알리는 작은 저장소.

/** Helm 옆 패널의 확장 이름. 이 확장의 `panel` 항목은 Helm 탭이 그린다 */
export const HELM_EXTENSION = "helm";

/** 플러그인 화면 항목: 모든 `page` 항목과 Helm이 아닌 확장의 `panel` 항목 */
export function pluginScreenItemsOf(state: PluginUiState): readonly PlacedEntry[] {
  return [
    ...state.groups.page,
    ...state.groups.panel.filter(({ entry }) => entry.extension !== HELM_EXTENSION),
  ];
}

export interface PluginPickRequest {
  readonly key: string;
  /** 같은 화면을 다시 눌러도 알리려는 번호 */
  readonly seq: number;
}

/** 플레이그라운드 화면에 보낸 요청: 그 화면을 연다(`screen`), 플러그인 하나의 상세를 연다(`plugin`) */
export type AddonRequestTarget =
  | { readonly kind: "screen"; readonly key: string }
  | { readonly kind: "plugin"; readonly name: string };

export interface AddonRequest {
  readonly target: AddonRequestTarget;
  readonly seq: number;
}

let current: AddonRequest | undefined;
/** 마지막으로 고른 화면(옆 탭의 화면 고르기가 따른다). 플러그인 상세 요청은 바꾸지 않는다 */
let lastScreen: PluginPickRequest | undefined;
let seq = 0;
/** 플레이그라운드 화면이 이미 따른 마지막 요청 번호. 화면이 새로 열릴 때 이보다 큰 요청만 따른다 */
let consumed = 0;
const listeners = new Set<() => void>();

function publish(target: AddonRequestTarget): void {
  seq += 1;
  current = { target, seq };
  if (target.kind === "screen") lastScreen = { key: target.key, seq };
  for (const listener of listeners) listener();
}

/** 머리 줄 탭에서 화면 하나를 골랐다고 알린다. 대화 옆 탭의 화면 고르기가 따른다(플레이그라운드 화면 자리는 바꾸지 않는다) */
export function notePluginScreen(key: string): void {
  seq += 1;
  lastScreen = { key, seq };
  for (const listener of listeners) listener();
}

/** 플러그인 하나의 상세를 열라고 알린다(크래프트 확장 상세의 "플레이그라운드에서 보기") */
export function requestAddon(name: string): void {
  publish({ kind: "plugin", name });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 마지막 요청. 플레이그라운드 화면이 읽는다 */
export function useAddonRequest(): AddonRequest | undefined {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** 아직 따르지 않은 요청이면 그 요청, 아니면 undefined. 화면이 새로 열릴 때 처음 자리를 정한다 */
export function pendingAddonRequest(): AddonRequest | undefined {
  return current !== undefined && current.seq > consumed ? current : undefined;
}

/** 요청을 따랐다고 적는다. 같은 요청으로 화면을 다시 열어도 목록부터 보인다 */
export function markAddonRequest(request: AddonRequest): void {
  if (request.seq > consumed) consumed = request.seq;
}

/** 사이드바에서 마지막으로 고른 화면. 옆 "플러그인" 탭이 그 화면을 고른다 */
export function usePluginPickRequest(): PluginPickRequest | undefined {
  return useSyncExternalStore(
    subscribe,
    () => lastScreen,
    () => lastScreen,
  );
}
