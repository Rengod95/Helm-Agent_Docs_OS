import { createSettingsController } from "@fresnel/client/settings";
import type { Session } from "./session.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { SettingsCommands } from "../views/commands.ts";

// 설정 화면(P-09)의 컨트롤러 발급. 컨트롤러는 연결 하나에 묶인다(`HostConnection`을 포트에 고정한다).
// 그래서 화면은 연결이 살아날 때마다 `open()`을 다시 부르고, 옛 컨트롤러는 `dispose()`로 알림 구독을 끊는다.
// 현재 대화는 열린 대화 상태에서 매번 읽는다(`settings.invalidated` 판정과 `launch` 범위 쓰기에 쓴다).

export interface SettingsDeps {
  readonly session: Pick<Session, "connection" | "restartEngine" | "reconnect">;
  readonly ui: Pick<UiStore, "read">;
}

export function createSettingsCommands(deps: SettingsDeps): SettingsCommands {
  return {
    open() {
      const connection = deps.session.connection();
      if (connection === null) return null;
      return createSettingsController({
        connection,
        currentThreadId: () => deps.ui.read.getState().selectedThreadId,
        // 재시작이 거절되면 연결을 다시 잇는다. 새 연결의 화면이 대기 표시를 다시 읽는다(L4.settings-ui §4.4.5)
        requestHostRestart: async () => {
          const restarted = await deps.session.restartEngine();
          if (!restarted) deps.session.reconnect();
        },
      });
    },
  };
}
