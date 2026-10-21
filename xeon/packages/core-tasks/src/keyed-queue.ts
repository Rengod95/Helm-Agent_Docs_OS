// 포크 원본: ~/projects/_ref/pi-src/packages/durable/src/tools/file-mutation-queue.ts
//   (pi 커밋 cdaf6c2, 55줄, MIT). 원본은 키별 Promise 꼬리 사슬 하나로 같은 키의 변경을 직렬화한다.
// 바꾼 점(L1.tasks.spec §4.4, L1.tasks.plan §4):
//   1. Chord Context 의존을 지우고 취소를 owner.signal로 받는다.
//   2. 키 산출(mutationKey, canonical)은 L1.tools로 옮겼다. 여기서는 불투명 문자열 키만 받는다.
//   3. 키별 FIFO 대기열과 shared·exclusive 상태를 둔다. 앞에 exclusive가 기다리면 뒤의 shared도 기다린다.
//   4. 여러 키는 사전순으로 차례로 얻는다.
//   5. 대기 중 owner.signal이 켜지면 대기열에서 빠지고 signal.reason으로 거부한다.
// 원본과 같은 한계: 같은 프로세스 안의 직렬화다. bash나 다른 프로세스의 쓰기는 막지 못한다.
import { Bug } from "@xeon/contracts";
import type { KeyedQueue, LockMode, LockRequest, TaskScope } from "@xeon/contracts/services";

interface Waiter {
  readonly mode: LockMode;
  readonly grant: () => void;
}

interface KeyState {
  shared: number;
  exclusive: boolean;
  readonly queue: Waiter[];
}

type Release = () => void;

/** 같은 키가 여럿이면 exclusive가 이긴다. 키는 UTF-16 코드 단위 순으로 정렬한다 */
function normalize(locks: readonly LockRequest[]): readonly LockRequest[] {
  const modes = new Map<string, LockMode>();
  for (const lock of locks) {
    modes.set(
      lock.key,
      lock.mode === "exclusive" || modes.get(lock.key) === "exclusive" ? "exclusive" : "shared",
    );
  }
  return [...modes.keys()].toSorted().map((key) => ({ key, mode: modes.get(key) ?? "exclusive" }));
}

export function createKeyedQueue(): KeyedQueue {
  const states = new Map<string, KeyState>();

  function stateOf(key: string): KeyState {
    const found = states.get(key);
    if (found !== undefined) return found;
    const created: KeyState = { shared: 0, exclusive: false, queue: [] };
    states.set(key, created);
    return created;
  }

  function canEnter(state: KeyState, mode: LockMode): boolean {
    return mode === "exclusive" ? !state.exclusive && state.shared === 0 : !state.exclusive;
  }

  /** 대기열 앞에서부터 들어갈 수 있는 만큼 들인다. 앞이 막히면 뒤도 기다린다(쓰기 굶주림 방지) */
  function pump(key: string, state: KeyState): void {
    for (let head = state.queue[0]; head !== undefined; head = state.queue[0]) {
      if (!canEnter(state, head.mode)) break;
      state.queue.shift();
      if (head.mode === "exclusive") state.exclusive = true;
      else state.shared += 1;
      head.grant();
    }
    if (state.queue.length === 0 && !state.exclusive && state.shared === 0) states.delete(key);
  }

  function releaser(key: string, state: KeyState, mode: LockMode): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (mode === "exclusive") state.exclusive = false;
      else state.shared -= 1;
      pump(key, state);
    };
  }

  async function acquire(key: string, mode: LockMode, signal: AbortSignal): Promise<Release> {
    signal.throwIfAborted();
    const state = stateOf(key);
    if (state.queue.length === 0 && canEnter(state, mode)) {
      if (mode === "exclusive") state.exclusive = true;
      else state.shared += 1;
      return releaser(key, state, mode);
    }
    // null은 대기 중 취소로 대기열에서 빠졌다는 뜻이다
    const granted = await new Promise<Release | null>((resolve) => {
      const onAbort = (): void => {
        const at = state.queue.indexOf(waiter);
        if (at >= 0) state.queue.splice(at, 1);
        // 이 요청이 빠지면 뒤의 shared가 앞으로 당겨질 수 있다
        pump(key, state);
        resolve(null);
      };
      const waiter: Waiter = {
        mode,
        grant: () => {
          signal.removeEventListener("abort", onAbort);
          resolve(releaser(key, state, mode));
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      state.queue.push(waiter);
    });
    if (granted !== null) return granted;
    // signal.reason(AbortReason)으로 거부한다
    signal.throwIfAborted();
    throw new Bug("tasks.lock_wait_aborted: waiter removed without an abort signal");
  }

  async function acquireAll(
    locks: readonly LockRequest[],
    signal: AbortSignal,
    releases: Release[],
  ): Promise<void> {
    const [next, ...rest] = locks;
    if (next === undefined) return;
    releases.push(await acquire(next.key, next.mode, signal));
    await acquireAll(rest, signal, releases);
  }

  return {
    async run<T>(
      locks: readonly LockRequest[],
      owner: TaskScope,
      fn: () => Promise<T>,
    ): Promise<T> {
      const releases: Release[] = [];
      try {
        await acquireAll(normalize(locks), owner.signal, releases);
        // 마지막 키를 얻는 사이 취소됐으면 fn을 시작하지 않는다
        owner.signal.throwIfAborted();
        return await fn();
      } finally {
        for (const release of releases.toReversed()) release();
      }
    },
    pending(key) {
      const state = states.get(key);
      if (state === undefined) return 0;
      return state.shared + (state.exclusive ? 1 : 0) + state.queue.length;
    },
  };
}
