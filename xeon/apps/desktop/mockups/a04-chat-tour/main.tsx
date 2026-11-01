// N-14 대화 영역 둘러보기 목업 진입점. ?state=<id>(기본 tour-1), ?scenario=<id>, ?theme=dark, ?dev=1(시나리오 막대).
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
            initialTab="runtime"
            initialEndOpen={state !== "tour-1" && state !== "entry" && state !== "narrow-1"}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
