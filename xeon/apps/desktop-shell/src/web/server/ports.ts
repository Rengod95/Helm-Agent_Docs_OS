// 서버가 바깥 부품에 의존하는 면. 구현은 각각 `push/`(푸시)와 `shim/`(shim 번들)에 있고 서버 시험은 가짜를 넣는다.
import type { Result } from "@fresnel/contracts";

export type PushSubscribeError =
  | { readonly kind: "invalid_endpoint" }
  | { readonly kind: "invalid_keys" }
  | { readonly kind: "store_failed" };

/** 푸시 구독 등록과 VAPID 공개 키. 발송은 서버 밖(푸시 서비스 구현)이 맡는다 */
export interface PushService {
  /** `applicationServerKey`(비압축 점의 base64url) */
  vapidPublicKey(): string;
  /** 브라우저의 `PushSubscription.toJSON()`을 검증해 기기에 묶어 저장한다 */
  subscribe(deviceId: string, body: unknown): Result<null, PushSubscribeError>;
}

/** 브라우저 shim 번들(`/shell/shim.js`)의 JS 글자를 돌려준다. 시작 때 한 번 만들고 메모리에 둔다 */
export type ShimSource = () => Promise<string>;

/** 서비스 쪽으로 바이트를 쓰지 못한 이유 */
export type ServiceWriteError =
  | { readonly kind: "closed" }
  | { readonly kind: "io"; readonly code: string };

/** 서비스 연결이 끝난 이유. `ended`는 상대가 닫았거나 우리가 닫았다는 뜻이다 */
export type ServiceCloseCause =
  | { readonly kind: "ended" }
  | { readonly kind: "failed"; readonly code: string };

/** 게이트웨이가 서비스 Unix 소켓에 거는 연결 하나(`/wire` 탭 하나). 바이트만 오간다. 기본 구현은 `service-connection.ts`다 */
export interface ServiceConnection {
  /** 바이트를 보낸 순서대로 쓴다. 닫힌 연결에 쓰면 `closed`다 */
  write(bytes: Uint8Array): Promise<Result<null, ServiceWriteError>>;
  /** 서비스가 보낸 덩어리마다 불린다. 등록 전에 온 덩어리는 등록할 때 모두 전달된다 */
  onData(listener: (bytes: Uint8Array) => void): void;
  /** 연결이 끝나면 한 번 불린다. 이미 끝났으면 곧바로 다음 순서에 불린다 */
  onClose(listener: (cause: ServiceCloseCause) => void): void;
  /** 읽기를 멈춘다(브라우저가 밀려 있을 때). 서비스는 소켓 버퍼가 찰 때까지 쓸 수 있다 */
  pause(): void;
  /** 멈춘 읽기를 다시 시작한다 */
  resume(): void;
  /** 우리 쪽에서 닫는다. 여러 번 불러도 된다 */
  close(): void;
}
