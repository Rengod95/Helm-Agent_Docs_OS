import type { Clock, RandomSource } from "@xeon/contracts";

/** 고정 시작값에서 advance로만 흐르는 시계. 기본 시작값은 2026-01-05T00:00:00Z */
export interface ManualClock extends Clock {
  advance(ms: number): void;
}

export function manualClock(start = 1767571200000): ManualClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

/** 같은 seed는 같은 열을 낸다. [0, 1) 균등(mulberry32) */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
