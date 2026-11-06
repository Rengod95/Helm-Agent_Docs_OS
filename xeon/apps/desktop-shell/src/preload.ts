// preload(격리 세계). renderer에 내놓는 API는 `window.fresnelShell` 하나이고 ipcRenderer를 그대로 내놓지 않는다.
// API를 더하는 법: 명령은 main 쪽 모듈이 `ctx.handle("이름", ...)`으로 등록하면 `invoke`로 닿는다(preload 수정 없음).
// 이벤트는 모듈이 `ctx.emit("이름")`을 부르고 UI가 `listen("이름", ...)`으로 듣는다. 새 종류의 통로가 필요할 때만 이 파일을 고친다.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL_KEY, SHELL_CHANNELS } from "./shared/channels.ts";

const channels = new Map<number, (message: unknown) => void>();
const listeners = new Map<string, Set<() => void>>();
let nextChannel = 1;

ipcRenderer.on(SHELL_CHANNELS.channel, (_event, id: unknown, message: unknown) => {
  if (typeof id === "number") channels.get(id)?.(message);
});
ipcRenderer.on(SHELL_CHANNELS.event, (_event, name: unknown) => {
  if (typeof name !== "string") return;
  for (const listener of listeners.get(name) ?? []) listener();
});

const EVENT_NAME = /^[a-z][a-z0-9-]{0,63}$/;

contextBridge.exposeInMainWorld("fresnelShell", {
  invoke: async (command: string, args?: unknown): Promise<unknown> => {
    const reply: unknown = await ipcRenderer.invoke(SHELL_CHANNELS.invoke, command, args);
    if (typeof reply === "object" && reply !== null && "ok" in reply) {
      if (reply.ok === true && "value" in reply) return reply.value;
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 셸 명령은 Err 값(문자열 코드나 {kind})을 그대로 거절 값으로 준다. UI 어댑터가 그 모양을 읽는다 (L4.desktop.design)
      if (reply.ok === false && "error" in reply) return Promise.reject(reply.error);
    }
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 위와 같은 문자열 코드 (L4.desktop.design)
    return Promise.reject("invalid-reply");
  },
  /** 메시지를 받을 채널을 열고 `{ $channel: id }` 값을 돌려준다. args에 그대로 실어 보낸다 */
  openChannel: (onMessage: (message: unknown) => void): Record<string, number> => {
    const id = nextChannel;
    nextChannel += 1;
    channels.set(id, onMessage);
    return { [CHANNEL_KEY]: id };
  },
  closeChannel: (id: number): void => {
    channels.delete(id);
  },
  /** 이름 붙은 이벤트를 듣는다. 돌려주는 함수가 듣기를 끝낸다 */
  listen: (name: string, onEvent: () => void): (() => void) => {
    if (!EVENT_NAME.test(name)) return () => undefined;
    const set = listeners.get(name) ?? new Set<() => void>();
    set.add(onEvent);
    listeners.set(name, set);
    return () => {
      set.delete(onEvent);
    };
  },
});
