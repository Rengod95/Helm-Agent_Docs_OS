// 명령 등록부. ipcMain 없이 시험할 수 있도록 순수 코드로 둔다.
import type { CommandHandler, IpcCaller } from "./context.ts";

/** 핸들러가 거절할 때 던진다. `payload`가 그대로 renderer의 거절 값이 된다(Tauri 명령의 `Err(String)`, `Err({kind})`와 같은 자리) */
export class ShellError extends Error {
  readonly payload: unknown;
  constructor(payload: unknown) {
    super(typeof payload === "string" ? payload : "shell-error");
    this.name = "ShellError";
    this.payload = payload;
  }
}

/** main → renderer 응답. preload가 `ok: false`를 거절로 바꾼다 */
export type ShellReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

export interface CommandRegistry {
  handle(command: string, handler: CommandHandler): void;
  /** 등록되지 않은 명령은 `unknown-command`로 거부한다. ShellError가 아닌 오류는 `internal`로 바꿔 내용을 밖으로 내지 않는다 */
  dispatch(caller: IpcCaller, command: unknown, args: unknown): Promise<ShellReply>;
}

export function createCommandRegistry(): CommandRegistry {
  const handlers = new Map<string, CommandHandler>();
  return {
    handle(command, handler) {
      if (handlers.has(command)) throw new Error(`command registered twice: ${command}`);
      handlers.set(command, handler);
    },
    async dispatch(caller, command, args) {
      const handler = typeof command === "string" ? handlers.get(command) : undefined;
      if (handler === undefined) return { ok: false, error: "unknown-command" };
      try {
        return { ok: true, value: await handler(caller, args) };
      } catch (cause) {
        return { ok: false, error: cause instanceof ShellError ? cause.payload : "internal" };
      }
    },
  };
}
