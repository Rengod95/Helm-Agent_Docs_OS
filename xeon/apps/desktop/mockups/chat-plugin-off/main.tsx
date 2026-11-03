// A5 이 대화에서 플러그인 끄기(대화 영역 오른쪽 플러그인 탭). ?state=S1..S6, ?theme=dark, ?dev=1. 글꼴이 맨 먼저(DP-15).
// 목업만 있고 구현은 없다: 사용자가 이 시안을 먼저 본다. 엔진은 `settings.set` scope launch + `threadId`로 받는다.
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { STATES } from "./model";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider initialArea="chat" initialEndOpen={false}>
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
