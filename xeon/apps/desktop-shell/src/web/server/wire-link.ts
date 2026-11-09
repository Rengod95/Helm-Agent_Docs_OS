// `/wire` 연결: 서비스 Unix 소켓과 WebSocket 사이에서 바이트를 그대로 중계한다(spec §5.2, §3.2).
// 메시지 경계는 보지 않는다. 클라이언트는 받은 메시지를 이어 붙여 JSON Lines로 읽는다. 텍스트 메시지는 UTF-8 바이트로 보낸다.
// 되돌림: 서비스가 보낸 덩어리는 `ws.send`로 바로 보낸다. `send`가 -1이면 서비스 읽기를 멈추고 `drain`에서 다시 읽는다.
// 0이면 Bun이 프레임을 버린 것이라 스트림이 깨졌으므로 연결을 닫는다. 쌓인 양이 MAX_PENDING_BYTES를 넘어도 닫는다.
import { detach, type Logger } from "@fresnel/contracts";
import { WIRE_LIMITS } from "@fresnel/contracts/wire";
import type { ServiceConnection } from "./ports.ts";
import { MAX_PENDING_BYTES, type SocketData, type SocketLink } from "./link.ts";

/** `/wire` 메시지 하나의 최대 바이트: 프레임 하나(`maxFrameBytes`)와 줄바꿈 하나 */
const MAX_WIRE_MESSAGE_BYTES: number = WIRE_LIMITS.maxFrameBytes + 1;

export interface WireDeps {
  readonly serviceSocketPath: string;
  readonly connectService: (path: string) => ServiceConnection;
  readonly logger: Logger;
}

const encoder = new TextEncoder();

/** 업그레이드된 `/wire` 연결을 서비스 소켓에 잇는다. 서비스 연결은 이 함수에서 처음 만든다(인증 뒤) */
export function openWireLink(ws: Bun.ServerWebSocket<SocketData>, deps: WireDeps): SocketLink {
  const deviceId = ws.data.device.id;
  const service = deps.connectService(deps.serviceSocketPath);
  const state = { closed: false, paused: false, uplinkPending: 0 };

  function fail(code: number, reason: string): void {
    if (state.closed) return;
    state.closed = true;
    service.close();
    ws.close(code, reason);
  }

  /** 클라이언트 바이트 하나를 서비스에 쓰고 쌓인 양을 줄인다. 쓰기가 실패하면 연결을 닫는다 */
  async function settleUplink(bytes: Uint8Array, size: number): Promise<void> {
    const result = await service.write(bytes);
    state.uplinkPending -= size;
    if (!result.ok) fail(1011, "service_write_failed");
  }

  service.onData((bytes) => {
    if (state.closed) return;
    const status = ws.send(bytes);
    if (status === 0) {
      deps.logger.warn("gateway.wire_frame_dropped", { deviceId });
      fail(1013, "backlog");
      return;
    }
    if (status === -1) {
      state.paused = true;
      service.pause();
    }
    if (ws.getBufferedAmount() > MAX_PENDING_BYTES) {
      deps.logger.warn("gateway.wire_backlog_closed", { deviceId });
      fail(1013, "backlog");
    }
  });

  service.onClose((cause) => {
    if (state.closed) return;
    if (cause.kind === "failed") {
      deps.logger.warn("gateway.service_connection_failed", { deviceId, code: cause.code });
      fail(1011, "service_unavailable");
      return;
    }
    fail(1011, "service_closed");
  });

  return {
    onMessage(message) {
      if (state.closed) return;
      // 바이너리 메시지는 복사해서 쓴다: 쓰기가 끝나기 전에 런타임이 버퍼를 재사용하지 않도록
      const bytes = typeof message === "string" ? encoder.encode(message) : new Uint8Array(message);
      const size = bytes.byteLength;
      if (size > MAX_WIRE_MESSAGE_BYTES) {
        fail(1009, "message_too_big");
        return;
      }
      state.uplinkPending += size;
      if (state.uplinkPending > MAX_PENDING_BYTES) {
        fail(1013, "backlog");
        return;
      }
      detach(settleUplink(bytes, size), () => {
        deps.logger.error("gateway.wire_write_crashed", { deviceId });
        fail(1011, "service_write_failed");
      });
    },

    onDrain() {
      if (state.closed || !state.paused) return;
      state.paused = false;
      service.resume();
    },

    onClose() {
      state.closed = true;
      service.close();
    },
  };
}
