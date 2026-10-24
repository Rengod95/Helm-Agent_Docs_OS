import { fakeTimers } from "@xeon/ext-host/testing";
import type { Timers } from "../../src/ports/timers.ts";

export interface ManualTimers extends Timers {
  /** ms만큼 시계를 진행하며 만기 타이머를 실행한다 */
  advance(ms: number): Promise<void>;
  pending(): number;
}

/** ext-host 시험 도구의 가짜 타이머를 F `Clock`·`Scheduler` 모양으로 감싼다 */
export function manualTimers(): ManualTimers {
  const base = fakeTimers();
  const cancels = new Map<number, () => void>();
  let next = 0;
  return {
    clock: { now: () => base.now() },
    scheduler: {
      setTimeout: (fn, ms) => {
        next += 1;
        const handle = next;
        const cancel = base.setTimer(ms, () => {
          cancels.delete(handle);
          fn();
        });
        cancels.set(handle, cancel);
        return handle;
      },
      clearTimeout: (handle) => {
        cancels.get(handle)?.();
        cancels.delete(handle);
      },
    },
    advance: (ms) => base.advance(ms),
    pending: () => base.pendingTimers(),
  };
}
