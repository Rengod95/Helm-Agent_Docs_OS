import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";
import { eachInOrder } from "../../src/util.ts";

// 시험용 시계와 타이머. `advance`가 시계를 옮기고 만기가 된 타이머를 시각 순서로 부른다.

export interface ManualTime {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** 시계를 `ms`만큼 옮기고 만기가 된 타이머를 부른 뒤 그 타이머가 시작한 비동기 작업이 끝나길 기다린다 */
  advance(ms: number): Promise<void>;
  /** 시계는 그대로 두고 걸려 있는 타이머를 모두 부른다(타이머가 시계보다 일찍 깨는 경우) */
  fireAll(): Promise<void>;
  /** 걸려 있는 타이머 수 */
  timers(): number;
}

interface Timer {
  readonly handle: TimerHandle;
  readonly at: number;
  readonly fn: () => void;
}

/** 이벤트 루프를 몇 바퀴 돌려 detach된 작업이 끝나게 한다 */
function settleWork(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      setTimeout(() => {
        setTimeout(resolve, 0);
      }, 0);
    }, 0);
  });
}

export function manualTime(start: number): ManualTime {
  let now = start;
  let next = 1;
  const pending = new Map<TimerHandle, Timer>();
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const handle = next;
      next += 1;
      pending.set(handle, { handle, at: now + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
  };
  async function runDue(): Promise<void> {
    const due = [...pending.values()].filter((timer) => timer.at <= now);
    due.sort((a, b) => a.at - b.at);
    await eachInOrder(due, async (timer) => {
      if (!pending.delete(timer.handle)) return;
      timer.fn();
      await settleWork();
    });
  }
  return {
    clock: { now: () => now },
    scheduler,
    async advance(ms) {
      now += ms;
      await runDue();
    },
    async fireAll() {
      await eachInOrder([...pending.values()], async (timer) => {
        pending.delete(timer.handle);
        timer.fn();
        await settleWork();
      });
    },
    timers: () => pending.size,
  };
}
