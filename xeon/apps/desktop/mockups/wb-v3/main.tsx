// 캔버스 v3 진입점. ?state=<id>, ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
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
        {(state) => {
          const i = initialFor(state);
          return (
            <ShellStateProvider
              initialArea="workbench"
              initialWorkbenchTab="inspect"
              initialEndOpen={false}
              initialContextThreadId={i.view.startsWith("t") ? i.view : null}
            >
              <App state={state} />
            </ShellStateProvider>
          );
        }}
      </MockRoot>
    </StrictMode>,
  );
