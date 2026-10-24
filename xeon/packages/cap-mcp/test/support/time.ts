import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";

// 고정 시계와 손으로 돌리는 스케줄러(eng.testing.guide TS-05). 실제 시간이 흐르지 않는다.

export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export function fixedClock(start = 1_700_000_000_000): FakeClock {
  let now = start;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

export interface ManualScheduler extends Scheduler {
  /** 시계를 `ms`만큼 돌리며 기한이 된 타이머를 순서대로 실행한다 */
  advance(ms: number): void;
  readonly pending: () => readonly number[];
}

interface Timer {
  readonly id: TimerHandle;
  readonly due: number;
  readonly fn: () => void;
}

export function manualScheduler(clock: FakeClock): ManualScheduler {
  let next = 1;
  let timers: Timer[] = [];
  return {
    setTimeout(fn, ms) {
      const id = next;
      next += 1;
      timers.push({ id, due: clock.now() + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    advance(ms) {
      const target = clock.now() + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.due <= target).toSorted((a, b) => a.due - b.due);
        const first = due[0];
        if (first === undefined) break;
        timers = timers.filter((timer) => timer.id !== first.id);
        clock.advance(Math.max(0, first.due - clock.now()));
        first.fn();
      }
      clock.advance(Math.max(0, target - clock.now()));
    },
    pending: () => timers.map((timer) => timer.due - clock.now()).toSorted((a, b) => a - b),
  };
}
