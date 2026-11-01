// B02 대화 영역의 플러그인 기여(well, card, status, command). ?state=S1..S9, ?scenario=slot-overflow|card-more|status-command(&step=n),
// ?theme=dark, ?dev=1. 글꼴이 맨 먼저(DP-15).
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
          // well은 App이 첫 값(openTab)으로 연다. 여기서는 닫힌 채 시작한다.
          <ShellStateProvider initialArea="chat" initialEndOpen={false}>
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
