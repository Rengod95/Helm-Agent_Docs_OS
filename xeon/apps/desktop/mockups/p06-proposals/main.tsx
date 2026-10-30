// P-06 제안 목업 진입점. ?state=S1..S9, ?theme=dark. 글꼴은 맨 먼저(DP-15).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProposalsPage, type ProposalState } from "./page";

loadCausticFonts();

const STATES: readonly { id: ProposalState; label: string }[] = [
  { id: "S1", label: "S1 기본(untrusted 경고)" },
  { id: "S2", label: "S2 충돌" },
  { id: "S3", label: "S3 수정 중" },
  { id: "S4", label: "S4 거절 메모" },
  { id: "S5", label: "S5 적용됨·되돌리기" },
  { id: "S6", label: "S6 빈" },
  { id: "S7", label: "S7 읽는 중" },
  { id: "S8", label: "S8 오류" },
  { id: "S9", label: "S9 오프라인" },
];

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <ProposalsPage state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
