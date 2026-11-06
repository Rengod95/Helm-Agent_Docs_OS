import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LOG_FILE_NAME, type AppLog } from "../src/main/lib/applog.ts";
import {
  WINDOW_STATE_FILE_NAME,
  clampWindowBounds,
  debounce,
  isPlausibleWindowBounds,
  loadWindowState,
  parseWindowState,
  saveWindowState,
  serializeWindowState,
  trackWindowBounds,
  windowStateModule,
  type TrackableWindow,
  type WindowBounds,
} from "../src/main/window-state.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

const SAVED: WindowBounds = { x: 10, y: 20, width: 1200, height: 800 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 이벤트를 흉내 내는 가짜 창. Electron 창이 쓰는 면만 가진다 */
class FakeWindow implements TrackableWindow {
  readonly listeners = new Map<string, (() => void)[]>();
  bounds: WindowBounds = { x: 0, y: 0, width: 800, height: 600 };
  destroyed = false;
  minimized = false;

  on(event: "move" | "resize" | "close", listener: () => void): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  getNormalBounds(): WindowBounds {
    return this.bounds;
  }
}

function scratchDir(): string {
  return mkdtempSync(path.join(tmpdir(), "window-state-test-"));
}

function logLines(logs: string): string[] {
  return logs
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(line.indexOf(" ") + 1));
}

describe("window state parse and validate", () => {
  test("reads a saved rectangle", () => {
    expect(parseWindowState('{"x":10,"y":20,"width":1200,"height":800}')).toEqual(SAVED);
    expect(parseWindowState('{"x":-300,"y":0,"width":200,"height":10000}')).toEqual({
      x: -300,
      y: 0,
      width: 200,
      height: 10_000,
    });
  });

  test("rejects text that is not a plausible rectangle", () => {
    for (const text of [
      "",
      "not json",
      "[1,2,3,4]",
      '{"x":10,"y":20,"width":1200}',
      '{"x":10.5,"y":20,"width":1200,"height":800}',
      '{"x":"10","y":20,"width":1200,"height":800}',
      '{"x":10,"y":20,"width":0,"height":800}',
      '{"x":10,"y":20,"width":-5,"height":800}',
      '{"x":10,"y":20,"width":199,"height":800}',
      '{"x":10,"y":20,"width":10001,"height":800}',
      '{"x":10,"y":20,"width":1200,"height":199}',
      '{"x":100001,"y":20,"width":1200,"height":800}',
      '{"x":10,"y":-100001,"width":1200,"height":800}',
    ]) {
      expect(parseWindowState(text)).toBeNull();
    }
  });

  test("serializes with the fixed key order and reads back", () => {
    expect(serializeWindowState({ x: 10, y: -20, width: 1200, height: 800 })).toBe(
      '{"x":10,"y":-20,"width":1200,"height":800}',
    );
    expect(parseWindowState(serializeWindowState(SAVED))).toEqual(SAVED);
  });

  test("clamps sizes and offsets into their limits and rounds to whole pixels", () => {
    expect(clampWindowBounds({ x: 100_200.4, y: -200_000, width: 50, height: 20_000 })).toEqual({
      x: 100_000,
      y: -100_000,
      width: 200,
      height: 10_000,
    });
    expect(clampWindowBounds({ x: 10.6, y: 20.4, width: 800.5, height: 600 })).toEqual({
      x: 11,
      y: 20,
      width: 801,
      height: 600,
    });
    expect(
      isPlausibleWindowBounds(clampWindowBounds({ x: 1e9, y: 1e9, width: 1, height: 1 })),
    ).toBe(true);
  });
});

describe("window state load", () => {
  test("a missing file is silent and uses the default size", () => {
    expect(loadWindowState(path.join(scratchDir(), WINDOW_STATE_FILE_NAME))).toEqual({
      bounds: null,
      diagnostic: null,
    });
  });

  test("a saved file gives its rectangle", () => {
    const file = path.join(scratchDir(), WINDOW_STATE_FILE_NAME);
    writeFileSync(file, serializeWindowState(SAVED));
    expect(loadWindowState(file)).toEqual({ bounds: SAVED, diagnostic: null });
  });

  test("a corrupt file gives one diagnostic and the default size", () => {
    const file = path.join(scratchDir(), WINDOW_STATE_FILE_NAME);
    writeFileSync(file, '{"x":"left"}');
    expect(loadWindowState(file)).toEqual({
      bounds: null,
      diagnostic: "window state: the saved size is not valid; using the default size",
    });
  });

  test("a file that cannot be read gives one diagnostic and the default size", () => {
    const dir = scratchDir();
    expect(loadWindowState(dir)).toEqual({
      bounds: null,
      diagnostic: "window state: the file could not be read; using the default size",
    });
  });
});

describe("window state save", () => {
  test("writes the rectangle and creates the config directory", () => {
    const dir = path.join(scratchDir(), "config");
    const file = path.join(dir, WINDOW_STATE_FILE_NAME);
    const lines: string[] = [];
    const log: AppLog = { line: (message) => lines.push(message) };
    saveWindowState(file, SAVED, log);
    expect(readFileSync(file, "utf8")).toBe('{"x":10,"y":20,"width":1200,"height":800}');
    expect(lines).toEqual([]);
  });

  test("a folder that cannot be written logs one line and does not throw", () => {
    const dir = scratchDir();
    const blocker = path.join(dir, "blocker");
    writeFileSync(blocker, "a file, not a folder");
    const lines: string[] = [];
    saveWindowState(path.join(blocker, WINDOW_STATE_FILE_NAME), SAVED, {
      line: (message) => lines.push(message),
    });
    expect(lines).toEqual(["window state: could not be saved; the size is not remembered"]);
  });
});

describe("debounce and window tracking", () => {
  test("schedule runs once after the delay with the last call", async () => {
    let runs = 0;
    const task = debounce(() => {
      runs += 1;
    }, 10);
    task.schedule();
    task.schedule();
    task.schedule();
    expect(runs).toBe(0);
    await sleep(40);
    expect(runs).toBe(1);
    await sleep(20);
    expect(runs).toBe(1);
  });

  test("flush runs a waiting save at once and only once", async () => {
    let runs = 0;
    const task = debounce(() => {
      runs += 1;
    }, 10);
    task.flush();
    expect(runs).toBe(0);
    task.schedule();
    task.flush();
    expect(runs).toBe(1);
    await sleep(30);
    expect(runs).toBe(1);
  });

  test("moves and resizes save the latest clamped bounds after the delay", async () => {
    const win = new FakeWindow();
    const saved: WindowBounds[] = [];
    trackWindowBounds(win, (bounds) => saved.push(bounds), 10);
    win.bounds = { x: 5, y: 6, width: 900, height: 700 };
    win.emit("move");
    win.bounds = { x: 7, y: 8, width: 50, height: 700 };
    win.emit("resize");
    expect(saved).toEqual([]);
    await sleep(40);
    expect(saved).toEqual([{ x: 7, y: 8, width: 200, height: 700 }]);
  });

  test("closing saves a waiting change at once", () => {
    const win = new FakeWindow();
    const saved: WindowBounds[] = [];
    trackWindowBounds(win, (bounds) => saved.push(bounds), 10_000);
    win.bounds = { x: 1, y: 2, width: 1000, height: 900 };
    win.emit("resize");
    expect(saved).toEqual([]);
    win.emit("close");
    expect(saved).toEqual([{ x: 1, y: 2, width: 1000, height: 900 }]);
  });

  test("a minimized or destroyed window is not saved", () => {
    const minimized = new FakeWindow();
    const minimizedSaved: WindowBounds[] = [];
    trackWindowBounds(minimized, (bounds) => minimizedSaved.push(bounds), 10_000);
    minimized.minimized = true;
    minimized.emit("move");
    minimized.emit("close");
    expect(minimizedSaved).toEqual([]);

    const destroyed = new FakeWindow();
    const destroyedSaved: WindowBounds[] = [];
    trackWindowBounds(destroyed, (bounds) => destroyedSaved.push(bounds), 10_000);
    destroyed.destroyed = true;
    destroyed.emit("resize");
    destroyed.emit("close");
    expect(destroyedSaved).toEqual([]);
  });
});

describe("window state module", () => {
  test("a saved rectangle is offered to the next window", () => {
    const fake = fakeCtx();
    mkdirSync(fake.ctx.paths.configDir, { recursive: true });
    writeFileSync(
      path.join(fake.ctx.paths.configDir, WINDOW_STATE_FILE_NAME),
      serializeWindowState(SAVED),
    );
    const offered: unknown[] = [];
    const ctx = {
      ...fake.ctx,
      windowOptions: (provider: () => unknown): void => {
        offered.push(provider());
      },
    };
    windowStateModule.register(ctx);
    expect(offered).toEqual([{ x: 10, y: 20, width: 1200, height: 800 }]);
  });

  test("without a saved file no window options are added", () => {
    const fake = fakeCtx();
    const offered: unknown[] = [];
    const ctx = {
      ...fake.ctx,
      windowOptions: (provider: () => unknown): void => {
        offered.push(provider());
      },
    };
    windowStateModule.register(ctx);
    expect(offered).toEqual([]);
  });

  test("a corrupt saved file is logged at register", () => {
    const fake = fakeCtx();
    mkdirSync(fake.ctx.paths.configDir, { recursive: true });
    writeFileSync(path.join(fake.ctx.paths.configDir, WINDOW_STATE_FILE_NAME), "{");
    windowStateModule.register(fake.ctx);
    expect(logLines(readFileSync(path.join(fake.ctx.paths.logs, LOG_FILE_NAME), "utf8"))).toEqual([
      "window state: the saved size is not valid; using the default size",
    ]);
  });
});
