import type { Clock, Scheduler } from "@xeon/contracts";
import { systemClock, systemScheduler } from "@xeon/platform-os";

// 서비스 제어(ensure, status, stop)가 쓰는 시계와 타이머. 시험이 수동 시계를 넘긴다.
export function systemTime(): { readonly clock: Clock; readonly scheduler: Scheduler } {
  return { clock: systemClock(), scheduler: systemScheduler() };
}
