// 런타임 지도 시안 A 진입점. ?state=<id>, ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { STATES, initOf } from "./store";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => {
          const i = initOf(state);
          return (
            <ShellStateProvider
              initialArea="workbench"
              initialWorkbenchTab="inspect"
              initialEndOpen={i.zoom === "detail" && i.screen === "map" && i.mapView === "canvas"}
              initialContextThreadId={i.ctx.startsWith("t") ? i.ctx : null}
            >
              <App state={state} />
            </ShellStateProvider>
          );
        }}
      </MockRoot>
    </StrictMode>,
  );
