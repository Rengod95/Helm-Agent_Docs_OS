// 창 틀(L4.desktop-ux DP-80·DP-81, [결정: 2026-11-11 사용자]). OS 제목 막대를 없애고 앱 맨 위 머리 줄이 창 틀 구실을 한다.
// - macOS: 제목 막대를 숨기고(`hidden`) 신호등을 머리 줄(높이 `--shell-header-h` 45px) 세로 가운데에 둔다.
//   화면은 `insetStart`(신호등 자리 + 16px)만큼 머리 줄 앞을 비운다.
// - Windows·Linux: 제목 막대를 숨기고 창 단추만 `titleBarOverlay`로 남긴다. 단추 면과 기호 색은 테마를 따른다.
// 테마: 시작할 때 데스크톱 설정 파일의 `l4.desktop.appearance.theme`을 창을 만들기 전에 읽어 `nativeTheme.themeSource`와
// 창 배경색을 맞춘다(첫 그림 전 흰 번쩍임 방지). 화면이 테마를 바꾸면 `window_theme_set`으로 알린다.
// 화면은 `window_chrome_state`로 틀 종류와 전체 화면 여부를 읽고, 바뀌면 `window-chrome` 이벤트를 받아 다시 읽는다.
// 앱 확대(화면의 `<html>` `zoom`)는 머리 줄을 화면 px로 키우지만 신호등은 OS가 그대로 그린다. 화면이 `window_chrome_state {zoom}`으로
// 확대(%)를 알리면 신호등 y를 커진 머리 줄의 세로 가운데로 다시 둔다(DP-172, `setWindowButtonPosition`).
// 웹 탭에는 OS 창이 없다. 두 명령은 웹 게이트웨이 표에서 숨기고(commands-table.ts), 혹시 닿아도 "none"으로 답한다.
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  TitleBarOverlayOptions,
} from "electron";
import { assertNever, attempt } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { IpcCaller, ShellModule } from "./context.ts";
import { readSettingsObject } from "./desktop-settings.ts";
import { ownField } from "./lib/narrow.ts";

/** 화면이 테마를 저장하는 데스크톱 설정 키(apps/desktop `LOCAL.theme`와 같다) */
export const KEY_THEME = "l4.desktop.appearance.theme";
/** 틀 상태가 바뀌었을 때(전체 화면 들어가기·나오기) 화면에 보내는 이벤트 이름 */
export const WINDOW_CHROME_EVENT = "window-chrome";

export const THEME_SOURCES = ["system", "light", "dark"] as const;
export type ThemeSource = (typeof THEME_SOURCES)[number];

/** 틀 종류. `mac`: 숨긴 제목 막대와 신호등, `overlay`: 숨긴 제목 막대와 오른쪽 위 창 단추, `none`: OS 틀이 없거나(웹) 손대지 않음 */
export type ChromeKind = "mac" | "overlay" | "none";

export interface WindowChromeState {
  readonly kind: ChromeKind;
  readonly fullscreen: boolean;
  /** 머리 줄 앞에서 비울 폭(px). 신호등이 있을 때(macOS, 전체 화면 아님)만 0보다 크다 */
  readonly insetStart: number;
}

/**
 * 머리 줄 높이(px). 화면의 `--shell-header-h`(control-md 32 + 위아래 6 + 아래 선 1)와 같아야 한다.
 * 신호등과 오버레이 높이가 이 값으로 정해진다. 앱 확대(zoom)는 신호등 y만 따라간다(`trafficLightPositionOf`, DP-172).
 * 오버레이 높이는 OS가 그리는 부분이라 px 고정이다
 */
export const HEADER_HEIGHT = 45;
/** 신호등 첫 단추의 창 왼쪽 끝에서 거리(px). Claude·Codex 데스크톱, Linear 모두 16~20px이다 */
const TRAFFIC_LIGHT_X = 16;
/** 신호등 오른쪽 끝과 머리 줄 첫 요소 사이(px). 신호등 단추 사이 간격보다 넓어 한 무리로 읽히지 않게 한다 */
const TRAFFIC_LIGHT_GAP = 16;

/** macOS 신호등 치수(px). 단추 지름과 단추 중심 사이 거리 */
export interface TrafficLightMetrics {
  readonly size: number;
  readonly pitch: number;
}

/**
 * Darwin 커널 판(`os.release()`, 예 "25.5.0")으로 신호등 치수를 고른다. macOS 26(Darwin 25)부터 단추가 14px·간격 23px이고
 * 그 전은 12px·20px이다(2026-11-11 이 Mac의 화면에서 잰 값과 이전 판의 시스템 값)
 */
export function trafficLightMetricsOf(release: string): TrafficLightMetrics {
  const major = Number.parseInt(release.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= 25 ? { size: 14, pitch: 23 } : { size: 12, pitch: 20 };
}

/** 화면이 알릴 수 있는 앱 확대(%) 범위. 화면의 확대 단계(90~200, appearance-prefs `ZOOM_STEPS`)를 담는다 */
export const ZOOM_PERCENT_MIN = 50;
export const ZOOM_PERCENT_MAX = 300;

/**
 * 신호등 첫 단추의 왼쪽 위 자리(창 px). 머리 줄은 앱 확대를 따라 화면에서 `HEADER_HEIGHT × 확대`가 되므로, 아래 선을 뺀
 * `(HEADER_HEIGHT - 1) × 확대` 안에서 세로 가운데다(DP-172. 100%: 44 안에서 y 15, 125%: 55 안에서 y 21). x는 확대와 무관하다
 */
export function trafficLightPositionOf(
  metrics: TrafficLightMetrics,
  zoomPercent = 100,
): {
  readonly x: number;
  readonly y: number;
} {
  const zoom = zoomPercent / 100;
  return { x: TRAFFIC_LIGHT_X, y: Math.round(((HEADER_HEIGHT - 1) * zoom - metrics.size) / 2) };
}

/** `window_chrome_state`의 인자에서 확대(%)를 읽는다. 없으면 null, 범위 밖이거나 정수가 아니면 "bad" */
export function zoomPercentOf(args: unknown): number | null | "bad" {
  const zoom = ownField(args, "zoom");
  if (zoom === undefined) return null;
  if (typeof zoom !== "number" || !Number.isInteger(zoom)) return "bad";
  return zoom >= ZOOM_PERCENT_MIN && zoom <= ZOOM_PERCENT_MAX ? zoom : "bad";
}

/** 창 왼쪽 끝에서 머리 줄 첫 요소까지 비울 폭(px): 첫 단추 자리 + 세 단추 폭 + 간격 */
export function trafficLightInsetOf(metrics: TrafficLightMetrics): number {
  return TRAFFIC_LIGHT_X + metrics.pitch * 2 + metrics.size + TRAFFIC_LIGHT_GAP;
}

/**
 * 창 배경과 오버레이 색. `background`는 화면의 앱 바탕(`--cs-color-bg-app`, oklch 0.975 / 0.135)과 같은 sRGB 값이다.
 * `header`는 머리 줄 면(왼쪽 패널과 같은 `--cs-color-surface-base`, oklch 0.995 / 0.18)이고 Windows·Linux 창 단추 오버레이가 이 색을 쓴다
 * (DP-137 [결정: 2026-11-12 사용자] 머리 줄 색을 왼쪽 패널 색에 맞춘다)
 */
export const CHROME_COLORS: Readonly<
  Record<
    "light" | "dark",
    { readonly background: string; readonly header: string; readonly symbol: string }
  >
> = {
  light: { background: "#f7f7f7", header: "#fdfdfd", symbol: "#3d3d3d" },
  dark: { background: "#080808", header: "#121212", symbol: "#d6d6d6" },
};

export function themeSourceOf(value: unknown): ThemeSource {
  return THEME_SOURCES.find((theme) => theme === value) ?? "system";
}

/** 플랫폼별 틀 종류. macOS는 신호등, Windows·Linux는 오버레이 창 단추다 */
export function chromeKindOf(platform: NodeJS.Platform): ChromeKind {
  if (platform === "darwin") return "mac";
  if (platform === "win32" || platform === "linux") return "overlay";
  return "none";
}

/** 저장된 테마를 읽는다. 파일이 없거나 틀리면 "system"이다(설정 파일 진단은 desktop-settings 모듈이 남긴다) */
export function readSavedTheme(configDir: string): ThemeSource {
  const read = attempt(() => readSettingsObject(configDir));
  return read.ok ? themeSourceOf(read.value[KEY_THEME]) : "system";
}

export function overlayOf(dark: boolean): TitleBarOverlayOptions {
  const colors = CHROME_COLORS[dark ? "dark" : "light"];
  // 오버레이 면은 머리 줄과 같은 색이다. 높이는 아래 선을 뺀 값이라 선이 단추 밑까지 이어진다
  return { color: colors.header, symbolColor: colors.symbol, height: HEADER_HEIGHT - 1 };
}

/** 창을 만들 때 덮어쓸 옵션 */
export function chromeOptionsOf(
  kind: ChromeKind,
  dark: boolean,
  lights: TrafficLightMetrics,
): BrowserWindowConstructorOptions {
  const backgroundColor = CHROME_COLORS[dark ? "dark" : "light"].background;
  switch (kind) {
    case "mac":
      return {
        backgroundColor,
        titleBarStyle: "hidden",
        trafficLightPosition: { ...trafficLightPositionOf(lights) },
      };
    case "overlay":
      return { backgroundColor, titleBarStyle: "hidden", titleBarOverlay: overlayOf(dark) };
    case "none":
      return { backgroundColor };
    default:
      return assertNever(kind, "chromeOptionsOf");
  }
}

/** 운영체제 테마 면. Electron `nativeTheme`을 main.ts가 감싸 넣고 시험은 가짜를 넣는다 */
export interface NativeThemePort {
  setSource(source: ThemeSource): void;
  /** 지금 어두운 색을 쓰는가(themeSource와 운영체제 설정을 합친 결과) */
  prefersDark(): boolean;
  onUpdated(listener: () => void): void;
}

/** 창이 제공해야 하는 면. Electron `BrowserWindow`가 이것을 만족한다 */
export interface ChromeWindow {
  readonly webContents: unknown;
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  setBackgroundColor(color: string): void;
  setTitleBarOverlay(options: TitleBarOverlayOptions): void;
  /** macOS 신호등 자리. 앱 확대가 바뀌면 다시 둔다(DP-172) */
  setWindowButtonPosition(position: { readonly x: number; readonly y: number } | null): void;
  on(event: "enter-full-screen" | "leave-full-screen", listener: () => void): unknown;
}

/** 창 하나의 색을 지금 테마에 맞춘다 */
export function recolor(win: ChromeWindow, kind: ChromeKind, dark: boolean): void {
  if (win.isDestroyed()) return;
  win.setBackgroundColor(CHROME_COLORS[dark ? "dark" : "light"].background);
  if (kind === "overlay") win.setTitleBarOverlay(overlayOf(dark));
}

/** 요청한 화면의 창. 웹 탭이거나 창을 못 찾거나 닫혔으면 null이다 */
function callerWindow<W extends ChromeWindow>(caller: IpcCaller, windows: readonly W[]): W | null {
  if ("kind" in caller.sender) return null;
  const win = windows.find((candidate) => candidate.webContents === caller.sender);
  return win === undefined || win.isDestroyed() ? null : win;
}

/** 신호등을 앱 확대에 맞춰 머리 줄 세로 가운데에 다시 둔다. 신호등이 있는 틀(mac)에서만 한다 */
export function placeTrafficLights(
  win: ChromeWindow,
  kind: ChromeKind,
  lights: TrafficLightMetrics,
  zoomPercent: number,
): void {
  if (kind !== "mac" || win.isDestroyed()) return;
  win.setWindowButtonPosition({ ...trafficLightPositionOf(lights, zoomPercent) });
}

/** 요청한 화면의 창을 찾아 틀 상태를 만든다. 웹 탭이거나 창을 못 찾으면 `none`이다 */
export function chromeStateFor(
  caller: IpcCaller,
  kind: ChromeKind,
  windows: readonly ChromeWindow[],
  lights: TrafficLightMetrics,
): WindowChromeState {
  const none: WindowChromeState = { kind: "none", fullscreen: false, insetStart: 0 };
  const win = callerWindow(caller, windows);
  if (win === null) return none;
  const fullscreen = win.isFullScreen();
  // 전체 화면에는 신호등이 없다(맨 위로 마우스를 올리면 OS 메뉴 막대와 함께 따로 내려온다)
  const insetStart = kind === "mac" && !fullscreen ? trafficLightInsetOf(lights) : 0;
  return { kind, fullscreen, insetStart };
}

export interface WindowChromeDeps {
  readonly theme: NativeThemePort;
  /** 운영체제 커널 판(`os.release()`). 신호등 치수를 고른다 */
  readonly osRelease: string;
}

export function createWindowChromeModule(deps: WindowChromeDeps): ShellModule {
  return {
    name: "window-chrome",
    register(ctx) {
      const kind = chromeKindOf(ctx.platform);
      const lights = trafficLightMetricsOf(deps.osRelease);
      deps.theme.setSource(readSavedTheme(ctx.paths.configDir));
      const windows = (): readonly BrowserWindow[] => ctx.windows();
      const recolorAll = (): void => {
        const dark = deps.theme.prefersDark();
        for (const win of windows()) recolor(win, kind, dark);
      };
      // 창을 만들 때마다 지금 테마로 옵션을 계산한다(트레이에서 다시 열 때도)
      ctx.windowOptions(() => chromeOptionsOf(kind, deps.theme.prefersDark(), lights));
      ctx.onWindow((win) => {
        win.on("enter-full-screen", () => {
          ctx.emit(WINDOW_CHROME_EVENT);
        });
        win.on("leave-full-screen", () => {
          ctx.emit(WINDOW_CHROME_EVENT);
        });
      });
      // 운영체제 테마가 바뀌면("system"일 때) 창 색도 따라간다
      deps.theme.onUpdated(recolorAll);
      // 인자 `{zoom}`(%)이 있으면 그 창의 신호등을 확대에 맞춰 다시 둔 뒤 상태를 답한다(DP-172)
      ctx.handle("window_chrome_state", (caller, args) => {
        const zoom = zoomPercentOf(args);
        if (zoom === "bad") throw new ShellError("bad-request");
        const win = zoom === null ? null : callerWindow(caller, windows());
        if (win !== null && zoom !== null) placeTrafficLights(win, kind, lights, zoom);
        return chromeStateFor(caller, kind, windows(), lights);
      });
      ctx.handle("window_theme_set", (caller, args) => {
        // 웹 탭의 테마는 그 기기 화면에만 걸린다. 데스크톱 창 색을 바꾸지 않는다
        if ("kind" in caller.sender) throw new ShellError("unsupported-on-web");
        const theme = ownField(args, "theme");
        if (!THEME_SOURCES.some((source) => source === theme)) throw new ShellError("bad-request");
        deps.theme.setSource(themeSourceOf(theme));
        recolorAll();
        return null;
      });
    },
  };
}
