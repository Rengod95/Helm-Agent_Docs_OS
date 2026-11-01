// P-19 시험 실행 목업 진입점. ?state=<id>(기본 list), ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1(시나리오 막대).
// 상태와 시나리오는 flow.ts의 한 상태 기계다: 상태 = 대본의 앞 n개 동작을 바로 적용한 모습.
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
            initialEndOpen={false}
            initialContext={{ kind: "all" }}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
