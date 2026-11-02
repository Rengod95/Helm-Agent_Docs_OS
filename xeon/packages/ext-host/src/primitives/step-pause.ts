// Test run 단계 경계 멈춤 상태(X-19, X.primitives.spec §4.4.8). host.ts와 dispatch.ts가 쓰고, host.ts 밖으로는 testRunControlOf만 낸다.
// `boundary.step.after` 처리가 끝난 뒤 dispatch.ts가 hold를 부른다. 요청이 없으면 hold는 돌아가고, 있으면 풀릴 때까지 기다린다.
import type { ThreadId } from "@fresnel/contracts/conversation";

const NOOP = (): void => {};

/** 지금 멈춘 경계 하나. 이 경계를 기다리는 hold가 남아 있는 동안 자리를 지킨다 */
interface Held {
  readonly gate: PromiseWithResolvers<void>;
  /** 이 경계를 기다리는 hold 수. 0이 되면 자리를 비운다 */
  waiters: number;
}

/** thread 하나의 멈춤 상태 */
interface PauseState {
  /** 다음 단계 경계에서 멈춘다. pause부터 resume·release까지 참이다 */
  requested: boolean;
  /** 멈추지 않고 지나갈 경계 수. 멈춘 상태가 아닐 때 step이 하나씩 더한다 */
  skip: number;
  /** 지금 멈춘 경계. 멈춘 동안에만 있다 */
  held: Held | null;
}

export interface StepPause {
  /** 다음 단계 경계에서 멈추도록 요청한다. 이미 요청이 있으면 그대로 둔다 */
  pause(threadId: ThreadId): void;
  /** 요청을 거두고 멈춘 경계를 푼다. 요청이 있었으면 참 */
  resume(threadId: ThreadId): boolean;
  /**
   * 경계 하나만 진행한다. 멈춘 중이면 그 경계를 풀고 요청은 남긴다(다음 경계에서 다시 멈춘다).
   * 멈춘 상태가 아니면 다음 경계 하나를 지나가게 표한다. 요청이 있었으면 참
   */
  step(threadId: ThreadId): boolean;
  /** 멈춤 요청이 남아 있는가 */
  requested(threadId: ThreadId): boolean;
  /**
   * `boundary.step.after` 처리가 끝난 뒤 부른다. 요청이 없으면 바로 돌아가고, 지나가게 하는 표가 있으면 그 표를 쓴다.
   * 그 밖에는 resume·step으로 풀리거나 signal이 중단되거나 release될 때까지 기다린다
   */
  hold(threadId: ThreadId, signal?: AbortSignal): Promise<void>;
  /** thread를 닫거나 다시 열 때 요청과 멈춘 경계를 모두 지운다. 멈춘 경계는 풀린다 */
  release(threadId: ThreadId): void;
}

/** gate가 풀리거나 signal이 중단될 때까지 기다린다. 기다린 뒤 signal의 듣기를 떼어 낸다 */
async function untilReleased(gate: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return gate;
  if (signal.aborted) return;
  let onAbort: () => void = NOOP;
  const aborted = new Promise<void>((resolve) => {
    onAbort = () => {
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([gate, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createStepPause(): StepPause {
  const states = new Map<ThreadId, PauseState>();

  /** thread의 상태를 얻는다. 요청을 낼 때만 만든다(hold는 만들지 않는다) */
  function stateFor(threadId: ThreadId): PauseState {
    const found = states.get(threadId);
    if (found !== undefined) return found;
    const created: PauseState = { requested: false, skip: 0, held: null };
    states.set(threadId, created);
    return created;
  }

  /** 멈춘 경계를 풀고 자리를 비운다. 이 경계를 기다리던 hold는 모두 돌아간다 */
  function freeHeld(state: PauseState): void {
    const held = state.held;
    state.held = null;
    held?.gate.resolve();
  }

  return {
    pause(threadId) {
      stateFor(threadId).requested = true;
    },
    resume(threadId) {
      const state = states.get(threadId);
      if (state === undefined || !state.requested) return false;
      states.delete(threadId);
      freeHeld(state);
      return true;
    },
    step(threadId) {
      const state = states.get(threadId);
      if (state === undefined || !state.requested) return false;
      if (state.held !== null) {
        // 멈춘 경계를 지나간다. 요청이 남으므로 바로 다음 경계에서 다시 멈춘다
        freeHeld(state);
      } else {
        // 아직 멈추지 않았다. 다음 경계 하나를 지나가게 하고, 그 뒤 경계부터 멈춘다
        state.skip += 1;
      }
      return true;
    },
    requested(threadId) {
      return states.get(threadId)?.requested === true;
    },
    async hold(threadId, signal) {
      const state = states.get(threadId);
      if (state === undefined || !state.requested) return;
      if (state.skip > 0) {
        state.skip -= 1;
        return;
      }
      // 한 thread에 루프는 하나라서 hold가 겹치지 않지만, 겹치면 같은 자리를 함께 기다린다
      const held = state.held ?? { gate: Promise.withResolvers<void>(), waiters: 0 };
      state.held = held;
      held.waiters += 1;
      try {
        await untilReleased(held.gate.promise, signal);
      } finally {
        held.waiters -= 1;
        // signal 중단으로 빠진 hold가 자리를 비우더라도, 아직 기다리는 hold가 있으면 자리를 남긴다
        if (held.waiters === 0 && state.held === held) state.held = null;
      }
    },
    release(threadId) {
      const state = states.get(threadId);
      if (state === undefined) return;
      states.delete(threadId);
      freeHeld(state);
    },
  };
}
