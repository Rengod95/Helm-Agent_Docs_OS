import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";

// eng.testing.guide TS-03. 런타임 중립 수동 시계. 기본 시작값은 2026-01-05T00:00:00Z.

export interface ManualClock extends Clock, Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** ms만큼 진행하며 그 사이 만기 타이머를 만기 시각 순서로 실행한다. 같은 시각이면 등록 순서 */
  advance(ms: number): Promise<void>;
  pendingTimers(): readonly { readonly at: number }[];
}

interface Timer {
  readonly handle: TimerHandle;
  readonly at: number;
  readonly fn: () => void;
}

/** 대기 중인 Promise 연쇄가 정착하도록 마이크로태스크를 충분히 비운다 */
export async function flushMicrotasks(): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 0; i < 50; i += 1) chain = chain.then(() => undefined);
  await chain;
}

export function manualClock(start: number = 1_767_571_200_000): ManualClock {
  let current = start;
  let nextHandle = 1;
  let timers: Timer[] = [];

  function nextDue(limit: number): Timer | undefined {
    let best: Timer | undefined;
    for (const timer of timers) {
      if (timer.at > limit) continue;
      if (best === undefined || timer.at < best.at) best = timer;
    }
    return best;
  }

  /** 만기 타이머를 하나씩 실행한다. 타이머가 던지면 거부된다 */
  async function runDue(target: number): Promise<void> {
    const due = nextDue(target);
    if (due === undefined) return;
    timers = timers.filter((timer) => timer.handle !== due.handle);
    current = Math.max(current, due.at);
    due.fn();
    await flushMicrotasks();
    await runDue(target);
  }

  return {
    now: () => current,
    setTimeout(fn, ms) {
      const handle = nextHandle;
      nextHandle += 1;
      timers.push({ handle, at: current + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      timers = timers.filter((timer) => timer.handle !== handle);
    },
    async advance(ms) {
      const target = current + ms;
      await flushMicrotasks();
      await runDue(target);
      current = target;
      await flushMicrotasks();
    },
    pendingTimers: () => timers.map((timer) => ({ at: timer.at })),
  };
}
