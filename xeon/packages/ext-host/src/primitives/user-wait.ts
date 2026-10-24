import type { HandlerGate } from "./dispatch-types.ts";

/**
 * wait 동안 gate를 멈춘다. 핸들러가 사용자 응답(대화상자, 승인)을 기다리는 시간을 시간 예산에서 뺀다
 * (X.operations.spec §4.2.3). 중첩 호출은 gate가 깊이를 센다
 */
export async function awaitUser<T>(gate: HandlerGate, wait: () => Promise<T>): Promise<T> {
  gate.pause();
  try {
    return await wait();
  } finally {
    gate.resume();
  }
}
