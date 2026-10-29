import { attempt, type Clock, type Result } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { ScopeHandlerFailedPayload, VolatileEventEnvelope } from "@xeon/contracts/records";
import { messageOf } from "../util.ts";

// M3-REQ-35, X.operations.spec §4.3.4, L4.host-service.spec HS-80. 확장 핸들러 실패(`ScopeHandlerFailedPayload`)를
// 휘발 이벤트 `scope.handler_failed`로 보낸다. 페이로드에는 thread가 없으므로 지금 어떤 연결이든 연 thread마다 한 번씩 보낸다.
// 발신(`session.emitVolatile`)은 `cap-dialog`의 `sessionStatusPublisher`와 같은 모양으로 채운다.

/** 발신이 쓰는 좁은 포트. 세션과 연결 허브는 엔진을 만든 뒤에 생기므로 조립 루트가 늦게 잇는다 */
export interface HandlerFailedPorts {
  /** `xeon.session`의 휘발 발신. 저장하지 않는다 */
  readonly emitVolatile: (event: VolatileEventEnvelope) => void;
  /** 발신 시점의 내구 head. 이 값이 `afterSeq`가 된다. 읽지 못하면 이 실패는 보내지 않는다 */
  readonly headSeq: () => Result<number, { readonly kind: string }>;
  /** 지금 어떤 연결이든 연 thread. 같은 thread가 여러 연결에 있어도 한 번만 쓴다 */
  readonly openThreads: () => Iterable<ThreadId>;
  readonly ids: IdFactory;
  readonly clock: Clock;
  /** 운영 로그 한 줄 */
  readonly log: (line: string) => void;
}

/**
 * 확장 핸들러 실패 하나를 열린 thread마다 `scope.handler_failed` 휘발 이벤트로 보낸다. `createVolatileNotifier`의 `emit`이다.
 * 열린 thread가 없으면 보내지 않고 운영 로그만 남긴다. thread 하나의 발신이 던져도 다른 thread의 발신은 계속하고,
 * 던진 원인은 운영 로그에 남긴다(호출자에게 던지지 않는다).
 */
export function createHandlerFailedEmitter(
  ports: HandlerFailedPorts,
): (payload: ScopeHandlerFailedPayload) => void {
  // n은 (threadId, turnId)마다 0부터 1씩 세므로 thread마다 따로 센다(F.records.spec §4.3)
  const counters = new Map<ThreadId, number>();
  return (payload) => {
    const threads = [...new Set(ports.openThreads())];
    if (threads.length === 0) {
      ports.log(
        `scope.handler_failed not emitted: no open thread (${payload.owner} ${payload.point})`,
      );
      return;
    }
    const head = ports.headSeq();
    if (!head.ok) {
      ports.log(`scope.handler_failed not emitted: head read failed (${head.error.kind})`);
      return;
    }
    for (const threadId of threads) {
      const n = counters.get(threadId) ?? 0;
      counters.set(threadId, n + 1);
      const envelope: VolatileEventEnvelope = {
        id: ports.ids.next("evt"),
        kind: "scope.handler_failed",
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        recordedAt: ports.clock.now(),
        causationId: null,
        correlationId: null,
        payload,
        durable: false,
        n,
        afterSeq: head.value,
      };
      const sent = attempt(() => {
        ports.emitVolatile(envelope);
      });
      if (!sent.ok) {
        ports.log(
          `scope.handler_failed not emitted: thread ${threadId} (${messageOf(sent.error.cause)})`,
        );
      }
    }
  };
}
