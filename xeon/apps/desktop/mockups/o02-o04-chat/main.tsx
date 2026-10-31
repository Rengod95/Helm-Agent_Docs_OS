// O-02·O-03·O-04 대화 위 표면 목업 진입점. ?state=S1..S4, ?theme=dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OverlayPage, type OverlayState } from "./page";

loadCausticFonts();

const STATES: readonly { id: OverlayState; label: string }[] = [
  { id: "S1", label: "S1 O-02 셸 명령 확인" },
  { id: "S2", label: "S2 O-03 명령 결과" },
  { id: "S3", label: "S3 O-03 JSON 펼침" },
  { id: "S4", label: "S4 O-04 신뢰 카드" },
];

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <OverlayPage state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
