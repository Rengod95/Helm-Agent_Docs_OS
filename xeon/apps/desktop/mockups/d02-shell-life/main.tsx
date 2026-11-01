// 묶음 D · 셸 수명 목업 진입점. ?state=<id>(기본 main), ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1(시나리오 막대).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES } from "./app";

loadCausticFonts();

/** well을 연 채로 시작하는 상태(토스트 자리, 대화 기본). 나머지는 상태 표시줄·무대가 잘 보이게 닫는다. */
const WELL_OPEN = new Set(["main", "toast-well", "reattached", "update-done"]);

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => {
          const sc = new URLSearchParams(window.location.search).get("scenario");
          return (
            <ShellStateProvider
              key={state}
              initialTab="inbox"
              initialEndOpen={sc === "toast-well" || (sc === null && WELL_OPEN.has(state))}
            >
              <App state={state} />
            </ShellStateProvider>
          );
        }}
      </MockRoot>
    </StrictMode>,
  );
