import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindowConstructorOptions, TitleBarOverlayOptions } from "electron";
import type { IpcCaller, ShellContext } from "../src/main/context.ts";
import {
  CHROME_COLORS,
  HEADER_HEIGHT,
  WINDOW_CHROME_EVENT,
  chromeKindOf,
  chromeOptionsOf,
  chromeStateFor,
  createWindowChromeModule,
  overlayOf,
  readSavedTheme,
  recolor,
  themeSourceOf,
  trafficLightInsetOf,
  trafficLightMetricsOf,
  trafficLightPositionOf,
  type ChromeWindow,
  type NativeThemePort,
  type ThemeSource,
  type WindowChromeState,
} from "../src/main/window-chrome.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

class FakeChromeWindow implements ChromeWindow {
  readonly webContents: object;
  readonly listeners = new Map<string, (() => void)[]>();
  readonly backgrounds: string[] = [];
  readonly overlays: TitleBarOverlayOptions[] = [];
  fullscreen = false;
  destroyed = false;

  constructor(webContents: object = {}) {
    this.webContents = webContents;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
  isFullScreen(): boolean {
    return this.fullscreen;
  }
  setBackgroundColor(color: string): void {
    this.backgrounds.push(color);
  }
  setTitleBarOverlay(options: TitleBarOverlayOptions): void {
    this.overlays.push(options);
  }
  on(event: "enter-full-screen" | "leave-full-screen", listener: () => void): unknown {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
}

class FakeTheme implements NativeThemePort {
  readonly sources: ThemeSource[] = [];
  readonly listeners: (() => void)[] = [];
  osDark = false;
  setSource(source: ThemeSource): void {
    this.sources.push(source);
  }
  prefersDark(): boolean {
    const source = this.sources.at(-1) ?? "system";
    return source === "system" ? this.osDark : source === "dark";
  }
  onUpdated(listener: () => void): void {
    this.listeners.push(listener);
  }
}

function writeSettings(configDir: string, content: string): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "desktop-settings.json"), content);
}

describe("window chrome values", () => {
  test("platform maps to a chrome kind", () => {
    expect(chromeKindOf("darwin")).toBe("mac");
    expect(chromeKindOf("win32")).toBe("overlay");
    expect(chromeKindOf("linux")).toBe("overlay");
    expect(chromeKindOf("freebsd")).toBe("none");
  });

  test("traffic lights sit vertically centered in the 44px header body", () => {
    expect(HEADER_HEIGHT).toBe(45);
    const tahoe = trafficLightMetricsOf("25.5.0");
    const older = trafficLightMetricsOf("24.6.0");
    expect(tahoe).toEqual({ size: 14, pitch: 23 });
    expect(older).toEqual({ size: 12, pitch: 20 });
    expect(trafficLightMetricsOf("")).toEqual(older);
    expect(trafficLightPositionOf(tahoe)).toEqual({ x: 16, y: 15 });
    expect(trafficLightPositionOf(older)).toEqual({ x: 16, y: 16 });
    // 16 + 23·2 + 14 + 16, 16 + 20·2 + 12 + 16
    expect(trafficLightInsetOf(tahoe)).toBe(92);
    expect(trafficLightInsetOf(older)).toBe(84);
  });

  test("theme source falls back to system", () => {
    expect(themeSourceOf("dark")).toBe("dark");
    expect(themeSourceOf("light")).toBe("light");
    expect(themeSourceOf("sepia")).toBe("system");
    expect(themeSourceOf(undefined)).toBe("system");
  });

  test("the overlay paints the header surface (side panel color), the window the app background (DP-137)", () => {
    expect(CHROME_COLORS).toEqual({
      light: { background: "#f7f7f7", header: "#fdfdfd", symbol: "#3d3d3d" },
      dark: { background: "#080808", header: "#121212", symbol: "#d6d6d6" },
    });
    expect(overlayOf(true).color).toBe("#121212");
    expect(overlayOf(false).color).toBe("#fdfdfd");
  });

  test("options per kind hide the title bar and paint the theme background", () => {
    const lights = trafficLightMetricsOf("25.0.0");
    expect(chromeOptionsOf("mac", true, lights)).toEqual({
      backgroundColor: CHROME_COLORS.dark.background,
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 16, y: 15 },
    });
    expect(chromeOptionsOf("overlay", false, lights)).toEqual({
      backgroundColor: CHROME_COLORS.light.background,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: CHROME_COLORS.light.header,
        symbolColor: CHROME_COLORS.light.symbol,
        height: 44,
      },
    });
    expect(chromeOptionsOf("none", false, lights)).toEqual({
      backgroundColor: CHROME_COLORS.light.background,
    });
  });
});

describe("saved theme", () => {
  test("reads the appearance key, defaults to system", () => {
    const { dir } = fakeCtx();
    const configDir = path.join(dir, "config");
    expect(readSavedTheme(configDir)).toBe("system");
    writeSettings(configDir, JSON.stringify({ "l4.desktop.appearance.theme": "dark" }));
    expect(readSavedTheme(configDir)).toBe("dark");
    writeSettings(configDir, JSON.stringify({ "l4.desktop.appearance.theme": 3 }));
    expect(readSavedTheme(configDir)).toBe("system");
    writeSettings(configDir, "{not json");
    expect(readSavedTheme(configDir)).toBe("system");
  });
});

describe("recolor and state", () => {
  test("recolor sets background, and the overlay only for overlay chrome", () => {
    const mac = new FakeChromeWindow();
    recolor(mac, "mac", true);
    expect(mac.backgrounds).toEqual([CHROME_COLORS.dark.background]);
    expect(mac.overlays).toEqual([]);
    const win = new FakeChromeWindow();
    recolor(win, "overlay", false);
    expect(win.overlays).toEqual([
      {
        color: CHROME_COLORS.light.header,
        symbolColor: CHROME_COLORS.light.symbol,
        height: 44,
      },
    ]);
    const gone = new FakeChromeWindow();
    gone.destroyed = true;
    recolor(gone, "overlay", true);
    expect(gone.backgrounds).toEqual([]);
  });

  test("state answers for the caller's window, none for web tabs", () => {
    const lights = trafficLightMetricsOf("25.0.0");
    const none: WindowChromeState = { kind: "none", fullscreen: false, insetStart: 0 };
    const win = new FakeChromeWindow();
    win.fullscreen = true;
    const caller: IpcCaller = { sender: Object.create(null) };
    expect(chromeStateFor(caller, "mac", [win], lights)).toEqual(none);
    const ownCaller: IpcCaller = { sender: Object.create(null) };
    // 시험용 발신자: 창의 webContents와 같은 객체
    const own = new FakeChromeWindow(ownCaller.sender);
    expect(chromeStateFor(ownCaller, "mac", [win, own], lights)).toEqual({
      kind: "mac",
      fullscreen: false,
      insetStart: 92,
    });
    own.fullscreen = true;
    expect(chromeStateFor(ownCaller, "mac", [own], lights)).toEqual({
      kind: "mac",
      fullscreen: true,
      insetStart: 0,
    });
    expect(chromeStateFor(ownCaller, "overlay", [own], lights)).toEqual({
      kind: "overlay",
      fullscreen: true,
      insetStart: 0,
    });
    expect(chromeStateFor({ sender: { kind: "web-tab" } }, "mac", [own], lights)).toEqual(none);
  });
});

function setup(saved: string | null): {
  readonly theme: FakeTheme;
  readonly providers: (() => BrowserWindowConstructorOptions)[];
  readonly call: ReturnType<typeof fakeCtx>["call"];
  readonly emitted: string[];
} {
  const fake = fakeCtx();
  if (saved !== null) {
    writeSettings(
      fake.ctx.paths.configDir,
      JSON.stringify({ "l4.desktop.appearance.theme": saved }),
    );
  }
  const providers: (() => BrowserWindowConstructorOptions)[] = [];
  const ctx: ShellContext = {
    ...fake.ctx,
    windowOptions: (provider) => {
      providers.push(provider);
    },
  };
  const theme = new FakeTheme();
  createWindowChromeModule({ theme, osRelease: "25.5.0" }).register(ctx);
  return {
    theme,
    providers,
    call: async (command, args) => fake.call(command, args),
    emitted: fake.emitted,
  };
}

describe("module", () => {
  test("applies the saved theme before the first window", () => {
    const { theme, providers } = setup("dark");
    expect(theme.sources).toEqual(["dark"]);
    expect(providers.map((provider) => provider().backgroundColor)).toEqual([
      CHROME_COLORS.dark.background,
    ]);
  });

  test("window_theme_set switches the source and rejects bad values", async () => {
    const { theme, call, providers } = setup(null);
    expect(await call("window_theme_set", { theme: "light" })).toEqual({ ok: true, value: null });
    expect(await call("window_theme_set", { theme: "neon" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(theme.sources).toEqual(["system", "light"]);
    expect(providers.map((provider) => provider().backgroundColor)).toEqual([
      CHROME_COLORS.light.background,
    ]);
  });

  test("window_chrome_state answers none when the caller has no window", async () => {
    const { call, emitted } = setup(null);
    expect(await call("window_chrome_state")).toEqual({
      ok: true,
      value: { kind: "none", fullscreen: false, insetStart: 0 },
    });
    expect(emitted).toEqual([]);
    expect(WINDOW_CHROME_EVENT).toBe("window-chrome");
  });
});
