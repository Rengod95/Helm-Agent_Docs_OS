import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";

// eng.testing.guide TS-03. 시계 대역은 F가 아니라 쓰는 패키지의 test/ 안에 둔다(review.decisions-2 U-03).

export interface ManualClock extends Clock, Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** ms만큼 진행하며 그 사이 만기 타이머를 만기 순서로 실행한다 */
  advance(ms: number): void;
}

/** 기본 시작값 2026-01-05T00:00:00Z */
const CLOCK_START = 1767571200000;

export function manualClock(start: number = CLOCK_START): ManualClock {
  let current = start;
  let nextHandle = 1;
  let seq = 0;
  const timers = new Map<TimerHandle, { at: number; seq: number; fn: () => void }>();
  return {
    now: () => current,
    setTimeout(fn, ms) {
      const handle = nextHandle;
      nextHandle += 1;
      seq += 1;
      timers.set(handle, { at: current + ms, seq, fn });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .toSorted((a, b) => a[1].at - b[1].at || a[1].seq - b[1].seq)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        current = Math.max(current, due[1].at);
        due[1].fn();
      }
      current = target;
    },
  };
}
