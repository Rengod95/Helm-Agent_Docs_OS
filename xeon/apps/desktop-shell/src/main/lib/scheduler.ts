// Node 타이머를 F의 `Scheduler` 계약(숫자 핸들)으로 감싼다. Node의 타이머 객체는 이 함수 안에만 있다.
import type { Scheduler, TimerHandle } from "@fresnel/contracts";

export function nodeScheduler(): Scheduler {
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  let last: TimerHandle = 0;
  return {
    setTimeout(fn, ms) {
      last += 1;
      const handle = last;
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
