import { useSyncExternalStore } from "react";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import type { PlacedEntry } from "../../plugin-ui/placements.ts";
import { appsAllowed } from "../../plugin-ui/policy-context.ts";
import type { PluginUiState } from "../../plugin-ui/runtime.ts";

// 플러그인 화면 목록(대화 영역 `plugins` 화면과 사이드바 "플러그인 UI" 구역이 같이 쓴다)과, 사이드바에서 고른 화면을 그 화면에 알리는 작은 저장소.

/** Helm 옆 패널의 확장 이름. 이 확장의 `panel` 항목은 Helm 탭이 그린다 */
export const HELM_EXTENSION = "helm";

/** 플러그인 화면 항목: 모든 `page` 항목과 Helm이 아닌 확장의 `panel` 항목 */
export function pluginScreenItemsOf(state: PluginUiState): readonly PlacedEntry[] {
  return [
    ...state.groups.page,
    ...state.groups.panel.filter(({ entry }) => entry.extension !== HELM_EXTENSION),
  ];
}

export interface PluginUiRow {
  /** `<확장>/<화면 id>` */
  readonly key: string;
  readonly entry: ExtUiEntry;
  /** 확장이 꺼졌거나 안전 모드이거나 화면이 꺼진 항목. 연하게 그리고 누르면 꺼짐 안내를 본다 */
  readonly off: boolean;
}

/**
 * 사이드바 "플러그인 UI" 구역의 행. 앱 정책 `x.ui.apps`가 꺼져 있으면 구역 자체를 숨긴다(빈 목록).
 * 앱이 아닌 선언형 항목은 정책과 무관하게 그리지만 구역은 앱 정책을 따른다(시안: 구역은 설치된 플러그인 앱의 입구)
 */
export function pluginUiRowsOf(state: PluginUiState): readonly PluginUiRow[] {
  if (!appsAllowed("user", state.settings)) return [];
  return pluginScreenItemsOf(state).map(({ entry }) => ({
    key: `${entry.extension}/${entry.id}`,
    entry,
    off: entry.state === "disabled" || state.inactive.has(entry.extension),
  }));
}

export interface PluginPickRequest {
  readonly key: string;
  /** 같은 화면을 다시 눌러도 알리려는 번호 */
  readonly seq: number;
}

let current: PluginPickRequest | undefined;
let seq = 0;
const listeners = new Set<() => void>();

/** 사이드바에서 화면 하나를 골랐다고 알린다 */
export function requestPluginScreen(key: string): void {
  seq += 1;
  current = { key, seq };
  for (const listener of listeners) listener();
}

export function usePluginPickRequest(): PluginPickRequest | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => current,
  );
}
