import { Bug } from "@fresnel/contracts";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { PluginUiRuntime, PluginUiState } from "../../plugin-ui/runtime.ts";
import type { ConfirmQueue } from "./confirm-host.tsx";

// 플러그인 화면 실행 맥락과 확인 줄 큐를 화면 트리에 건다. 값(상태)이 아니라 개체만 넣으므로 상태가 바뀌어도 Provider 아래가 다시 그려지지 않는다.

export interface PluginUiContextValue {
  readonly runtime: PluginUiRuntime;
  readonly confirm: ConfirmQueue;
  /** 확인 줄을 거친 `http(s)` 주소를 OS 브라우저로 연다. 운영은 Tauri 명령 `open_external`이다 */
  readonly openExternal: (href: string) => Promise<void>;
}

const PluginUiContext = createContext<PluginUiContextValue | null>(null);

export function PluginUiProvider(props: {
  readonly value: PluginUiContextValue;
  readonly children: ReactNode;
}): ReactNode {
  return <PluginUiContext value={props.value}>{props.children}</PluginUiContext>;
}

export function usePluginUi(): PluginUiContextValue {
  const value = useContext(PluginUiContext);
  if (value === null) throw new Bug("PluginUiProvider is missing");
  return value;
}

export function usePluginUiState(): PluginUiState {
  const { runtime } = usePluginUi();
  return useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
}
