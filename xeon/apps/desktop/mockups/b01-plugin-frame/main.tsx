// B01 플러그인 화면 호스트 진입점. ?state=F1..D6, ?scenario=frame|liveness|blocked|helm(&step=n), ?theme=dark, ?dev=1. 글꼴이 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { PRESET, STATES } from "./model";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          // 크래프트 화면이라 오른쪽 well은 닫힌 채 시작한다(DP-43). 승인 상태(F4)만 받은 요청을 연다.
          <ShellStateProvider
            initialArea="workbench"
            initialWorkbenchTab="inbox"
            initialEndOpen={PRESET[state].inboxOpen === true}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
