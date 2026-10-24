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
  const app = createApp({
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
    void app.stop();
  });
  createRoot(container).render(
    <Providers engine={app.engine.read} ui={app.ui.read} commands={app.commands}>
      <App />
    </Providers>,
  );
}
