import type { Scheduler, TimerHandle } from "@xeon/contracts";

// 수동 스케줄러: 시간은 advance가 흘리고, 그때까지 기한이 된 타이머만 등록 순서대로 실행한다. 실제 시간을 기다리지 않는다(eng.testing.guide TS-03).

export interface ManualScheduler extends Scheduler {
  /** 지금 걸려 있는 타이머 수 */
  readonly pending: number;
  /** 시간을 ms만큼 흘리고 기한이 된 타이머를 실행한다. 실행 중에 새로 건 타이머도 기한이 되면 실행한다 */
  advance(ms: number): void;
}

export function createManualScheduler(): ManualScheduler {
  const timers = new Map<TimerHandle, { readonly at: number; readonly fn: () => void }>();
  const state = { now: 0, next: 1 };
  return {
    get pending() {
      return timers.size;
    },
    setTimeout(fn, ms) {
      const handle = state.next;
      state.next += 1;
      timers.set(handle, { at: state.now + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      const until = state.now + ms;
      for (;;) {
        const due = Array.from(timers.entries())
          .filter(([, timer]) => timer.at <= until)
          .toSorted((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        state.now = Math.max(state.now, due[1].at);
        due[1].fn();
      }
      state.now = until;
    },
  };
}
