import type { Unsubscribe } from "../../records/index.ts";
import type { JsonRpcMessage, RpcId } from "./jsonrpc.ts";
import type {
  ClientNotificationName,
  ClientNotificationParams,
  ServerNotificationName,
  ServerNotificationParams,
  TransportKind,
  WireMethodName,
  WireParams,
  WireResult,
} from "./methods.ts";

// F.wire-settings.spec §3.1. 전송 구현(프레이밍, 소켓 서버)은 L4다. `meta`(WireMeta) 필드는 M2다(plan W17).

export type { TransportKind } from "./methods.ts";
export type { Unsubscribe };

export interface CloseInfo {
  readonly reason: "local" | "remote" | "error" | "eof";
  readonly message?: string;
}

/** 메시지 하나를 통째로 옮긴다. 프레이밍과 한도 검사는 구현이 하고, envelope 검사는 HostConnection이 한다 */
export interface Transport {
  readonly kind: TransportKind;
  send(message: JsonRpcMessage): Promise<void>;
  /** 검증 전 값. envelope 검사는 위층이 한다 */
  onMessage(handler: (message: unknown) => void): Unsubscribe;
  onClose(handler: (info: CloseInfo) => void): Unsubscribe;
  close(reason?: string): Promise<void>;
}

/** in-process: 같은 프로세스 안의 쌍. client.send는 server.onMessage로, 그 반대도 같다 */
export type InProcessTransportFactory = () => {
  readonly client: Transport;
  readonly server: Transport;
};

export interface StdioTransportOptions {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  /** 기본 WIRE_LIMITS.maxFrameBytes */
  readonly maxFrameBytes?: number;
}
export type StdioTransportFactory = (options: StdioTransportOptions) => Transport;

/** M2. 인증 필드는 F.wire-settings.spec §10 미결 4가 풀린 뒤 더한다 */
export interface SocketTransportOptions {
  /** Unix 소켓 경로. 위치는 L0.os가 정한다 */
  readonly path: string;
  readonly maxFrameBytes?: number;
}
export type SocketTransportFactory = (options: SocketTransportOptions) => Promise<Transport>;

export interface WireRequestOptions {
  /** 중단하면 $/cancelRequest를 보낸다 */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** 클라이언트가 쓰는 쪽. 전송 종류에 의존하지 않는다. 요청 id는 연결마다 r1, r2, …로 발급한다 */
export interface HostConnection {
  request<M extends WireMethodName>(
    method: M,
    params: WireParams<M>,
    options?: WireRequestOptions,
  ): Promise<WireResult<M>>;
  onNotification<N extends ServerNotificationName>(
    name: N,
    handler: (params: ServerNotificationParams<N>) => void,
  ): Unsubscribe;
  /**
   * 클라이언트 알림을 보낸다(`$/cancelRequest`, `$/connectionReset`). 응답은 없다.
   * `request`의 `signal`이 `$/cancelRequest`를 대신 보내므로 보통은 `$/connectionReset`에 쓴다. 연결이 닫혔으면 거부한다
   */
  notify<N extends ClientNotificationName>(
    name: N,
    params: ClientNotificationParams<N>,
  ): Promise<void>;
  close(): Promise<void>;
  readonly closed: Promise<CloseInfo>;
}

/** 서버 쪽 요청 문맥 */
export interface WireRequestContext {
  readonly connectionId: string;
  readonly rpcId: RpcId;
  /** $/cancelRequest 또는 연결 종료 때 중단된다 */
  readonly signal: AbortSignal;
  notify<N extends ServerNotificationName>(name: N, params: ServerNotificationParams<N>): void;
}

export type WireHandler<M extends WireMethodName> = (
  params: WireParams<M>,
  context: WireRequestContext,
) => Promise<WireResult<M>>;

/** 서버 쪽. 처리기 표는 L4 host가 채운다 */
export type WireHandlers = { readonly [M in WireMethodName]: WireHandler<M> };
