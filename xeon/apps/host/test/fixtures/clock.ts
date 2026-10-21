import { flushMicrotasks } from "@xeon/ext-host/testing";

export { flushMicrotasks };

/** 조건이 참이 될 때까지 마이크로태스크를 흘린다. 실제 시간을 기다리지 않는다(eng.testing.guide TS-03) */
export async function settleUntil(done: () => boolean, rounds = 500): Promise<void> {
  if (done() || rounds === 0) return;
  await flushMicrotasks();
  await settleUntil(done, rounds - 1);
}
