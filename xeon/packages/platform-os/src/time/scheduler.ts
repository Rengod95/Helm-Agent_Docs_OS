import type { Scheduler, TimerHandle } from "@xeon/contracts";

/** 운영 스케줄러. dispose는 서비스 종료 때 남은 타이머를 모두 취소한다(L0.os.spec §4 6번). */
export interface SystemScheduler extends Scheduler {
  /** 아직 만기가 되지 않은 타이머 수 */
  pendingCount(): number;
  /** 남은 타이머를 모두 취소한다 */
  dispose(): void;
}

/** 전역 setTimeout이 받을 수 있는 최대 지연(2^31-1 ms) */
const MAX_DELAY_MS = 2_147_483_647;

/** 음수, NaN은 0으로 다룬다. 상한을 넘으면 상한으로 줄인다. manualClock도 같은 규칙이다 */
function normalizeDelay(ms: number): number {
  if (Number.isNaN(ms) || ms <= 0) return 0;
  return ms > MAX_DELAY_MS ? MAX_DELAY_MS : Math.floor(ms);
}

/**
 * 전역 setTimeout을 감싼다. Bun의 setTimeout은 숫자가 아닌 타이머 객체를 돌려주므로 1부터 증가하는 정수 핸들을
 * 발급하고 표로 대응시킨다. 모르는 핸들의 clearTimeout은 아무것도 하지 않는다. 만기 콜백이 던진 예외는 잡지 않는다.
 * 전역 setTimeout은 호출 때마다 읽는다(테스트의 가짜 타이머가 바꿔 끼울 수 있게).
 */
export function systemScheduler(): SystemScheduler {
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  let nextHandle = 1;
  return {
    setTimeout(fn: () => void, ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      const timer = globalThis.setTimeout(() => {
        timers.delete(handle);
        fn();
      }, normalizeDelay(ms));
      timers.set(handle, timer);
      return handle;
    },
    clearTimeout(handle: TimerHandle): void {
      const timer = timers.get(handle);
      if (timer === undefined) return;
      timers.delete(handle);
      globalThis.clearTimeout(timer);
    },
    pendingCount(): number {
      return timers.size;
    },
    dispose(): void {
      for (const timer of timers.values()) globalThis.clearTimeout(timer);
      timers.clear();
    },
  };
}
