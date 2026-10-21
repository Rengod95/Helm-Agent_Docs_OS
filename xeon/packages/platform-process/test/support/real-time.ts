import type { Scheduler, TimerHandle } from "@xeon/contracts";

// 실제 타이머를 쓰는 Scheduler. 자식 프로세스를 띄우는 int 테스트에서만 쓴다(eng.testing.guide TS-03).
export function realScheduler(): Scheduler {
  let next = 1;
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  return {
    setTimeout(fn, ms) {
      const handle = next;
      next += 1;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          fn();
        }, ms),
      );
      return handle;
    },
    clearTimeout(handle) {
      const timer = timers.get(handle);
      if (timer === undefined) return;
      clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

/** 조건이 참이 될 때까지 폴링한다. 상한을 넘으면 거짓 */
export async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  if (condition()) return true;
  if (timeoutMs <= 0) return false;
  const step = Math.min(20, timeoutMs);
  await new Promise<void>((resolve) => setTimeout(resolve, step));
  return waitFor(condition, timeoutMs - step);
}
