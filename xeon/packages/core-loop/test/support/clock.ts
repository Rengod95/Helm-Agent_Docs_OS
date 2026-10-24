import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";
import { fakeTimers, type FakeTimers } from "@xeon/ext-host/testing";

/** 운영 코드가 받는 Clock과 Scheduler를 한 객체로 구현한다(eng.testing.guide TS-03 ManualClock) */
export interface ManualClock extends Clock, Scheduler {
  advance(ms: number): Promise<void>;
  readonly timers: FakeTimers;
}

export function manualClock(start = 1_767_571_200_000): ManualClock {
  const timers = fakeTimers(start);
  const cancels = new Map<TimerHandle, () => void>();
  let counter = 0;
  return {
    timers,
    now: timers.now,
    setTimeout(fn, ms) {
      counter += 1;
      const handle: TimerHandle = counter;
      cancels.set(
        handle,
        timers.setTimer(ms, () => {
          cancels.delete(handle);
          fn();
        }),
      );
      return handle;
    },
    clearTimeout(handle) {
      cancels.get(handle)?.();
      cancels.delete(handle);
    },
    advance: timers.advance,
  };
}
