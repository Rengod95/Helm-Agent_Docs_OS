// src/state/shared/frame.ts
import type { Scheduler } from "@xeon/contracts";

/** 다음 화면 프레임에 run을 한 번 부른다. 돌려준 함수는 예약을 취소한다 */
export interface FrameClock {
  request(run: () => void): () => void;
}

type AnimationFrames = {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
};

/** requestAnimationFrame과 타이머 중 먼저 오는 쪽으로 한 번 실행한다. 창이 숨겨져 rAF가 멈춰도 fallbackMs 안에 비운다 */
export function createFrameClock(
  frames: AnimationFrames,
  scheduler: Scheduler,
  fallbackMs: number,
): FrameClock {
  return {
    request(run) {
      let pending = true;
      const cancel = (): void => {
        pending = false;
        frames.cancelAnimationFrame(raf);
        scheduler.clearTimeout(timer);
      };
      const fire = (): void => {
        if (!pending) return;
        cancel();
        run();
      };
      const raf = frames.requestAnimationFrame(fire);
      const timer = scheduler.setTimeout(fire, fallbackMs);
      return cancel;
    },
  };
}

/** 시험용. flush()를 부를 때만 실행한다 */
export function manualFrameClock(): FrameClock & { flush(): void } {
  let queued: (() => void) | undefined;
  return {
    request(run) {
      queued = run;
      return () => {
        queued = undefined;
      };
    },
    flush() {
      const run = queued;
      queued = undefined;
      run?.();
    },
  };
}
