import type { Clock } from "@xeon/contracts";

export interface ManualClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

/** 시험용 수동 시계(eng.testing.guide TS-03). 2026-10-24T00:00:00Z에서 시작한다 */
export function manualClock(start: number = Date.UTC(2026, 9, 24)): ManualClock {
  let current = start;
  return {
    now: () => current,
    set(ms) {
      current = ms;
    },
    advance(ms) {
      current += ms;
    },
  };
}
