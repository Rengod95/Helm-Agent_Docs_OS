import type { EventWire } from "@xeon/contracts/wire";

// 시험용 이벤트 수집기: 이벤트가 오면 깨어나는 대기로 기다린다(실제 시간을 폴링하지 않고 상한만 둔다, eng.testing.guide TS-03).

export interface EventLog {
  /** 지금까지 받은 이벤트(받은 순서) */
  readonly events: readonly EventWire[];
  push(event: EventWire): void;
  /** 조건에 맞는 이벤트가 이미 있거나 오면 돌려준다. 한도를 넘으면 `context`를 덧붙여 거부한다 */
  waitFor(
    predicate: (event: EventWire) => boolean,
    what: string,
    context?: () => string,
  ): Promise<EventWire>;
  /** 이미 받은 이벤트 중 조건에 맞는 첫 이벤트. 없으면 던진다(시험이 가정한 이벤트가 없다는 뜻이다) */
  need(predicate: (event: EventWire) => boolean, what: string): EventWire;
  /** 조건에 맞는 이벤트 모두 */
  all(predicate: (event: EventWire) => boolean): readonly EventWire[];
}

export const WAIT_LIMIT_MS: number = 20_000;

export function createEventLog(): EventLog {
  const events: EventWire[] = [];
  const waiters = new Set<{
    predicate: (event: EventWire) => boolean;
    resolve: (event: EventWire) => void;
  }>();
  return {
    events,
    push(event) {
      events.push(event);
      for (const waiter of Array.from(waiters)) {
        if (waiter.predicate(event)) {
          waiters.delete(waiter);
          waiter.resolve(event);
        }
      }
    },
    waitFor(predicate, what, context) {
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
          const seen = events.map((event) => event.kind).join(", ");
          reject(
            new Error(
              `no ${what} within ${WAIT_LIMIT_MS}ms; saw ${seen}${context === undefined ? "" : `; ${context()}`}`,
            ),
          );
        }, WAIT_LIMIT_MS);
        waiters.add(waiter);
      });
    },
    need(predicate, what) {
      const found = events.find(predicate);
      if (found === undefined)
        throw new Error(`no ${what}; saw ${events.map((e) => e.kind).join(", ")}`);
      return found;
    },
    all: (predicate) => events.filter(predicate),
  };
}

export function payloadField(event: EventWire, key: string): unknown {
  const payload: unknown = event.payload;
  return typeof payload === "object" && payload !== null ? Reflect.get(payload, key) : undefined;
}

export function isKind(kind: string): (event: EventWire) => boolean {
  return (event) => event.kind === kind;
}

/** 어느 turn이 끝났다는 이벤트 */
export function turnEnded(turnId: string): (event: EventWire) => boolean {
  return (event) => event.kind === "turn.completed" && event.turnId === turnId;
}

export function stepEvent(
  kind: string,
  turnId: string,
  stepIndex: number,
): (e: EventWire) => boolean {
  return (event) =>
    event.kind === kind &&
    event.turnId === turnId &&
    payloadField(event, "stepIndex") === stepIndex;
}

export function scopeChanged(scopeId: string, status: string): (event: EventWire) => boolean {
  return (event) =>
    event.kind === "scope.changed" &&
    payloadField(event, "scopeId") === scopeId &&
    payloadField(event, "status") === status;
}
