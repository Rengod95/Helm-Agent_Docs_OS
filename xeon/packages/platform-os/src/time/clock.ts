import type { Clock } from "@xeon/contracts";

/** 운영 시계. epoch ms 정수를 돌려준다. 단조성은 보장하지 않는다(L0.os.spec §3.4). */
export function systemClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },
  };
}
