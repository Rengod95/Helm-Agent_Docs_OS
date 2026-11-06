// 메인 창의 위치와 크기를 기억한다(Tauri 셸에는 없는 새 기능). 파일은 `<configDir>/window-state-electron.json`이다.
// Tauri 셸의 파일과 이름이 달라 서로 덮어쓰지 않는다. 창을 만들 때 저장된 값을 옵션으로 넘기고, 움직이거나 크기를 바꾸면
// 잠깐 뒤에 저장한다(닫을 때는 바로). 최소화된 창은 저장하지 않는다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { attempt, parseJson } from "@fresnel/contracts";
import type { BrowserWindow } from "electron";
import type { ShellModule } from "./context.ts";
import { appLogOf, type AppLog } from "./lib/applog.ts";
import { errnoCode, isInteger, isRecord } from "./lib/narrow.ts";

export const WINDOW_STATE_FILE_NAME = "window-state-electron.json";
/** 움직이거나 크기를 바꾼 뒤 저장하기까지 기다리는 시간(밀리초). 끄는 동안 값이 계속 바뀌므로 한 번만 쓴다 */
export const WINDOW_SAVE_DELAY_MS = 500;
/** 저장된 값으로 여는 창의 크기 범위(픽셀). 이 밖이면 기본 크기를 쓴다 */
export const WINDOW_SIZE_LIMITS: { readonly min: number; readonly max: number } = {
  min: 200,
  max: 10_000,
};
/** 저장된 위치의 절댓값 상한(픽셀). 연결이 끊긴 모니터 등 엉뚱한 값을 거른다 */
export const WINDOW_OFFSET_LIMIT = 100_000;

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LoadedWindowState {
  /** 쓸 수 있는 값이 있으면 그것, 없으면 null(기본 크기) */
  readonly bounds: WindowBounds | null;
  /** 앱 로그에 남길 한 줄. 없으면 null */
  readonly diagnostic: string | null;
}

/** 창이 제공해야 하는 면. Electron `BrowserWindow`가 이것을 만족하고, 시험은 가짜 창을 넣는다 */
export interface TrackableWindow {
  on(event: "move" | "resize" | "close", listener: () => void): unknown;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  getNormalBounds(): WindowBounds;
}

/** 저장 글을 읽는다. 형식이 틀리거나 값이 범위 밖이면 null이다 */
export function parseWindowState(text: string): WindowBounds | null {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) return null;
  const { x, y, width, height } = parsed.value;
  if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) return null;
  const bounds: WindowBounds = { x, y, width, height };
  return isPlausibleWindowBounds(bounds) ? bounds : null;
}

/** 저장할 값을 글로 옮긴다. 키 순서는 고정이다 */
export function serializeWindowState(bounds: WindowBounds): string {
  return JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
}

/** 크기가 범위 안이고 위치가 상한 안이면 그럴듯하다 */
export function isPlausibleWindowBounds(bounds: WindowBounds): boolean {
  return (
    isSizeInRange(bounds.width) &&
    isSizeInRange(bounds.height) &&
    Math.abs(bounds.x) <= WINDOW_OFFSET_LIMIT &&
    Math.abs(bounds.y) <= WINDOW_OFFSET_LIMIT
  );
}

/** 값을 범위 안으로 맞춘다. 정수로 반올림하고 크기는 최소와 최대 사이, 위치는 상한 안으로 자른다 */
export function clampWindowBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: clamp(Math.round(bounds.x), -WINDOW_OFFSET_LIMIT, WINDOW_OFFSET_LIMIT),
    y: clamp(Math.round(bounds.y), -WINDOW_OFFSET_LIMIT, WINDOW_OFFSET_LIMIT),
    width: clamp(Math.round(bounds.width), WINDOW_SIZE_LIMITS.min, WINDOW_SIZE_LIMITS.max),
    height: clamp(Math.round(bounds.height), WINDOW_SIZE_LIMITS.min, WINDOW_SIZE_LIMITS.max),
  };
}

/** 저장 파일을 읽는다. 파일이 없는 것은 오류가 아니라 기본 크기다 */
export function loadWindowState(file: string): LoadedWindowState {
  const read = attempt(() => readFileSync(file, "utf8"));
  if (!read.ok) {
    if (errnoCode(read.error.cause) === "ENOENT") return { bounds: null, diagnostic: null };
    return {
      bounds: null,
      diagnostic: "window state: the file could not be read; using the default size",
    };
  }
  const bounds = parseWindowState(read.value);
  if (bounds === null) {
    return {
      bounds: null,
      diagnostic: "window state: the saved size is not valid; using the default size",
    };
  }
  return { bounds, diagnostic: null };
}

/** 움직임을 모아 한 번만 실행하는 작업. `flush`는 기다리는 실행을 바로 한다(닫을 때 쓴다) */
export interface DebouncedTask {
  schedule(): void;
  flush(): void;
}

export function debounce(run: () => void, delayMs: number): DebouncedTask {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      run();
    },
  };
}

/** 창의 움직임과 크기 변경을 저장 작업으로 묶는다. 닫히기 직전에는 기다리는 저장을 바로 한다 */
export function trackWindowBounds(
  win: TrackableWindow,
  persist: (bounds: WindowBounds) => void,
  delayMs: number = WINDOW_SAVE_DELAY_MS,
): void {
  const task = debounce(() => {
    if (win.isDestroyed() || win.isMinimized()) return;
    persist(clampWindowBounds(win.getNormalBounds()));
  }, delayMs);
  win.on("move", () => {
    task.schedule();
  });
  win.on("resize", () => {
    task.schedule();
  });
  win.on("close", () => {
    task.flush();
  });
}

/** 저장 파일을 쓴다. 쓰지 못하면 기록만 남기고 창은 그대로 둔다(저장 실패가 앱을 멈추지 않게 한다) */
export function saveWindowState(file: string, bounds: WindowBounds, log: AppLog): void {
  const written = attempt(() => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, serializeWindowState(bounds));
  });
  if (!written.ok) log.line("window state: could not be saved; the size is not remembered");
}

function isSizeInRange(value: number): boolean {
  return value >= WINDOW_SIZE_LIMITS.min && value <= WINDOW_SIZE_LIMITS.max;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export const windowStateModule: ShellModule = {
  name: "window-state",
  register(ctx) {
    const file = path.join(ctx.paths.configDir, WINDOW_STATE_FILE_NAME);
    const log = appLogOf(ctx);
    const loaded = loadWindowState(file);
    if (loaded.diagnostic !== null) log.line(loaded.diagnostic);
    const saved = loaded.bounds;
    if (saved !== null) {
      ctx.windowOptions(() => ({
        x: saved.x,
        y: saved.y,
        width: saved.width,
        height: saved.height,
      }));
    }
    ctx.onWindow((win: BrowserWindow) => {
      trackWindowBounds(win, (bounds) => {
        saveWindowState(file, bounds, log);
      });
    });
  },
};
