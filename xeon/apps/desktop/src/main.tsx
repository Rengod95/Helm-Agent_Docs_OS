import { activeLocale } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import pkg from "../package.json" with { type: "json" };
import { createApp } from "./app/bootstrap.ts";
import { createLocalSettings, LOCAL } from "./settings-store/index.ts";
import { createTauriIpc } from "./transport/ipc.ts";
import { Providers } from "./views/providers.tsx";
import { App } from "./views/app.tsx";
import { createPluginUiRuntime } from "./plugin-ui/runtime.ts";
import { createConfirmQueue } from "./views/plugin/confirm-host.tsx";
import { PluginUiProvider } from "./views/plugin/plugin-context.tsx";
import { createDesktopRegistry } from "./views/desktop-registry.tsx";
import { createShellStore, ShellStoreContext } from "./state/shell/index.ts";
import { persistShell, restoreShell } from "./views/shell/persist.ts";
import type { FolderPickInvoke } from "./views/folder-pick.ts";
import type { OsReauthInvoke } from "./views/os-reauth.ts";
import { createOsReauthGate, UNAVAILABLE_GATE } from "./app/secret-reveal-gate.ts";
import { RevealGateContext } from "./views/pages/secrets/reveal-gate-context.ts";

const osReauth: OsReauthInvoke = (command, args) => invoke(command, args);

// 폴더 선택 창은 모든 OS에서 Rust가 띄운다(플러그인 권한은 WebView에 주지 않는다)
const folderPick: FolderPickInvoke = (command) => invoke(command);

// WebView 진입점. 스토어와 연결은 createApp이 만들고 여기서는 화면에 붙이기만 한다.
const container = document.getElementById("root");
if (container === null) {
  document.body.textContent = "root element is missing";
} else {
  const root = createRoot(container);
  // 로케일이 바뀌면 문장을 다시 풀도록 트리를 새로 만든다(문장은 렌더 때 현재 로케일로 풀린다)
  const rerender: { current: ((locale: string) => void) | null } = { current: null };
  const ipc = createTauriIpc();
  const localSettings = createLocalSettings(ipc);
  const shell = createShellStore(window.innerWidth);
  const registry = createDesktopRegistry();
  const mac = navigator.platform.startsWith("Mac");
  // 사람 재인증 창은 macOS에서만 있다(Rust `os_reauth`는 다른 OS에서 항상 unavailable). 그 밖은 값 보기가 잠긴다
  const revealGate = mac ? createOsReauthGate(osReauth) : UNAVAILABLE_GATE;
  const app = createApp({
    localSettings,
    languages: navigator.languages.length > 0 ? navigator.languages : [navigator.language],
    onLocaleChange: (locale) => {
      rerender.current?.(locale);
    },
    ipc,
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => {
        window.clearTimeout(handle);
      },
    },
    frames: window,
    monotonic: () => performance.now(),
    clipboard: navigator.clipboard,
    appVersion: pkg.version,
    frameFallbackMs: 100,
  });
  // 플러그인 화면 실행 맥락. Windows는 전용 스킴 주소가 달라 프레임 모드를 켜지 않는다(ADR-0021 §3.6.2)
  const framesSupported = !navigator.platform.startsWith("Win");
  const pluginUi = {
    runtime: createPluginUiRuntime({
      withConnection: (run) => app.commands.pluginUi.withConnection(run),
      appRootsInvoke: framesSupported ? (command, args) => invoke(command, args) : undefined,
      framesSupported,
    }),
    confirm: createConfirmQueue(),
    openExternal: async (href: string) => {
      await invoke("open_external", { href });
    },
  };
  window.addEventListener("error", (event) => {
    app.log.logger.error("desktop.window.error", {
      name: event.error instanceof Error ? event.error.name : "unknown",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    app.log.logger.error("desktop.window.unhandled_rejection", {
      name: event.reason instanceof Error ? event.reason.name : "unknown",
    });
  });
  // 창이 닫히면 릴레이만 끊는다. 엔진을 끄는 일은 셸이 한다(spec 4.3)
  window.addEventListener("pagehide", () => {
    detach(app.stop(), rethrow);
  });
  const render = (locale: string): void => {
    root.render(
      <ShellStoreContext value={shell}>
        <Providers key={locale} engine={app.engine.read} ui={app.ui.read} commands={app.commands}>
          <PluginUiProvider value={pluginUi}>
            <RevealGateContext value={revealGate}>
              <App
                registry={registry}
                keyOverrides={localSettings.get(LOCAL.keybindings)}
                mac={mac}
                folderPick={folderPick}
              />
            </RevealGateContext>
          </PluginUiProvider>
        </Providers>
      </ShellStoreContext>,
    );
  };
  rerender.current = render;
  render(activeLocale());
  // 저장해 둔 영역·자리를 읽어 얹은 뒤부터 바뀐 값을 쓴다(읽기 전에는 쓰지 않는다)
  detach(
    localSettings.load().then((loaded) => {
      if (loaded.ok) shell.actions.replace(restoreShell(shell.read.getState(), localSettings));
      shell.read.subscribe((next, prev) => {
        detach(Promise.all(persistShell(prev, next, localSettings)), rethrow);
      });
      render(activeLocale());
      return null;
    }),
    rethrow,
  );
}
