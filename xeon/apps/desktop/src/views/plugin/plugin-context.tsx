import { Bug, type Logger, type Result } from "@fresnel/contracts";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { PluginShellPort } from "../../plugin-ui/backend.ts";
import type { PluginUiRuntime, PluginUiState } from "../../plugin-ui/runtime.ts";
import type { ConfirmQueue } from "./confirm-host.tsx";

// 플러그인 화면 실행 맥락과 확인 줄 큐를 화면 트리에 건다. 값(상태)이 아니라 개체만 넣으므로 상태가 바뀌어도 Provider 아래가 다시 그려지지 않는다.

export interface PluginUiContextValue {
  readonly runtime: PluginUiRuntime;
  readonly confirm: ConfirmQueue;
  /** 확인 줄을 거친 `http(s)` 주소를 OS 브라우저로 연다. 운영은 셸 명령 `open_external`이다 */
  readonly openExternal: (href: string) => Promise<void>;
  /** 파일·알림·시크릿 등록 같은 셸 기능. 프레임 대신 앱 본 화면이 부른다. 웹 빌드에는 없다(ADR-0021 §3.4.3) */
  readonly shell?: PluginShellPort | undefined;
  /**
   * 프레임 주소 뿌리를 새로 받는다(웹: 권한 토큰 경로, L4.remote.spec §6.3). 없으면 데스크톱의 `fresnel-view://`를 바로 쓴다.
   * 실패하면 화면은 프레임 대신 막힘 문장을 보인다
   */
  readonly frameRoot?: (() => Promise<Result<string, unknown>>) | undefined;
  /** 진단 로그. 값을 읽지 못해 칸을 감출 때 한 줄을 남긴다. 없으면 남기지 않는다 */
  readonly logger?: Pick<Logger, "warn"> | undefined;
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

/** 맥락이 없으면 null(셸만 따로 그린 시험 등). 있으면 `usePluginUi`와 같다 */
export function useOptionalPluginUi(): PluginUiContextValue | null {
  return useContext(PluginUiContext);
}

export function usePluginUiState(): PluginUiState {
  const { runtime } = usePluginUi();
  return useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
}
