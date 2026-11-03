import { describe, expect, test } from "bun:test";
import type { Scheduler } from "@fresnel/contracts";
import {
  CLIPBOARD_CLEAR_MS,
  createClipboardClear,
  updateLineKey,
  type UpdateCheckLine,
} from "../../src/settings/index.ts";

// 클립보드 지우기 시한과 업데이트 확인 줄. 시간은 가짜 스케줄러가 흘린다. 지우기 호출 횟수와 상태를 값으로 비교한다.

/** 시험이 시간을 직접 흘리는 스케줄러. 건 지연을 기록한다 */
function manualScheduler(): Scheduler & { fire(): void; pending(): number; delays(): number[] } {
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 1;
  return {
    setTimeout(fn, ms) {
      const id = next;
      next += 1;
      timers.set(id, fn);
      delays.push(ms);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    fire() {
      const due = Array.from(timers.values());
      timers.clear();
      for (const fn of due) fn();
    },
    pending: () => timers.size,
    delays: () => delays.slice(),
  };
}

/** 비동기 지우기의 마무리(거부 처리)가 끝나도록 한 바퀴 기다린다 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("createClipboardClear", () => {
  test("arm schedules the clear after 30 seconds, and the timer clears once", async () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const clip = createClipboardClear({
      scheduler,
      clear: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    expect(CLIPBOARD_CLEAR_MS).toBe(30_000);
    clip.arm();
    expect(clip.armed()).toBe(true);
    expect(scheduler.delays()).toEqual([30_000]);
    scheduler.fire();
    await settle();
    expect(calls).toBe(1);
    expect(clip.armed()).toBe(false);
    expect(clip.lastFailed()).toBe(false);
  });

  test("arming again replaces the earlier timer, so only one is pending", () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const clip = createClipboardClear({
      scheduler,
      clear: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    clip.arm();
    clip.arm();
    expect(scheduler.pending()).toBe(1);
    expect(scheduler.delays()).toEqual([30_000, 30_000]);
    scheduler.fire();
    expect(calls).toBe(1);
  });

  test("cancel drops the timer without clearing the clipboard", async () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const clip = createClipboardClear({
      scheduler,
      clear: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    clip.arm();
    clip.cancel();
    expect(clip.armed()).toBe(false);
    expect(scheduler.pending()).toBe(0);
    scheduler.fire();
    await settle();
    expect(calls).toBe(0);
  });

  test("flush clears now when armed, and drops the timer", async () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const clip = createClipboardClear({
      scheduler,
      clear: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    clip.arm();
    await clip.flush();
    expect(calls).toBe(1);
    expect(clip.armed()).toBe(false);
    expect(scheduler.pending()).toBe(0);
    expect(clip.lastFailed()).toBe(false);
  });

  test("flush does nothing when nothing is armed", async () => {
    let calls = 0;
    const clip = createClipboardClear({
      scheduler: manualScheduler(),
      clear: () => {
        calls += 1;
        return Promise.resolve();
      },
    });
    await clip.flush();
    expect(calls).toBe(0);
    expect(clip.lastFailed()).toBe(false);
  });

  test("a rejected clear from the timer does not throw and sets lastFailed", async () => {
    const scheduler = manualScheduler();
    const clip = createClipboardClear({
      scheduler,
      clear: () => Promise.reject(new Error("pasteboard busy")),
    });
    clip.arm();
    scheduler.fire();
    await settle();
    expect(clip.armed()).toBe(false);
    expect(clip.lastFailed()).toBe(true);
  });

  test("a clear that throws synchronously does not escape the timer either", async () => {
    const scheduler = manualScheduler();
    const clip = createClipboardClear({
      scheduler,
      clear: (): Promise<void> => {
        throw new Error("pasteboard gone");
      },
    });
    clip.arm();
    scheduler.fire();
    await settle();
    expect(clip.lastFailed()).toBe(true);
  });

  test("flush resolves after a failed clear, and a later successful clear resets lastFailed", async () => {
    let failing = true;
    const clip = createClipboardClear({
      scheduler: manualScheduler(),
      clear: () => (failing ? Promise.reject(new Error("locked")) : Promise.resolve()),
    });
    clip.arm();
    await clip.flush();
    expect(clip.lastFailed()).toBe(true);
    failing = false;
    clip.arm();
    await clip.flush();
    expect(clip.lastFailed()).toBe(false);
  });
});

describe("updateLineKey", () => {
  test("each update check state maps to its desktop.update key", () => {
    const lines: readonly UpdateCheckLine[] = [
      { state: "unchecked" },
      { state: "checking" },
      { state: "latest", version: "0.9.1" },
      { state: "available", version: "0.9.2", current: "0.9.1" },
      { state: "failed" },
    ];
    expect(lines.map((line) => updateLineKey(line))).toEqual([
      "desktop.update.unchecked",
      "desktop.update.checking",
      "desktop.update.latest",
      "desktop.update.available",
      "desktop.update.failed",
    ]);
  });
});
