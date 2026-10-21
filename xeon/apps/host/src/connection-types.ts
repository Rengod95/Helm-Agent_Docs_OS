import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  CloseInfo,
  EventFilter,
  JsonRpcMessage,
  RpcId,
  Transport,
  TransportKind,
  Unsubscribe,
} from "@xeon/contracts/wire";
import type { CommitBatch } from "./types.ts";

// L4.host-service.spec §3.3.3. 연결 허브와 처리기가 함께 쓰는 타입. 값은 connection.ts에 있다.

export interface HostLimits {
  /** l4.host-service.maxReplayEvents. 구독마다 그때 값을 읽는다(live) */
  readonly maxReplayEvents: number;
  /** l4.host-service.maxSubscriptionsPerConnection */
  readonly maxSubscriptionsPerConnection: number;
  /** 상수 500 (F wire §3.4.3) */
  readonly replayBatchMaxEvents: number;
  /** 상수 10,000 */
  readonly scanLimit: number;
  /** 상수 1 MiB */
  readonly sendLowWaterBytes: number;
  /** 송신 큐 상한(바이트). 없으면 SEND_QUEUE_MAX_BYTES. 시험이 작은 값을 넘긴다 [spec에 더한 선택 필드] */
  readonly sendQueueMaxBytes?: number;
}

export interface ServeOptions {
  readonly limits: HostLimits;
  /** 결과 스키마 검사(F wire §4.3 7단계). in-process JSON 왕복은 전송 쪽이 한다 */
  readonly devChecks: boolean;
}

export interface ServedConnection {
  /** WireRequestContext.connectionId */
  readonly id: string;
  readonly transportKind: TransportKind;
  readonly closed: Promise<CloseInfo>;
  close(reason?: string): Promise<void>;
}

export type SendWaitOutcome = "ready" | "aborted" | "closed";

/** 연결 하나의 송신 큐. 응답과 알림은 생성 순서대로 들어간다(HS-05) */
export interface SendQueue {
  push(message: JsonRpcMessage): void;
  /** 아직 전송이 끝나지 않은 바이트 */
  readonly bytes: number;
  /** 큐가 sendLowWaterBytes 아래로 내려갈 때까지 기다린다. signal이 중단되거나 연결이 닫히면 멈춘다 */
  waitBelowLowWater(signal?: AbortSignal): Promise<SendWaitOutcome>;
}

export interface Subscription {
  readonly id: string;
  readonly filter: EventFilter | undefined;
  /** 이 구독이 책임진 마지막 위치(알림의 to) */
  pos: number;
  /** starting: 응답이 아직 나가지 않았다. replaying: 재전송 중. live: 실시간. 앞의 둘은 커밋을 pending에 쌓는다 */
  state: "starting" | "replaying" | "live";
  readonly pending: CommitBatch[];
  /** 위치만 넘기는 빈 알림이 예약되었다(HS-14) */
  emptyTickScheduled: boolean;
  /** 실시간 단계에서 본 마지막 커밋의 끝 seq */
  seenTo: number;
  /** 구독을 지우면 거짓. 진행 중인 재전송은 이를 보고 멈춘다 */
  open: boolean;
}

/** 처리기가 connectionId로 찾는 연결 상태 */
export interface ConnectionState {
  readonly id: string;
  readonly transportKind: TransportKind;
  phase: "awaitingHello" | "ready" | "closed";
  /** host.hello에서 클라이언트가 opt-in한 실험 기능 */
  experimental: readonly string[];
  readonly subs: Map<string, Subscription>;
  /** thread.create·turn.start로 연 thread. stream.chunk를 이 연결에 보낸다(HS-17) */
  readonly openThreads: Set<ThreadId>;
  readonly limits: HostLimits;
  readonly sender: SendQueue;
  /** 응답이 송신 큐에 들어간 직후 실행한다. 처리기가 오류를 던지면 실행하지 않는다 */
  afterResponse(rpcId: RpcId, fn: () => void): void;
  nextSubId(): string;
}

/** 한 호스트 프로세스의 연결 표. 처리기와 수명 관리가 같은 허브를 본다 */
export interface ConnectionHub {
  /** 열린 연결 수(host.status.connections, 유휴 판정) */
  readonly size: number;
  serve(transport: Transport, options: ServeOptions): ServedConnection;
  onSizeChange(listener: (size: number) => void): Unsubscribe;
  closeAll(reason: string): Promise<void>;
  /** connectionId로 연결 상태를 찾는다 [spec에 더한 메서드: 처리기가 구독·열기 기록을 다룬다] */
  state(connectionId: string): ConnectionState | undefined;
  connections(): readonly ConnectionState[];
  /** HS-31 1단계: 이미 받은 요청은 끝까지 처리하고, 새 요청은 5002로 거절한다 */
  beginShutdown(): void;
  /** 커밋 알림 구독을 푼다. 엔진을 닫기 전에 부른다 */
  dispose(): void;
}
