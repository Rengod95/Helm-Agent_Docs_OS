// 감독자의 기다림 도구. Rust의 Notify, watch, timeout 대신 한 가지 방식만 쓴다: 상태를 바꾸는 곳은 `pulse`를 부르고,
// 기다리는 쪽은 깨어날 때마다 조건을 다시 본다. 조건이 참이 되거나 시한(시계 기준)이 지나면 끝난다.
import { detach, repeatAsync, rethrow, type Scheduler, type TimerHandle } from "@fresnel/contracts";

/** 엔진 감독자가 쓰는 시계. 운영은 `Date.now`와 노드 타이머, 시험은 가짜 시계다 */
export interface EngineClock {
  /** 지금 시각(Unix epoch 밀리초) */
  now(): number;
  readonly scheduler: Scheduler;
}

/** 상태 변화 알림. `pulse`는 기다리는 쪽을 모두 깨운다. 깨어난 쪽은 조건을 다시 본다 */
export interface Pulse {
  pulse(): void;
  /** 다음 `pulse`에 불릴 함수를 등록한다. 돌려주는 함수로 뗀다 */
  listen(listener: () => void): () => void;
}

export function createPulse(): Pulse {
  const listeners = new Set<() => void>();
  return {
    pulse() {
      const woken = [...listeners];
      listeners.clear();
      for (const wake of woken) wake();
    },
    listen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `withTimeout`의 결과. 시한 안에 끝났으면 값을, 아니면 `timedOut`이다 */
export type Timed<T> =
  | { readonly timedOut: false; readonly value: T }
  | { readonly timedOut: true };

/**
 * 일이 `ms` 안에 끝나면 값을, 아니면 `timedOut`을 돌려준다. 끝난 뒤 타이머는 지운다.
 * `work`는 거부하지 않는 호출만 넘긴다(Result를 돌려주는 호출). 거부는 `rethrow`로 드러낸다.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  scheduler: Scheduler,
): Promise<Timed<T>> {
  return new Promise<Timed<T>>((resolve) => {
    const timer = scheduler.setTimeout(() => {
      resolve({ timedOut: true });
    }, ms);
    const settle = (outcome: Timed<T>): void => {
      scheduler.clearTimeout(timer);
      resolve(outcome);
    };
    detach(
      work.then((value) => settle({ timedOut: false, value })),
      rethrow,
    );
  });
}

/** 알림이 오거나 `ms`가 지나면 깨운다. `ms`가 null이면 알림만 기다린다. 어느 쪽이든 나머지를 거둔다 */
function wakeOrTimeout(pulse: Pulse, scheduler: Scheduler, ms: number | null): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: TimerHandle | null = null;
    let done = false;
    const unlisteners: (() => void)[] = [];
    const finish = (): void => {
      if (done) return;
      done = true;
      for (const unlisten of unlisteners) unlisten();
      if (timer !== null) scheduler.clearTimeout(timer);
      resolve();
    };
    unlisteners.push(pulse.listen(finish));
    if (ms !== null) timer = scheduler.setTimeout(finish, ms);
  });
}

/**
 * 조건이 참이 될 때까지 기다린다. 알림이 올 때마다 다시 본다. `deadline`(시계 기준 밀리초)이 지나면 거짓이다.
 * `deadline`이 null이면 시한 없이 기다린다. 조건을 바꾸는 쪽은 반드시 `pulse`를 불러야 한다.
 */
export function waitUntil(
  clock: EngineClock,
  pulse: Pulse,
  predicate: () => boolean,
  deadline: number | null,
): Promise<boolean> {
  return repeatAsync<boolean>(async () => {
    if (predicate()) return { value: true };
    const left = deadline === null ? null : deadline - clock.now();
    if (left !== null && left <= 0) return { value: false };
    await wakeOrTimeout(pulse, clock.scheduler, left);
    return undefined;
  });
}
