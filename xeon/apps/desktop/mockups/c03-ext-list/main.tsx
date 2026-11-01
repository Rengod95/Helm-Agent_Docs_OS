// P-13 확장 목록(켜는 범위·대기·X 훅) 목업 진입점. ?state=<id>(기본 list), ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1.
import { loadCausticFonts, MockRoot, ShellStateProvider, type WorkbenchContext } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES, type StateId } from "./app";

loadCausticFonts();

function contextFor(s: StateId): WorkbenchContext {
  if (s === "all" || s === "safe") return { kind: "all" };
  if (s === "profile") return { kind: "profile", profileId: "explore" };
  if (s === "trial") return { kind: "trial", threadId: "t8" };
  return { kind: "thread", threadId: "t1", pinned: false };
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            key={state}
            initialArea="workbench"
            initialEndOpen={false}
            initialContext={contextFor(state)}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
