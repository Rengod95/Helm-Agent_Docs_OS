import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";

// L0.process.spec §3.2 service/idle.ts, §4.4.4. 유휴 종료 판정기. 상태 없이 입력 표본만 받고, 입력이 바뀔 때마다 부른다.
// 조건: 연결 0 + live task 0(승인 대기 세션 포함) + 대기 예약 0이 idleGraceMs 동안 이어질 때만 종료한다.
// 시작 직후 startupGraceMs 동안은 판정하지 않는다(그 시각 전에는 타이머가 만기여도 울리지 않고 그 시각까지 미룬다).

export interface IdleInputs {
  readonly connections: number;
  /** 진행 중 turn과 승인 대기 세션의 합(호출자가 센다) */
  readonly liveTasks: number;
  /** L2 schedule의 대기 예약 수. 스케줄 트랙이 오기 전에는 호출자가 0을 넘긴다 */
  readonly pendingSchedules: number;
}

export interface IdleMonitor extends Disposable {
  /** 입력이 바뀔 때마다 부른다. 한가해지면 타이머를 걸고, 하나라도 깨지면 취소한다 */
  update(inputs: IdleInputs): void;
  /** 유휴 종료 예정 시각(epoch ms). 타이머가 없으면 null. host.status의 idleShutdownAt */
  readonly idleShutdownAt: number | null;
  /** 유휴 유예가 끝났을 때 한 번 부른다. 구독 해제 함수를 돌려준다 */
  onIdle(handler: () => void): () => void;
}

export interface IdleMonitorOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly startupGraceMs: number;
  readonly idleGraceMs: number;
}

/** 입력이 모두 0이면 한가하다 */
export function isIdle(inputs: IdleInputs): boolean {
  return inputs.connections === 0 && inputs.liveTasks === 0 && inputs.pendingSchedules === 0;
}

export function createIdleMonitor(options: IdleMonitorOptions): IdleMonitor {
  const { clock, scheduler } = options;
  const startedAt = clock.now();
  const handlers = new Set<() => void>();
  const state: { timer: TimerHandle | undefined; at: number | null; fired: boolean } = {
    timer: undefined,
    at: null,
    fired: false,
  };

  function cancel(): void {
    if (state.timer !== undefined) scheduler.clearTimeout(state.timer);
    state.timer = undefined;
    state.at = null;
  }

  function arm(): void {
    const now = clock.now();
    // 시작 유예 안에서 한가해졌다면 유예가 끝난 시각부터 idleGraceMs를 센다
    const at = Math.max(now, startedAt + options.startupGraceMs) + options.idleGraceMs;
    state.at = at;
    state.timer = scheduler.setTimeout(() => {
      state.timer = undefined;
      state.fired = true;
      for (const handler of Array.from(handlers)) handler();
    }, at - now);
  }

  return {
    update(inputs) {
      if (state.fired) return;
      if (!isIdle(inputs)) {
        cancel();
        return;
      }
      // 이미 걸린 타이머는 그대로 둔다: 같은 한가함이 이어지는 동안 시작 시각이 밀리지 않는다
      if (state.timer === undefined) arm();
    },
    get idleShutdownAt() {
      return state.at;
    },
    onIdle(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    [Symbol.dispose]() {
      cancel();
      handlers.clear();
    },
  };
}
