import type { ShellBridge } from "./bridge.ts";
import { createElectronBridge, type FresnelShellApi } from "./electron-bridge.ts";
import { createTauriBridge } from "./tauri-bridge.ts";

export type { ShellArgs, ShellBridge, ShellKind } from "./bridge.ts";

/**
 * 실행 중인 셸을 고른다. preload가 `window.fresnelShell`을 내놓으면 Electron, 아니면 Tauri다.
 * 둘 다 없으면(웹 빌드) Tauri 구현이 남고, 명령을 부르는 순간 거부된다. 지금까지의 동작과 같다.
 */
export function selectShellBridge(
  scope: { readonly fresnelShell: FresnelShellApi | undefined } = globalThis,
): ShellBridge {
  const api = scope.fresnelShell;
  return api === undefined ? createTauriBridge() : createElectronBridge(api);
}
