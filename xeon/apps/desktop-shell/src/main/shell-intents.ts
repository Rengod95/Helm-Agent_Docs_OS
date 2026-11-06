// 셸 의도 명령(shell_intent.rs의 명령 부분). 큐 자체는 intents.ts에 있다.
import type { ShellModule } from "./context.ts";
import { sharedIntents } from "./intents.ts";

export function createShellIntentsModule(): ShellModule {
  return {
    name: "shell-intents",
    register(ctx) {
      ctx.handle("shell_take_intents", () => sharedIntents.take(Date.now()));
      // Tauri 셸은 알림 클릭 대상을 이 명령으로 가져갔다. Electron 셸은 클릭을 의도로 바로 큐에 넣고 `shell-intent`를 보내므로 가져갈 대상이 없어 항상 null이다
      ctx.handle("notify_take_target", () => null);
    },
  };
}

export const shellIntentsModule: ShellModule = createShellIntentsModule();
