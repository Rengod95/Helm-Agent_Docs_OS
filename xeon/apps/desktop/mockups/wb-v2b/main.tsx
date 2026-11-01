// 방향 B "정교한 노드 편집기" 진입점. ?state=S1..S14, ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { STATES, initialFor } from "./store";

loadCausticFonts();

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => {
          const s = initialFor(state);
          return (
            <ShellStateProvider
              initialArea="workbench"
              initialWorkbenchTab={s.wellTab}
              initialEndOpen={s.wellOpen}
              initialContextThreadId={s.ctx.startsWith("t") ? s.ctx : null}
            >
              <App state={state} />
            </ShellStateProvider>
          );
        }}
      </MockRoot>
    </StrictMode>,
  );
