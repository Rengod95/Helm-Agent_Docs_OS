import { Bug } from "@xeon/contracts";

// 소유 트리 루트 하나의 동시 자식 수 상한(`l1.agents.maxConcurrent`, L1.agents.spec §4.4, AG-11).
// 전체 풀(`limiter("subagents")`)과 별개의 두 번째 상한이다. FIFO이고 대기 중 취소하면 대기열에서 빠진다.

export interface ConcurrencyGate {
  /** 슬롯을 얻는다. 꽉 차면 FIFO로 기다린다. 기다리는 동안 signal이 켜지면 signal.reason으로 거부한다 */
  acquire(signal: AbortSignal): Promise<() => void>;
  inUse(): number;
  waiting(): number;
}

interface Waiter {
  readonly grant: (release: () => void) => void;
  readonly cleanup: () => void;
}

/** capacity는 얻을 때마다 읽는다: 값이 줄어도 이미 쥔 슬롯은 그대로 두고 새 획득부터 적용한다 */
export function createConcurrencyGate(capacity: () => number): ConcurrencyGate {
  let held = 0;
  const queue: Waiter[] = [];

  const releaseOnce = (): (() => void) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      held -= 1;
      pump();
    };
  };

  const pump = (): void => {
    while (queue.length > 0 && held < capacity()) {
      const next = queue.shift();
      if (next === undefined) return;
      next.cleanup();
      held += 1;
      next.grant(releaseOnce());
    }
  };

  return {
    inUse: () => held,
    waiting: () => queue.length,
    async acquire(signal): Promise<() => void> {
      signal.throwIfAborted();
      if (queue.length === 0 && held < capacity()) {
        held += 1;
        return releaseOnce();
      }
      const granted = await new Promise<(() => void) | null>((resolve) => {
        const onAbort = (): void => {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          resolve(null);
        };
        const waiter: Waiter = {
          grant: resolve,
          cleanup: () => {
            signal.removeEventListener("abort", onAbort);
          },
        };
        signal.addEventListener("abort", onAbort, { once: true });
        queue.push(waiter);
      });
      if (granted !== null) return granted;
      // 기다리는 동안 취소됐다: signal.reason으로 거부한다
      signal.throwIfAborted();
      throw new Bug("agents.gate_wait_aborted: waiter removed without an abort signal");
    },
  };
}
