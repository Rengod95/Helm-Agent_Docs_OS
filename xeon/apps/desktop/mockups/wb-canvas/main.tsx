// 런타임 캔버스 시안 진입점. ?state=S1..S13, ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { STATES, initialFor } from "./store";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            initialArea="workbench"
            initialWorkbenchTab="inspect"
            initialEndOpen={initialFor(state).inspectorOpen}
            initialContextThreadId={
              initialFor(state).ctx.startsWith("t") ? initialFor(state).ctx : null
            }
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
