// N-08~N-13 대화에서 제작 목업 진입점. ?state=<id>(기본 result), ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1(시나리오 막대).
// 상태와 시나리오는 flow.ts의 한 상태 기계다: 상태 = 대본의 앞 n개 동작을 바로 적용한 모습.
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES } from "./app";

loadCausticFonts();

const OPEN_RUNTIME = new Set([
  "progress",
  "ask-kind",
  "ask-fix",
  "scope-denied",
  "off",
  "safe-mode",
]);

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            key={state}
            initialArea={state === "page" ? "workbench" : "chat"}
            initialTab={
              state === "well" || state === "trial-running" ? "authoring/panel" : "runtime"
            }
            initialEndOpen={
              OPEN_RUNTIME.has(state) || state === "well" || state === "trial-running"
            }
            initialContext={{ kind: "thread", threadId: "ta", pinned: state === "page" }}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
