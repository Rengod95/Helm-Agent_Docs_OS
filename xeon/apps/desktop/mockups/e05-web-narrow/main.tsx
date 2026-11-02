// 묶음 E · 웹·좁은 폭·원격 크래프트 목업 진입점. ?state=<id>(기본 web-login), ?scenario=<id>[&step=n][&hold=1], ?lang=en, ?theme=dark, ?dev=1.
// 좁은 폭 상태(m-*)는 390×844로 찍는다(모바일 폭). 원격 크래프트(remote-*)는 크래프트 영역, well 닫힘(DP-43).
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
        {(state) => {
          const sc = new URLSearchParams(window.location.search).get("scenario") ?? "";
          const remote = state.startsWith("remote") || sc.startsWith("remote");
          return (
            <ShellStateProvider
              key={state}
              initialArea={remote ? "workbench" : "chat"}
              initialWorkbenchTab="log"
              initialContextThreadId={remote ? null : "t1"}
              initialEndOpen={!remote}
            >
              <App state={state} />
            </ShellStateProvider>
          );
        }}
      </MockRoot>
    </StrictMode>,
  );
