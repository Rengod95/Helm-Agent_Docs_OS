import { expect, test } from "bun:test";
import { systemScheduler } from "../src/time/scheduler.ts";

// 실제 타이머를 쓰는 유일한 테스트(파일당 1초 이하)
test("systemScheduler: 취소와 만료 순서", async () => {
  const scheduler = systemScheduler();
  const order: string[] = [];
  const done = new Promise<void>((resolve) => {
    scheduler.setTimeout(() => {
      order.push("10ms");
      resolve();
    }, 10);
  });
  scheduler.setTimeout(() => order.push("0ms"), 0);
  const cancelled = scheduler.setTimeout(() => order.push("cancelled"), 5);
  scheduler.clearTimeout(cancelled);
  await done;
  expect(order).toEqual(["0ms", "10ms"]);
  expect(scheduler.pendingCount()).toBe(0);
});

test("systemScheduler: dispose는 남은 타이머를 모두 취소한다", async () => {
  const scheduler = systemScheduler();
  let fired = 0;
  scheduler.setTimeout(() => (fired += 1), 5);
  scheduler.setTimeout(() => (fired += 1), 6);
  expect(scheduler.pendingCount()).toBe(2);
  scheduler.dispose();
  expect(scheduler.pendingCount()).toBe(0);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
  expect(fired).toBe(0);
});
