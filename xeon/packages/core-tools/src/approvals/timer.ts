import type { Scheduler, TimerHandle } from "@xeon/contracts";

// 주입된 `Scheduler`가 없을 때 쓰는 `setTimeout` 기반 대체. 승인 만료 타이머가 없어 무인 turn이 영원히 기다리는 일을 막는다(M3-REQ-72).
// 타이머는 프로세스 종료를 막지 않는다(`unref`).

export function systemScheduler(): Scheduler {
  let next = 1;
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  return {
    setTimeout(fn, ms) {
      const handle = next;
      next += 1;
      const timer = setTimeout(() => {
        timers.delete(handle);
        fn();
      }, ms);
      timer.unref();
      timers.set(handle, timer);
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
