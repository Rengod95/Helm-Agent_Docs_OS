// P-21 구성기 진입 목업 진입점. ?state=<id>, ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1(시나리오 막대).
// 상태와 시나리오는 flow.ts의 한 상태 기계다: 상태 = 대본의 앞 n개 동작을 바로 적용한 모습.
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { STATES, type StateId } from "./flow";

loadCausticFonts();

const WELL: Partial<Record<StateId, string>> = { "gate-node": "inspect" };

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
            {...(state === "gate-node-trial"
              ? { initialContext: { kind: "trial" as const, threadId: "t8" } }
              : {})}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
