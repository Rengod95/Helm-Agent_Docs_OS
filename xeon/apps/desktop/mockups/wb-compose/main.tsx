// 블록 구성기 시안 진입점. ?state=S1..S8, ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { MockProvider, STATES, type StateId } from "./store";

loadCausticFonts();

const WELL: Partial<Record<StateId, string>> = { S2: "palette", S5: "palette" };

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            initialArea="workbench"
            initialEndOpen={WELL[state] !== undefined}
            initialWorkbenchTab={WELL[state] ?? "inbox"}
          >
            <MockProvider state={state}>
              <App />
            </MockProvider>
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
