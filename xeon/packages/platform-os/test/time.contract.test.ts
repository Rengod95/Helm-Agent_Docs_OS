import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import type { Clock, Scheduler } from "@xeon/contracts";
import { systemClock } from "../src/time/clock.ts";
import { systemScheduler } from "../src/time/scheduler.ts";
import { DEFAULT_START, manualClock } from "./support/clock.ts";

// Clock·Scheduler 계약 묶음 하나를 운영 구현과 manualClock에 돌린다(OS-06, L0.os.spec §9 5번).
// 운영 구현은 bun의 가짜 타이머 위에서 돈다(TS-03: 실제 시간을 기다리지 않는다).

interface Subject {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly advance: (ms: number) => Promise<void>;
}

function runContract(name: string, make: () => Subject): void {
  describe(`Clock·Scheduler 계약: ${name}`, () => {
    test("now()는 epoch ms 정수다", () => {
      const { clock } = make();
      expect(Number.isInteger(clock.now())).toBe(true);
      expect(clock.now()).toBeGreaterThan(1_000_000_000_000);
    });

    test("advance 뒤 now()는 그만큼 이상 앞선다", async () => {
      const subject = make();
      const before = subject.clock.now();
      await subject.advance(50);
      expect(subject.clock.now() - before).toBeGreaterThanOrEqual(50);
    });

    test("만기 순서: 지연이 작은 것이 먼저, 같은 지연이면 등록 순서", async () => {
      const { scheduler, advance } = make();
      const order: string[] = [];
      scheduler.setTimeout(() => order.push("c20"), 20);
      scheduler.setTimeout(() => order.push("a10"), 10);
      scheduler.setTimeout(() => order.push("b10"), 10);
      await advance(25);
      expect(order).toEqual(["a10", "b10", "c20"]);
    });

    test("만기 전에는 실행되지 않는다", async () => {
      const { scheduler, advance } = make();
      let fired = 0;
      scheduler.setTimeout(() => (fired += 1), 100);
      await advance(99);
      expect(fired).toBe(0);
      await advance(1);
      expect(fired).toBe(1);
    });

    test("clearTimeout 뒤에는 실행되지 않는다", async () => {
      const { scheduler, advance } = make();
      let fired = 0;
      const handle = scheduler.setTimeout(() => (fired += 1), 10);
      scheduler.clearTimeout(handle);
      await advance(20);
      expect(fired).toBe(0);
    });

    test("모르는 핸들과 이미 실행된 핸들의 clearTimeout은 아무것도 하지 않는다", async () => {
      const { scheduler, advance } = make();
      let fired = 0;
      const handle = scheduler.setTimeout(() => (fired += 1), 5);
      await advance(5);
      expect(fired).toBe(1);
      expect(() => scheduler.clearTimeout(handle)).not.toThrow();
      expect(() => scheduler.clearTimeout(987_654)).not.toThrow();
    });

    test("핸들은 정수이고 서로 다르다", () => {
      const { scheduler } = make();
      const a = scheduler.setTimeout(() => {}, 1000);
      const b = scheduler.setTimeout(() => {}, 1000);
      expect(Number.isInteger(a)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);
      expect(a).not.toBe(b);
      scheduler.clearTimeout(a);
      scheduler.clearTimeout(b);
    });

    test("음수와 NaN 지연은 0으로 다룬다", async () => {
      const { scheduler, advance } = make();
      const order: string[] = [];
      scheduler.setTimeout(() => order.push("negative"), -5);
      scheduler.setTimeout(() => order.push("nan"), Number.NaN);
      scheduler.setTimeout(() => order.push("later"), 5);
      await advance(0);
      expect(order).toEqual(["negative", "nan"]);
      await advance(5);
      expect(order).toEqual(["negative", "nan", "later"]);
    });
  });
}

runContract("manualClock", () => {
  const clock = manualClock();
  return { clock, scheduler: clock, advance: (ms) => clock.advance(ms) };
});

describe("운영 구현", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime(DEFAULT_START);
  });
  afterEach(() => {
    jest.useRealTimers();
    setSystemTime();
  });
  runContract("systemClock·systemScheduler", () => ({
    clock: systemClock(),
    scheduler: systemScheduler(),
    advance: (ms) => {
      jest.advanceTimersByTime(ms);
      return Promise.resolve();
    },
  }));
});

describe("manualClock 자체", () => {
  test("set은 과거로 갈 수 있고 타이머를 실행하지 않는다", async () => {
    const clock = manualClock();
    let fired = 0;
    clock.setTimeout(() => (fired += 1), 10);
    await clock.set(DEFAULT_START - 1000);
    expect(clock.now()).toBe(DEFAULT_START - 1000);
    expect(fired).toBe(0);
    expect(clock.pendingTimers().length).toBe(1);
  });
});
