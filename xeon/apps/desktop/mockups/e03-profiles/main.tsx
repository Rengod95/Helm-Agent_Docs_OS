// 묶음 E · 프로필 관리 목업 진입점. ?state=<id>(기본 main), ?lang=en, ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1.
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES } from "./app";

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
            initialWorkbenchTab="log"
            initialEndOpen={false}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
