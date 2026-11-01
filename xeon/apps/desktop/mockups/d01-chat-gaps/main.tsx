// 묶음 D · 대화 영역 빈칸 목업 진입점. ?state=<id>(기본 main), ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1(시나리오 막대).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES } from "./app";

loadCausticFonts();

const WELL_CLOSED = new Set([
  "cards-transcript",
  "cards-page",
  "loading",
  "read-fail",
  "turn-fail",
  "new-msgs",
  "restarting",
  "resume-band",
  "resume-resumed",
  "resume-closed",
  "resume-nothing",
  "list-loading",
  "list-fail",
  "list-more",
  "list-empty",
  "rename",
  "delete",
  "delete-running",
  "schedule-delete",
  "export",
  "export-fail",
]);

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            key={state}
            initialTab="inbox"
            initialEndOpen={!WELL_CLOSED.has(state)}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
