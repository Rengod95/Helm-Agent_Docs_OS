// `/shell` 연결: 탭 하나의 셸 세션을 연다(spec §5.2, §7). 프레임 해석과 채널은 세션(`session/`)이 맡고, 여기서는 연결과 프레임 길이만 본다.
// 세션이 `send`로 보낸 글은 `ws.send`로 나간다. 세션이 `closeConnection`을 부르면 그 코드로 닫는다.
import { attempt, type Logger } from "@fresnel/contracts";
import type { TabSession, TabSessionFactory } from "../session/ports.ts";
import { MAX_SHELL_MESSAGE_CHARS, type SocketData, type SocketLink } from "./link.ts";

export interface ShellDeps {
  readonly sessions: TabSessionFactory;
  readonly logger: Logger;
}

/** 업그레이드된 `/shell` 연결에 탭 세션을 붙인다. 바이너리 프레임은 받지 않는다(1003) */
export function openShellLink(ws: Bun.ServerWebSocket<SocketData>, deps: ShellDeps): SocketLink {
  const { id: deviceId, name: deviceName } = ws.data.device;
  const state = { ended: false };

  function closeWith(code: number, reason: string): void {
    if (state.ended) return;
    state.ended = true;
    ws.close(code, reason);
  }

  const session: TabSession = deps.sessions.open({
    deviceId,
    deviceName,
    send: (text) => {
      if (state.ended) return;
      // 0은 Bun이 프레임을 버렸다는 뜻이다. 셸 응답을 잃으면 세션이 어긋나므로 닫는다
      if (ws.send(text) === 0) closeWith(1013, "backlog");
    },
    closeConnection: (code, reason) => {
      closeWith(code, reason);
    },
  });

  return {
    onMessage(message) {
      if (state.ended) return;
      if (typeof message !== "string") {
        closeWith(1003, "binary_not_supported");
        return;
      }
      if (message.length > MAX_SHELL_MESSAGE_CHARS) {
        closeWith(1009, "message_too_big");
        return;
      }
      const received = attempt(() => session.receive(message));
      if (!received.ok) {
        deps.logger.error("gateway.shell_receive_failed", { deviceId });
        closeWith(1011, "internal_error");
      }
    },

    onDrain() {},

    onClose() {
      state.ended = true;
      session.close();
    },
  };
}
