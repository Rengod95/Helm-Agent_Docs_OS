import { expect, test } from "bun:test";
import type { Scheduler, TimerHandle } from "@fresnel/contracts";
import { createUiChangeCoalescer, UI_CHANGE_WINDOW_MS } from "../../src/handlers/ui-changes.ts";

// 가짜 시간. 예약된 일은 시각 순서대로 `advance`가 돌린다. 실제 타이머는 쓰지 않는다.
function fakeTime() {
  let now = 0;
  let next = 1;
  const timers = new Map<TimerHandle, { readonly at: number; readonly run: () => void }>();
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const handle = next;
      next += 1;
      timers.set(handle, { at: now + ms, run: fn });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };
  return {
    scheduler,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .toSorted((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
    },
  };
}

function coalescerOf() {
  const time = fakeTime();
  const emitted: string[] = [];
  const coalescer = createUiChangeCoalescer({
    windowMs: UI_CHANGE_WINDOW_MS,
    scheduler: time.scheduler,
    emit: (extension) => {
      emitted.push(extension);
    },
  });
  return { time, emitted, coalescer };
}

test("the window is 100 ms", () => {
  expect(UI_CHANGE_WINDOW_MS).toBe(100);
});

test("three signals of one extension inside the window emit once, when the window closes", () => {
  const { time, emitted, coalescer } = coalescerOf();
  coalescer.signal("helm");
  time.advance(30);
  coalescer.signal("helm");
  time.advance(30);
  coalescer.signal("helm");
  expect(emitted).toEqual([]);
  time.advance(39);
  expect(emitted).toEqual([]);
  time.advance(1);
  expect(emitted).toEqual(["helm"]);
});

test("another extension keeps its own window", () => {
  const { time, emitted, coalescer } = coalescerOf();
  coalescer.signal("helm");
  coalescer.signal("kanban");
  coalescer.signal("helm");
  time.advance(UI_CHANGE_WINDOW_MS);
  expect(emitted).toEqual(["helm", "kanban"]);
});

test("a signal after the window closed opens a new window", () => {
  const { time, emitted, coalescer } = coalescerOf();
  coalescer.signal("helm");
  time.advance(UI_CHANGE_WINDOW_MS);
  expect(emitted).toEqual(["helm"]);
  time.advance(50);
  coalescer.signal("helm");
  time.advance(UI_CHANGE_WINDOW_MS - 1);
  expect(emitted).toEqual(["helm"]);
  time.advance(1);
  expect(emitted).toEqual(["helm", "helm"]);
});

test("dispose cancels the open windows without emitting", () => {
  const { time, emitted, coalescer } = coalescerOf();
  coalescer.signal("helm");
  coalescer.dispose();
  time.advance(UI_CHANGE_WINDOW_MS * 3);
  expect(emitted).toEqual([]);
});
