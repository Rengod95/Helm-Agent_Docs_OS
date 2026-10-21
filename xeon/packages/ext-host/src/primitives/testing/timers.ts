/** 가짜 타이머 한 쌍. ExtHostDeps의 now·setTimer 자리에 그대로 넘긴다(eng.testing.guide TS-03) */
export interface FakeTimers {
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** ms만큼 진행하며 만기 타이머를 만기 시각 순서(같으면 등록 순서)로 실행한다. 각 실행 뒤 마이크로태스크를 비운다 */
  readonly advance: (ms: number) => Promise<void>;
  /** 대기 중인 타이머 수 */
  readonly pendingTimers: () => number;
}

/** 마이크로태스크가 연쇄로 이어지는 약속 체인을 충분히 비운다 */
export async function flushMicrotasks(rounds = 24): Promise<void> {
  if (rounds <= 0) return;
  await Promise.resolve();
  await flushMicrotasks(rounds - 1);
}

export function fakeTimers(start = 1_767_571_200_000): FakeTimers {
  let current = start;
  let sequence = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();

  /** target 이하에서 가장 이른 타이머를 하나 실행하고 반복한다 */
  async function runDue(target: number): Promise<void> {
    let nextId: number | undefined;
    let nextAt = Number.POSITIVE_INFINITY;
    for (const [id, timer] of timers) {
      if (timer.at <= target && timer.at < nextAt) {
        nextAt = timer.at;
        nextId = id;
      }
    }
    if (nextId === undefined) return;
    const timer = timers.get(nextId);
    timers.delete(nextId);
    current = Math.max(current, nextAt);
    timer?.fn();
    await flushMicrotasks();
    await runDue(target);
  }

  return {
    now: () => current,
    setTimer(ms, fn) {
      sequence += 1;
      const id = sequence;
      timers.set(id, { at: current + ms, fn });
      return () => {
        timers.delete(id);
      };
    },
    async advance(ms) {
      const target = current + ms;
      await runDue(target);
      current = target;
      await flushMicrotasks();
    },
    pendingTimers: () => timers.size,
  };
}
