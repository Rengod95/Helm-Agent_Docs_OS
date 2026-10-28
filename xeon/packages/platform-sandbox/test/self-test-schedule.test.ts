import { describe, expect, test } from "bun:test";
import { repeatAsync, type Clock, type Scheduler, type TimerHandle } from "@xeon/contracts";
import type { SelfTestItemId } from "@xeon/contracts/services";
import { createSandboxService, type SandboxServiceHandle } from "../src/service.ts";
import type { SandboxSettings } from "../src/settings.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  selfTestShell,
  settingsOf,
  type FakeOs,
} from "./support/fakes.ts";

// L0.sandbox.spec §4.7: 시작 때 한 번, 그 뒤 selfTestIntervalMin분마다 자가 시험을 돈다. 호출은 조립 루트가 startSelfTests로 건다.

interface Timer {
  readonly handle: TimerHandle;
  readonly ms: number;
  readonly fn: () => void;
}

/** 만기를 시험이 직접 일으키는 Scheduler. 걸린 타이머와 취소한 핸들을 기록한다 */
function manualScheduler(): Scheduler & {
  readonly pending: () => readonly Timer[];
  readonly cleared: readonly TimerHandle[];
  fireNext(): void;
} {
  const timers = new Map<TimerHandle, Timer>();
  const cleared: TimerHandle[] = [];
  let next = 1;
  return {
    setTimeout(fn, ms) {
      const handle = next;
      next += 1;
      timers.set(handle, { handle, ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      cleared.push(handle);
      timers.delete(handle);
    },
    pending: () => [...timers.values()],
    cleared,
    fireNext() {
      const first = timers.values().next();
      if (first.done === true) throw new Error("no pending timer");
      timers.delete(first.value.handle);
      first.value.fn();
    },
  };
}

async function setup(initial: SandboxSettings = settingsOf()) {
  const dirs = makeTestDirs();
  const scheduler = manualScheduler();
  const base = fakeOs(dirs);
  const state = { settings: initial, clockFails: false };
  const clock: Clock = {
    now: () => {
      if (state.clockFails) throw new Error("clock exploded");
      return base.time.clock.now();
    },
  };
  const os: FakeOs = { ...base, time: { ...base.time, clock, scheduler } };
  const service: SandboxServiceHandle = await createSandboxService(
    {
      os,
      settings: () => state.settings,
      srt: fakeSrt({ passthrough: true }),
      platform: linuxPlatform(),
    },
    new AbortController().signal,
  );
  return { service, scheduler, state, os };
}

/** 조건이 참이 될 때까지 5ms 간격으로 최대 3초 폴링한다(자가 시험은 실제 임시 파일을 만든다) */
async function settle(done: () => boolean): Promise<void> {
  let tries = 0;
  await repeatAsync<void>(async () => {
    tries += 1;
    if (done() || tries > 600) return { value: undefined };
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    return undefined;
  });
}

describe("startSelfTests", () => {
  test("runs once right away, records it in the status, and schedules the next run by the interval", async () => {
    const { service, scheduler } = await setup(settingsOf({ selfTestIntervalMin: 60 }));
    const shell = selfTestShell();
    const schedule = service.startSelfTests(shell);
    const first = await schedule.first;
    expect(first.ok && first.value.passed).toBe(true);
    expect(shell.calls.length).toBeGreaterThan(0);
    expect(service.status().lastSelfTest?.passed).toBe(true);
    expect(scheduler.pending().map((timer) => timer.ms)).toEqual([60 * 60_000]);
    schedule.stop();
  });

  test("a due timer runs the self test again and re-reads the interval each cycle", async () => {
    const { service, scheduler, state } = await setup(settingsOf({ selfTestIntervalMin: 60 }));
    const shell = selfTestShell();
    const schedule = service.startSelfTests(shell);
    await schedule.first;
    const afterFirst = shell.calls.length;
    state.settings = settingsOf({ selfTestIntervalMin: 5 });
    scheduler.fireNext();
    await settle(() => scheduler.pending().length === 1);
    expect(shell.calls.length).toBe(afterFirst * 2);
    expect(scheduler.pending().map((timer) => timer.ms)).toEqual([5 * 60_000]);
    // 0이면 그 실행을 마지막으로 더 걸지 않는다
    state.settings = settingsOf({ selfTestIntervalMin: 0 });
    scheduler.fireNext();
    await settle(() => shell.calls.length === afterFirst * 3);
    expect(shell.calls.length).toBe(afterFirst * 3);
    expect(scheduler.pending()).toEqual([]);
    schedule.stop();
  });

  test("interval 0 runs only at start", async () => {
    const { service, scheduler } = await setup(settingsOf({ selfTestIntervalMin: 0 }));
    const schedule = service.startSelfTests(selfTestShell());
    await schedule.first;
    expect(scheduler.pending()).toEqual([]);
  });

  test("a failing item is a report value, shows in the status, and the schedule continues", async () => {
    const { service, scheduler } = await setup();
    const failing = new Set<SelfTestItemId>(["network_denied"]);
    const schedule = service.startSelfTests(selfTestShell(failing));
    const first = await schedule.first;
    expect(first.ok && first.value.passed).toBe(false);
    expect(first.ok && first.value.items.filter((item) => !item.passed).map((i) => i.id)).toEqual([
      "network_denied",
    ]);
    expect(service.status().lastSelfTest?.failed).toEqual(["network_denied"]);
    expect(service.status().available).toBe(false);
    expect(scheduler.pending()).toHaveLength(1);
    schedule.stop();
  });

  test("a self test that throws is reported as crashed, logged, and the schedule continues", async () => {
    const { service, scheduler, os, state } = await setup();
    // 항목 실패는 보고서 값이다. 시험 자체가 던지는 경우는 여기서 시계 오류로 만든다
    state.clockFails = true;
    const schedule = service.startSelfTests(selfTestShell());
    expect(await schedule.first).toEqual({ ok: false, error: { kind: "crashed" } });
    expect(
      os.log.entries.filter((entry) => entry.event === "sandbox.self_test_crashed"),
    ).toHaveLength(1);
    expect(scheduler.pending()).toHaveLength(1);
    schedule.stop();
  });

  test("stop cancels the pending timer, and dispose stops every schedule", async () => {
    const { service, scheduler } = await setup();
    const one = service.startSelfTests(selfTestShell());
    await one.first;
    const two = service.startSelfTests(selfTestShell());
    await two.first;
    expect(scheduler.pending()).toHaveLength(2);
    one.stop();
    one.stop();
    expect(scheduler.pending()).toHaveLength(1);
    await service.dispose();
    expect(scheduler.pending()).toEqual([]);
    expect(scheduler.cleared).toHaveLength(2);
  });

  test("stop while the first run is in flight leaves no timer behind", async () => {
    const { service, scheduler } = await setup();
    const schedule = service.startSelfTests(selfTestShell());
    schedule.stop();
    await schedule.first;
    expect(scheduler.pending()).toEqual([]);
  });
});
