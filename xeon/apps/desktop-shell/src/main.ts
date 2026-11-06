// Electron 메인 프로세스. 창, 스킴, ctx를 만들고 modules 목록의 모듈을 엮을 뿐이다. 기능은 src/main/<기능>.ts에 있다.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { detach, rethrow } from "@fresnel/contracts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from "electron";
import { createCommandRegistry } from "./main/commands.ts";
import type { ShellContext } from "./main/context.ts";
import { isTrustedFrame, isUiUrl } from "./main/frame-check.ts";
import { MODULES } from "./main/modules.ts";
import { CHANNEL_KEY, SHELL_CHANNELS } from "./shared/channels.ts";

const SCHEME = "app";
/** Tauri 설정(tauri.conf.json csp)과 같은 수준 */
const CSP = "default-src 'self'; connect-src 'self'; frame-src fresnel-view:";
const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ...MODULES.flatMap((module) => module.schemes ?? []),
]);

// Electron 전용 상태(캐시, 세션)는 Tauri 앱 폴더와 섞이지 않게 따로 둔다. 설정 파일은 configDir에서 둘이 같이 읽는다
const IDENTIFIER = "dev.fresnel.desktop";
const configDir = path.join(app.getPath("appData"), IDENTIFIER);
app.setPath("userData", path.join(app.getPath("appData"), `${IDENTIFIER}.electron`));
const logsDir =
  process.platform === "darwin"
    ? path.join(app.getPath("home"), "Library", "Logs", IDENTIFIER)
    : path.join(app.getPath("userData"), "logs");

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.resolve(import.meta.dirname, "..");
}

function uiDir(): string {
  const override = process.env["FRESNEL_UI_DIR"];
  // 개발 중에는 Tauri와 같은 UI 번들(`just desktop-ui`의 출력)을 쓴다
  const dev = path.join(resourcesDir(), "..", "desktop", "src-tauri", "ui");
  return path.resolve(override ?? (app.isPackaged ? path.join(resourcesDir(), "ui") : dev));
}

function readChannelId(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const id: unknown = Object.getOwnPropertyDescriptor(value, CHANNEL_KEY)?.value;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

function serveUi(root: string, request: Request): Response {
  const url = new URL(request.url);
  const rel = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) || !existsSync(file)) {
    return new Response("not found", { status: 404 });
  }
  return new Response(readFileSync(file), {
    headers: {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "content-security-policy": CSP,
    },
  });
}

function createContext(
  registry: ReturnType<typeof createCommandRegistry>,
  windows: Set<BrowserWindow>,
  quit: (() => void | Promise<void>)[],
  hooks: WindowHooks,
): ShellContext {
  return {
    env: process.env,
    platform: process.platform,
    paths: {
      userData: app.getPath("userData"),
      configDir,
      logs: logsDir,
      resources: resourcesDir(),
      ui: uiDir(),
    },
    dialogs: {
      async openFolder() {
        const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
      },
      async openFile() {
        const picked = await dialog.showOpenDialog({ properties: ["openFile"] });
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
      },
      async saveFile(suggestedName) {
        const picked = await dialog.showSaveDialog({ defaultPath: suggestedName });
        return picked.canceled || picked.filePath === "" ? null : picked.filePath;
      },
    },
    openExternal: (url) => shell.openExternal(url),
    handle: (command, handler) => {
      registry.handle(command, handler);
    },
    channel(caller, value) {
      const id = readChannelId(value);
      if (id === null) return null;
      const target: WebContents = caller.sender;
      return {
        send(message) {
          if (!target.isDestroyed()) target.send(SHELL_CHANNELS.channel, id, message);
        },
      };
    },
    emit(name) {
      for (const win of windows) {
        if (!win.isDestroyed()) win.webContents.send(SHELL_CHANNELS.event, name);
      }
    },
    onQuit(cleanup) {
      quit.unshift(cleanup);
    },
    handleScheme(scheme, handler) {
      protocol.handle(scheme, handler);
    },
    windows: () => [...windows],
    windowOptions(provider) {
      hooks.options.push(provider);
    },
    onWindow(hook) {
      hooks.created.push(hook);
    },
  };
}

interface WindowHooks {
  readonly options: (() => BrowserWindowConstructorOptions)[];
  readonly created: ((window: BrowserWindow) => void)[];
}

async function runCleanups(cleanups: readonly (() => void | Promise<void>)[]): Promise<void> {
  // 하나씩 차례로 기다린다(등록 역순)
  await cleanups.reduce<Promise<void>>(async (previous, cleanup) => {
    await previous;
    await cleanup();
  }, Promise.resolve());
  app.quit();
}

function createWindow(windows: Set<BrowserWindow>, hooks: WindowHooks): BrowserWindow {
  const extra: BrowserWindowConstructorOptions = {};
  for (const provider of hooks.options) Object.assign(extra, provider());
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Fresnel",
    ...extra,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  windows.add(win);
  for (const hook of hooks.created) hook(win);
  win.on("closed", () => {
    windows.delete(win);
  });
  // 외부 이동과 새 창은 막는다. 밖으로 여는 일은 open_external 명령(스킴 허용 목록)만 한다
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isUiUrl(url)) event.preventDefault();
  });
  win.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame) return;
    if (!isUiUrl(event.url)) event.preventDefault();
  });
  return win;
}

async function main(): Promise<void> {
  await app.whenReady();
  const root = uiDir();
  protocol.handle(SCHEME, (request) => serveUi(root, request));
  const registry = createCommandRegistry();
  const windows = new Set<BrowserWindow>();
  const quit: (() => void | Promise<void>)[] = [];
  const hooks: WindowHooks = { options: [], created: [] };
  const ctx = createContext(registry, windows, quit, hooks);
  for (const module of MODULES) module.register(ctx);
  ipcMain.handle(SHELL_CHANNELS.invoke, (event, command: unknown, args: unknown) => {
    const frame = event.senderFrame;
    const trusted = isTrustedFrame(
      frame === null ? null : { url: frame.url, isMain: frame.parent === null },
    );
    if (!trusted) return { ok: false, error: "forbidden-frame" };
    return registry.dispatch({ sender: event.sender }, command, args);
  });
  // 정리가 끝나기 전에는 끝내지 않는다. 한 번만 돈다
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    detach(runCleanups(quit), rethrow);
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  // SIGTERM, SIGINT는 정상 종료 순서(onQuit)를 탄다. 종료 중에 한 번 더 오면 바로 끝낸다
  let signaled = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (signaled) app.exit(130);
      signaled = true;
      app.quit();
    });
  }
  const win = createWindow(windows, hooks);
  await win.loadURL(`${SCHEME}://localhost/index.html`);
}

detach(main(), rethrow);
