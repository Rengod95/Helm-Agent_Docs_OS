import type { Clock } from "@xeon/contracts";

/** 시험이 시각을 직접 옮기는 시계(eng.testing.guide TS-03) */
export interface ManualClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function manualClock(start = 1_700_000_000_000): ManualClock {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
    set(ms) {
      current = ms;
    },
  };
}
