import {
  WIRE_PROTOCOL_VERSION,
  type EventWire,
  type HostConnection,
  type WireParams,
} from "@xeon/contracts/wire";

// 시험용 클라이언트 도우미: hello와 이벤트 수집. 이벤트는 알림이 올 때 깨어나는 대기로 기다린다(실제 시간을 폴링하지 않는다).

export const HELLO_PARAMS: WireParams<"host.hello"> = {
  protocolVersion: WIRE_PROTOCOL_VERSION,
  client: { name: "host-test", version: "0.0.0", kind: "other" },
};

export interface EventCollector {
  readonly events: readonly EventWire[];
  /** 조건에 맞는 이벤트가 이미 있거나 오면 돌려준다. 시한을 넘으면 거부한다 */
  waitFor(predicate: (event: EventWire) => boolean, timeoutMs?: number): Promise<EventWire>;
}

export function collectEvents(connection: HostConnection): EventCollector {
  const events: EventWire[] = [];
  const waiters = new Set<{
    predicate: (event: EventWire) => boolean;
    resolve: (e: EventWire) => void;
  }>();
  connection.onNotification("events.batch", (params) => {
    for (const event of params.events) {
      events.push(event);
      for (const waiter of Array.from(waiters)) {
        if (waiter.predicate(event)) {
          waiters.delete(waiter);
          waiter.resolve(event);
        }
      }
    }
  });
  return {
    events,
    waitFor(predicate, timeoutMs = 10_000) {
      const existing = events.find(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise<EventWire>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve(event: EventWire) {
            clearTimeout(timer);
            resolve(event);
          },
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(
            new Error(
              `no matching event within ${timeoutMs}ms; saw ${events.map((e) => e.kind).join(", ")}`,
            ),
          );
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
  };
}
