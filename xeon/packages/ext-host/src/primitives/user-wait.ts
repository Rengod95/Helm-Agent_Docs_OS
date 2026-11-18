import type { HandlerGate } from "./dispatch-types.ts";

/**
 * 한 핸들러 실행의 사람 대기 계측(읽기 전용). 디스패처가 실행마다 하나 만들어 핸들러의 ambient에 싣고, 실행이 끝난 뒤 읽는다.
 * `now`는 디스패처 시계다. 대기 시간은 예산에서 빼는 것과 같은 구간이다
 */
export interface WaitTally {
  readonly now: () => number;
  /** 사람을 기다린 횟수 */
  count: number;
  /** 기다린 시간 합(ms) */
  ms: number;
}

/** 실행이 끝난 뒤의 대기 합계(읽기 전용) */
export interface WaitTotals {
  readonly count: number;
  readonly ms: number;
}

/**
 * wait 동안 gate를 멈춘다. 핸들러가 사용자 응답(대화상자, 승인)을 기다리는 시간을 시간 예산에서 뺀다
 * (X.operations.spec §4.2.3). 중첩 호출은 gate가 깊이를 센다. `tally`가 있으면 기다린 횟수와 시간을 더한다
 */
export async function awaitUser<T>(
  gate: HandlerGate,
  wait: () => Promise<T>,
  tally?: WaitTally,
): Promise<T> {
  gate.pause();
  const startedAt = tally?.now();
  try {
    return await wait();
  } finally {
    gate.resume();
    if (tally !== undefined && startedAt !== undefined) {
      tally.count += 1;
      tally.ms += Math.max(0, tally.now() - startedAt);
    }
  }
}
