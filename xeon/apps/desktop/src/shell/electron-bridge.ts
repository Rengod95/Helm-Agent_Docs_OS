import type { ShellBridge } from "./bridge.ts";

// preload(apps/desktop-shell/src/preload.ts)가 `window.fresnelShell`로 내놓는 좁은 API. 모양을 여기서 한 번 더 검사한다.
export interface FresnelShellApi {
  invoke(command: string, args?: unknown): Promise<unknown>;
  openChannel(onMessage: (message: unknown) => void): unknown;
  closeChannel(id: number): void;
  listen(event: string, onEvent: () => void): () => void;
}

declare global {
  /** preload가 contextBridge로 내놓는 값. Electron이 아니면 없다 */
  var fresnelShell: FresnelShellApi | undefined;
}

/**
 * Electron 셸. 바이트 명령은 `{ body, headers }`로 보낸다(셸 모듈이 그 모양으로 읽는다).
 * 오류 값은 문자열 코드나 `{kind}`로 거부된다.
 */
export function createElectronBridge(api: FresnelShellApi): ShellBridge {
  return {
    kind: "electron",
    invoke: (command, args) => api.invoke(command, args),
    invokeBytes: (command, body, headers) => api.invoke(command, { body, headers: headers ?? {} }),
    createChannel: (onMessage) => api.openChannel(onMessage),
    listen: (event, onEvent) => Promise.resolve(api.listen(event, onEvent)),
  };
}
