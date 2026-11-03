import { activeLocale } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { createRoot } from "react-dom/client";
import pkg from "../package.json" with { type: "json" };
import { createApp } from "./app/bootstrap.ts";
import { createLocalSettings, LOCAL } from "./settings-store/index.ts";
import { createTauriIpc } from "./transport/ipc.ts";
import { Providers } from "./views/providers.tsx";
import { App } from "./views/app.tsx";
import { createDesktopRegistry } from "./views/desktop-registry.tsx";
import { createShellStore, ShellStoreContext } from "./state/shell/index.ts";
import { persistShell, restoreShell } from "./views/shell/persist.ts";

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
  const app = createApp({
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
          <App registry={registry} keyOverrides={localSettings.get(LOCAL.keybindings)} mac={mac} />
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
