// 크래프트 2차(W6–W9) 시안 진입점. ?state=S1..S14, ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { MockProvider, STATES, initialContextOf } from "./store";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            initialArea="workbench"
            initialEndOpen={false}
            initialContextThreadId={initialContextOf(state)}
          >
            <MockProvider state={state}>
              <App />
            </MockProvider>
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
