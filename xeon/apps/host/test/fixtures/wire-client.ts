import { attemptAsync, repeatAsync, rethrow } from "@xeon/contracts";
import type { TurnId } from "@xeon/contracts/conversation";
import {
  WIRE_PROTOCOL_VERSION,
  WireError,
  type EventWire,
  type HostConnection,
  type WireParams,
  type WireResult,
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

/**
 * turn.completed 이벤트를 본 직후에는 호스트가 아직 turn을 정리하는 중일 수 있어 다음 turn.start가 turn.busy(재시도 가능)로 올 수 있다.
 * 클라이언트는 retryable 오류를 다시 보낸다. 이 도우미는 turn.busy일 때 이벤트 루프를 한 바퀴 돌려 다시 보낸다
 */
export async function startTurnWhenIdle(
  connection: HostConnection,
  params: WireParams<"turn.start">,
  attempts = 50,
): Promise<{ readonly turnId: TurnId }> {
  const state = { left: attempts };
  return await repeatAsync<{ readonly turnId: TurnId }>(async () => {
    const started = await attemptAsync(() => connection.request("turn.start", params));
    if (started.ok) return { value: started.value };
    const cause = started.error.cause;
    if (cause instanceof WireError && cause.data.kind === "turn.busy" && state.left > 0) {
      state.left -= 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return undefined;
    }
    return rethrow(cause);
  });
}

/** turn.completed 직후의 turn.busy(재시도 가능)를 `startTurnWhenIdle`처럼 기다려 thread.compact를 보낸다 */
export async function compactWhenIdle(
  connection: HostConnection,
  params: WireParams<"thread.compact">,
  attempts = 50,
): Promise<WireResult<"thread.compact">> {
  const state = { left: attempts };
  return await repeatAsync<WireResult<"thread.compact">>(async () => {
    const compacted = await attemptAsync(() => connection.request("thread.compact", params));
    if (compacted.ok) return { value: compacted.value };
    const cause = compacted.error.cause;
    if (cause instanceof WireError && cause.data.kind === "turn.busy" && state.left > 0) {
      state.left -= 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return undefined;
    }
    return rethrow(cause);
  });
}

/** 조건이 참이 될 때까지 폴링한다. 기한을 넘기면 조건의 마지막 값을 돌려준다 */
export async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- 폴링
    await Bun.sleep(10);
  }
  return condition();
}
