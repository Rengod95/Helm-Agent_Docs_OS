import type { Limiter, PoolName, Slot, TaskScope } from "@xeon/contracts/services";

// M1: 동시 상한을 걸지 않는다(L1.tasks.plan §1 "M1에 동시 상한을 넣지 않는 이유"). TaskService.limiter()가
// 인터페이스를 채우도록 슬롯만 세고 기다리지 않는 통과형을 둔다. 상한, FIFO 대기열, 교착 방지 규칙 C1~C4,
// 설정 `l1.tasks.limits.*`는 M2(TK-4)에서 이 파일을 대체한다.

/** 풀 이름과 정착 알림 연결만 받는 통과형 상한기 */
export function createPassThroughLimiter(
  pool: PoolName,
  whenSettled: (owner: TaskScope, listener: () => void) => void,
): Limiter {
  let inUse = 0;

  function take(owner: TaskScope): Slot {
    let held = false;
    const hold = (): void => {
      if (held) return;
      held = true;
      inUse += 1;
    };
    const release = (): void => {
      if (!held) return;
      held = false;
      inUse -= 1;
    };
    hold();
    whenSettled(owner, release);
    return {
      pool,
      owner,
      release,
      async suspendWhile<T>(wait: Promise<T>): Promise<T> {
        release();
        const value = await wait;
        owner.signal.throwIfAborted();
        // 반납했던 슬롯을 같은 풀에서 다시 얻는다. 통과형이라 기다리지 않는다
        if (owner.state !== "settled") hold();
        return value;
      },
    };
  }

  return {
    pool,
    capacity: () => Number.POSITIVE_INFINITY,
    inUse: () => inUse,
    waiting: () => 0,
    acquire(owner) {
      return new Promise((resolve) => {
        // 이미 취소됐으면 signal.reason(AbortReason)으로 거부한다
        owner.signal.throwIfAborted();
        resolve(take(owner));
      });
    },
  };
}
