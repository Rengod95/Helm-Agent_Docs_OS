// B03 확장 가져오기와 신뢰. ?state=E1..R2, ?scenario=install-folder|update-reprompt|uninstall(&step=n), ?theme=dark, ?dev=1.
// 글꼴이 맨 먼저(DP-15).
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
          // 작업대 표 화면이라 오른쪽 well은 닫힌 채 연다(DP-43).
          <ShellStateProvider initialArea="workbench" initialEndOpen={false}>
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
