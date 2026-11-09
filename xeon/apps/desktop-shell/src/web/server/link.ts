// WebSocket 연결 하나의 데이터와 연결 로직의 면. `wire-link.ts`와 `shell-link.ts`가 구현하고 `gateway.ts`가 Bun에 잇는다.
// 순환 import를 피하려고 여기에 둔다(gateway → wire-link, shell-link → link).
import type { DeviceInfo } from "../auth/devices.ts";

/** 업그레이드 때 Bun이 `ws.data`로 들고 다니는 값. `link`는 `open`에서 채운다 */
export interface SocketData {
  readonly kind: "wire" | "shell";
  readonly device: DeviceInfo;
  link: SocketLink | null;
}

/** 열린 연결 하나의 동작. Bun 이벤트를 받아 서비스나 셸 세션으로 나른다 */
export interface SocketLink {
  onMessage(message: string | Uint8Array): void;
  onDrain(): void;
  onClose(): void;
}

/** 브라우저 쪽으로 밀린 바이트(또는 서비스로 아직 못 쓴 바이트)가 이만큼을 넘으면 1013으로 닫는다 */
export const MAX_PENDING_BYTES: number = 8 * 1024 * 1024;

/** Bun 송신 버퍼가 이만큼 차면 `send`가 -1을 주고, 서비스 읽기를 멈춘 뒤 `drain`에서 다시 읽는다 */
export const BACKPRESSURE_BYTES: number = 1024 * 1024;

/** `/shell` 텍스트 프레임 하나의 최대 글자 수. `session/protocol.ts`의 `MAX_SHELL_FRAME_CHARS`와 같은 값이다(값 import를 피하려고 옮겨 적는다) */
export const MAX_SHELL_MESSAGE_CHARS: number = 8 * 1024 * 1024;

/** 기기 폐기처럼 게이트웨이가 연결을 닫는 이유 */
export type CloseReason = "revoked";
