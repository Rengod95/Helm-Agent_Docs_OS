// 묶음 E · 크래프트 상태와 결과 없음 목업 진입점. ?state=<id>(기본 ext-list), ?scenario=<id>[&step=n][&hold=1], ?lang=en, ?theme=dark, ?dev=1.
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES } from "./app";

loadCausticFonts();

const CHAT = new Set(["palette-empty", "proposals-empty"]);
const PALETTE = new Set(["palette-empty", "palette-empty-wb"]);

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          // 크래프트 표 화면은 well을 닫고 연다(DP-43).
          <ShellStateProvider
            key={state}
            initialArea={CHAT.has(state) ? "chat" : "workbench"}
            initialWorkbenchTab="log"
            initialEndOpen={false}
            initialPaletteOpen={PALETTE.has(state)}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
