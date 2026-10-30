// P-04 변경 검토 목업 진입점. ?state=S1..S8, ?theme=dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReviewPage, type ReviewState } from "./page";

loadCausticFonts();

const STATES: readonly { id: ReviewState; label: string }[] = [
  { id: "S1", label: "S1 기본(결정 중)" },
  { id: "S2", label: "S2 줄 의견 쓰는 중" },
  { id: "S3", label: "S3 제출 결과" },
  { id: "S4", label: "S4 바이너리·읽기 실패" },
  { id: "S5", label: "S5 라운드 2" },
  { id: "S6", label: "S6 읽는 중" },
  { id: "S7", label: "S7 빈(no_changes)" },
  { id: "S8", label: "S8 오프라인" },
];

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <ReviewPage state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
