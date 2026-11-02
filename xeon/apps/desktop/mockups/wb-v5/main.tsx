// 크래프트 v5 진입점. 상태 전환기 없이 한 화면을 눌러서 본다. ?theme=light|dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { installSpring } from "./spring";

loadCausticFonts();
installSpring();
// 글자는 변형 d(type-variants). 다른 값이 ?type=으로 오지 않았으면 d를 건다.
if (document.documentElement.dataset["type"] === undefined)
  document.documentElement.dataset["type"] = "d";

const STATES = [{ id: "main", label: "크래프트" }] as const;

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {() => (
          <ShellStateProvider
            initialArea="workbench"
            initialWorkbenchTab="inspect"
            initialEndOpen={false}
            initialContextThreadId="t1"
          >
            <App />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
