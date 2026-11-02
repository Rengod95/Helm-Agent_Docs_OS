// 크래프트 시안(W1–W5) 진입점. ?state=S1..S11, ?theme=dark. 글꼴이 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { isChatState, MockProvider, STATES } from "./store";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          // 크래프트 화면은 표가 넓어 오른쪽 well을 닫은 채 시작한다(막대만). W5는 런타임 탭을 연 채로.
          <ShellStateProvider
            initialArea={isChatState(state) ? "chat" : "workbench"}
            initialTab="runtime"
            initialWorkbenchTab="log"
            initialEndOpen={isChatState(state)}
          >
            <MockProvider state={state}>
              <App />
            </MockProvider>
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
