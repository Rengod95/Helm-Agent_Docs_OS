import { activeLocale } from "@xeon/client/i18n";
import { detach, rethrow } from "@xeon/contracts";
import { createRoot } from "react-dom/client";
import pkg from "../package.json" with { type: "json" };
import { createApp } from "./app/bootstrap.ts";
import { createTauriIpc } from "./transport/ipc.ts";
import { Providers } from "./views/providers.tsx";
import { App } from "./views/app.tsx";

// WebView 진입점. 스토어와 연결은 createApp이 만들고 여기서는 화면에 붙이기만 한다.
const container = document.getElementById("root");
if (container === null) {
  document.body.textContent = "root element is missing";
} else {
  const root = createRoot(container);
  // 로케일이 바뀌면 문장을 다시 풀도록 트리를 새로 만든다(문장은 렌더 때 현재 로케일로 풀린다)
  const rerender: { current: ((locale: string) => void) | null } = { current: null };
  const app = createApp({
    languages: navigator.languages.length > 0 ? navigator.languages : [navigator.language],
    onLocaleChange: (locale) => {
      rerender.current?.(locale);
    },
    ipc: createTauriIpc(),
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
      <Providers key={locale} engine={app.engine.read} ui={app.ui.read} commands={app.commands}>
        <App />
      </Providers>,
    );
  };
  rerender.current = render;
  render(activeLocale());
}
