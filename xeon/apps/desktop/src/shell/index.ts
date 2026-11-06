import type { ShellBridge } from "./bridge.ts";
import { createElectronBridge, type FresnelShellApi } from "./electron-bridge.ts";

export type { ShellBridge } from "./bridge.ts";

/** 셸이 없을 때(웹 빌드) 명령이 거부되는 코드 */
const SHELL_UNAVAILABLE = "shell-unavailable";

function unavailable(): Promise<never> {
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 셸 명령 오류는 Error가 아니라 문자열 코드로 거부된다 (L4.desktop.design §15.1)
  return Promise.reject(SHELL_UNAVAILABLE);
}

/** 셸이 없는 환경(웹 빌드)의 다리. 명령은 모두 거부되고 이벤트는 오지 않는다 */
function createUnavailableBridge(): ShellBridge {
  return {
    kind: "none",
    invoke: unavailable,
    invokeBytes: unavailable,
    createChannel: () => ({}),
    listen: () => Promise.resolve(() => undefined),
  };
}

/**
 * 실행 중인 셸을 고른다. preload가 `window.fresnelShell`을 내놓으면 Electron 다리이고,
 * 없으면(웹 빌드) 명령을 부르는 순간 거부되는 다리다.
 */
export function selectShellBridge(
  scope: { readonly fresnelShell: FresnelShellApi | undefined } = globalThis,
): ShellBridge {
  const api = scope.fresnelShell;
  return api === undefined ? createUnavailableBridge() : createElectronBridge(api);
}
