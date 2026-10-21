/**
 * thread 하나의 turn 시작을 차례로 세우는 상호 배제(L1.loop.spec §2 "thread 구동기", §4.1 끝).
 * 우선순위 0(큐 입력)이 1(drive turn, whenIdle)보다 먼저 들어간다. 같은 우선순위는 도착 순서다.
 */
type GatePriority = 0 | 1;

export interface ThreadGate {
  /** 잠금을 얻어 fn을 실행하고 놓는다. fn이 거부해도 놓는다 */
  run<T>(priority: GatePriority, fn: () => Promise<T>): Promise<T>;
  /** 잠금을 쥐고 있는가 */
  held(): boolean;
  /** 기다리는 작업 수 */
  waiting(): number;
}

interface Waiter {
  readonly priority: GatePriority;
  readonly order: number;
  readonly wake: () => void;
}

export function createThreadGate(): ThreadGate {
  let isHeld = false;
  let counter = 0;
  const waiters: Waiter[] = [];

  function next(): void {
    waiters.sort((a, b) => a.priority - b.priority || a.order - b.order);
    const waiter = waiters.shift();
    if (waiter === undefined) {
      isHeld = false;
      return;
    }
    waiter.wake();
  }

  async function acquire(priority: GatePriority): Promise<void> {
    if (!isHeld) {
      isHeld = true;
      return;
    }
    await new Promise<void>((resolve) => {
      counter += 1;
      waiters.push({ priority, order: counter, wake: resolve });
    });
  }

  return {
    async run(priority, fn) {
      await acquire(priority);
      try {
        return await fn();
      } finally {
        next();
      }
    },
    held: () => isHeld,
    waiting: () => waiters.length,
  };
}
