import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ShellBridge } from "./bridge.ts";

// @tauri-apps/*를 import하는 파일은 이 파일과 `transport/ipc.ts`뿐이다(L4.desktop.spec 3.3).

/** `@tauri-apps/api`의 invoke, Channel, listen을 그대로 감싼다 */
export function createTauriBridge(): ShellBridge {
  return {
    kind: "tauri",
    invoke: (command, args) => invoke<unknown>(command, args),
    invokeBytes: (command, body, headers) =>
      invoke<unknown>(command, body, headers === undefined ? undefined : { headers }),
    createChannel: (onMessage) => {
      const channel = new Channel();
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Tauri Channel은 EventTarget이 아니라 onmessage 대입이 유일한 수신 방법이다 (@tauri-apps/api core.d.ts)
      channel.onmessage = onMessage;
      return channel;
    },
    listen: (event, onEvent) =>
      listen(event, () => {
        onEvent();
      }),
  };
}
