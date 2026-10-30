// P-02 대화 목업 진입점. ?state=S1..S7 로 화면 상태, ?theme=light|dark 로 테마를 고른다(기본 S1, 라이트).
// 글꼴은 맨 먼저: caustic fonts.css를 렌더를 막지 않게 싣는다(../_shell/fonts.ts 머리 주석, DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { MockProvider, STATES } from "./store";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider initialPaletteOpen={state === "S7"}>
            <MockProvider state={state}>
              <App />
            </MockProvider>
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
