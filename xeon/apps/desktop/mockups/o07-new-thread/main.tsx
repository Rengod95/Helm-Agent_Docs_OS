// O-07 새 대화 목업. 대화를 고르지 않은 P-02 위에 ⌘N으로 연 모습. ?state=S1..S5, ?theme=dark.
// P-01 첫 실행의 "대화 시작"도 같은 부품(new-thread-dialog.tsx)을 연다(그 화면 S10).
import { loadCausticFonts, MockRoot, ShellStateProvider } from "../_shell";
import "./mockup.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { NewThreadDialog, recentWorkspaces } from "./new-thread-dialog";
import { QuietPage } from "./quiet-page";

loadCausticFonts();

const STATES = [
  { id: "S1", label: "S1 최근 폴더" },
  { id: "S2", label: "S2 최근 없음(첫 실행)" },
  { id: "S3", label: "S3 상대 경로" },
  { id: "S4", label: "S4 호스트 거절" },
  { id: "S5", label: "S5 만드는 중" },
] as const;
type StateId = (typeof STATES)[number]["id"];

function Page({ state }: { state: StateId }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <QuietPage onNew={() => setOpen(true)} modalOpen={open} />
      <NewThreadDialog
        open={open}
        onOpenChange={setOpen}
        recent={state === "S2" ? [] : recentWorkspaces}
        {...(state === "S2" ? { initialPath: "" } : {})}
        {...(state === "S3" ? { initialPath: "code/xeon" } : {})}
        {...(state === "S4" ? { initialPath: "/Users/mina/code/xeon-old" } : {})}
        rejected={state === "S4"}
        creating={state === "S5"}
      />
    </>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider>
            <Page state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
