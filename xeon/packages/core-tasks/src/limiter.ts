import { Bug } from "@xeon/contracts";
import type { Limiter, PoolName, Slot, TaskScope } from "@xeon/contracts/services";

// 동시 상한 풀(L1.tasks.spec §3.4, §4.5, L1.tasks.plan TK-4). 풀마다 FIFO 대기열 하나, 상한은 설정 `l1.tasks.limits.*`다.
// - 대기 중 owner.signal이 켜지면 대기열에서 빠지고 signal.reason(AbortReason)으로 거부한다.
// - owner가 정착하면 쥔 슬롯은 자동 반납한다.
// - 같은 노드가 같은 풀의 슬롯을 쥔 채 다시 얻으면 Bug다(규칙 C4: 재진입은 교착의 씨앗이다). 다른 노드를 기다릴 때는 suspendWhile로 먼저 내려놓는다(C2).
// - 상한은 얻을 때마다 읽는다. 값이 줄어도 쥔 슬롯은 그대로 두고 새 획득부터 적용한다. 값이 늘어난 것은 다음 반납이나 획득에서 대기자에게 닿는다.

interface Waiter {
  readonly grant: () => void;
}

/** 슬롯 하나의 상태. suspendWhile이 같은 슬롯 객체로 다시 얻을 수 있게 가변이다 */
interface SlotState {
  held: boolean;
}

export function createLimiter(args: {
  readonly pool: PoolName;
  /** 지금 상한. 호출 때마다 읽는다 */
  readonly capacity: () => number;
  /** 노드가 정착할 때 부를 함수를 등록한다 */
  readonly whenSettled: (owner: TaskScope, listener: () => void) => void;
}): Limiter {
  const { pool, capacity, whenSettled } = args;
  let inUse = 0;
  const waiters: Waiter[] = [];
  const holders = new Set<TaskScope>();

  const pump = (): void => {
    while (waiters.length > 0 && inUse < capacity()) {
      const next = waiters.shift();
      if (next === undefined) return;
      next.grant();
    }
  };

  /** 슬롯을 쥔 것으로 바꾼다. 호출하는 쪽이 inUse를 이미 올렸다 */
  const hold = (owner: TaskScope, state: SlotState): void => {
    state.held = true;
    holders.add(owner);
  };

  const release = (owner: TaskScope, state: SlotState): void => {
    if (!state.held) return;
    state.held = false;
    holders.delete(owner);
    inUse -= 1;
    pump();
  };

  /** 상한이 허용할 때까지 FIFO로 기다려 슬롯을 쥔다 */
  const obtain = async (owner: TaskScope, state: SlotState): Promise<void> => {
    owner.signal.throwIfAborted();
    if (holders.has(owner)) {
      throw new Bug(`tasks.slot_reentry: ${owner.kind} ${owner.id} already holds a ${pool} slot`);
    }
    if (waiters.length === 0 && inUse < capacity()) {
      inUse += 1;
      hold(owner, state);
      return;
    }
    const granted = await new Promise<boolean>((resolve) => {
      const onAbort = (): void => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(false);
      };
      const waiter: Waiter = {
        grant: () => {
          owner.signal.removeEventListener("abort", onAbort);
          inUse += 1;
          hold(owner, state);
          resolve(true);
        },
      };
      owner.signal.addEventListener("abort", onAbort, { once: true });
      waiters.push(waiter);
    });
    if (granted) return;
    // 대기 중 취소: signal.reason(AbortReason)으로 거부한다
    owner.signal.throwIfAborted();
    throw new Bug("tasks.limiter_wait_aborted: waiter removed without an abort signal");
  };

  return {
    pool,
    capacity,
    inUse: () => inUse,
    waiting: () => waiters.length,
    async acquire(owner): Promise<Slot> {
      const state: SlotState = { held: false };
      await obtain(owner, state);
      const slot: Slot = {
        pool,
        owner,
        release: () => {
          release(owner, state);
        },
        async suspendWhile<T>(wait: Promise<T>): Promise<T> {
          release(owner, state);
          const value = await wait;
          owner.signal.throwIfAborted();
          // 반납했던 슬롯을 같은 풀에서 다시 얻는다. 기다리는 동안 노드가 정착했으면 다시 얻지 않는다
          if (owner.state !== "settled") await obtain(owner, state);
          return value;
        },
      };
      whenSettled(owner, () => {
        slot.release();
      });
      return slot;
    },
  };
}
