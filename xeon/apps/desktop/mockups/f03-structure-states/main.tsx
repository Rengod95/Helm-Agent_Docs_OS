// P-16 구조 화면 상태 목업 진입점. ?state=<id>(기본 safe-mode), ?scenario=<id>[&step=n&hold=1], ?theme=dark, ?dev=1(시나리오 막대).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { STATES } from "./flow";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            key={state}
            initialArea="workbench"
            initialWorkbenchTab="inbox"
            initialEndOpen={false}
            initialContextThreadId={null}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
