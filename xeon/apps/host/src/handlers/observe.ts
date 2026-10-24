import type { TimerHandle } from "@xeon/contracts";
import type { ConnectionHub } from "../connection-types.ts";
import type { CommitBatch, Engine } from "../types.ts";

// L4.host-service.spec HS-16. 다른 프로세스가 쓰기 소유자인 thread의 커밋은 이 프로세스의 커밋 알림으로 오지 않는다.
// 그런 thread를 관찰하는 연결이 하나라도 있으면 OBSERVE_POLL_MS 간격으로 head를 읽고, 늘었으면 그 구간을 CommitBatch로 만들어
// 이 프로세스의 커밋과 같은 경로(deliverCommit)로 구독에 전한다. 관찰하는 연결이 없으면 폴링하지 않는다.

/** 관찰 폴링 간격(ms) */
export const OBSERVE_POLL_MS = 250;
/** 한 번의 폴링이 읽는 쪽 수 상한. 넘으면 다음 폴링이 이어서 읽는다 */
const MAX_PAGES_PER_POLL = 20;
const PAGE_EVENTS = 500;
const SCAN_LIMIT = 10_000;

export interface ObservePoller {
  /** 이 프로세스의 커밋이 seq까지 전해졌음을 알린다. 폴링이 같은 구간을 다시 읽지 않게 한다 */
  committed(seq: number): void;
  /** 관찰할 thread가 있고 폴링이 멈춰 있으면 시작한다 */
  refresh(): void;
  dispose(): void;
}

export function createObservePoller(
  engine: Engine,
  hub: ConnectionHub,
  deliver: (batch: CommitBatch) => void,
): ObservePoller {
  const { feed, locks, scheduler, log } = engine.ports;
  const state: {
    timer: TimerHandle | undefined;
    /** 폴링이 켜져 있는 동안 전달을 끝낸 마지막 seq */
    polledTo: number;
    disposed: boolean;
  } = { timer: undefined, polledTo: 0, disposed: false };

  /** 이 프로세스가 쥐지 않은 thread를 관찰하는 연결이 있는가 */
  function hasObserved(): boolean {
    return hub
      .connections()
      .some((conn) => Array.from(conn.observedThreads).some((threadId) => !locks.holds(threadId)));
  }

  function pollOnce(): void {
    const head = feed.headSeq();
    if (!head.ok) {
      log.error("observe.head_failed", { kind: head.error.kind });
      return;
    }
    for (let page = 0; page < MAX_PAGES_PER_POLL && state.polledTo < head.value; page += 1) {
      const after = state.polledTo;
      const read = feed.read(after, head.value, undefined, PAGE_EVENTS, SCAN_LIMIT);
      if (!read.ok) {
        log.error("observe.read_failed", { kind: read.error.kind });
        return;
      }
      const last = read.value.events[read.value.events.length - 1];
      const full = read.value.events.length >= PAGE_EVENTS && last !== undefined;
      let to = full ? last.seq : read.value.scannedTo;
      // 읽기가 앞으로 가지 않는 비정상을 막는다: 진행이 보장되어야 폴링이 끝난다
      if (to <= after || to > head.value) to = head.value;
      state.polledTo = to;
      deliver({
        firstSeq: after + 1,
        lastSeq: to,
        events: read.value.events.filter((event) => event.seq <= to),
      });
    }
  }

  function schedule(): void {
    state.timer = scheduler.setTimeout(() => {
      state.timer = undefined;
      if (state.disposed) return;
      pollOnce();
      if (hasObserved()) schedule();
    }, OBSERVE_POLL_MS);
  }

  return {
    committed(seq) {
      if (state.timer !== undefined) state.polledTo = Math.max(state.polledTo, seq);
    },
    refresh() {
      if (state.disposed || state.timer !== undefined || !hasObserved()) return;
      const head = feed.headSeq();
      if (!head.ok) {
        log.error("observe.head_failed", { kind: head.error.kind });
        return;
      }
      state.polledTo = head.value;
      schedule();
    },
    dispose() {
      state.disposed = true;
      if (state.timer !== undefined) scheduler.clearTimeout(state.timer);
      state.timer = undefined;
    },
  };
}
