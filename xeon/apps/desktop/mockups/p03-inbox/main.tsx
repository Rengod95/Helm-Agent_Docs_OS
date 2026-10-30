// P-03 받은 요청 목업 진입점. ?state=S1..S9, ?theme=dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { InboxPage, type InboxState } from "./page";

loadCausticFonts();

const STATES: readonly { id: InboxState; label: string }[] = [
  { id: "S1", label: "S1 기본(도구 승인)" },
  { id: "S2", label: "S2 계획 카드" },
  { id: "S3", label: "S3 변경 검토 카드" },
  { id: "S4", label: "S4 보내는 중·원격·실패" },
  { id: "S5", label: "S5 빈" },
  { id: "S6", label: "S6 읽는 중" },
  { id: "S7", label: "S7 오류" },
  { id: "S8", label: "S8 오프라인" },
  { id: "S9", label: "S9 권한 필요(원격)" },
];

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <InboxPage state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
