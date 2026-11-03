// S-01·N-01·N-04·테스트 정리 목업 진입점. ?state=<id>(기본 chat), ?scenario=<id>, ?theme=dark, ?dev=1(시나리오 막대와 다음 할 일).
import { loadCausticFonts, MockRoot, ShellStateProvider, type WorkbenchContext } from "../_shell";
import "./mockup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, STATES, type StateId } from "./app";

loadCausticFonts();

function contextFor(s: StateId): WorkbenchContext {
  if (s === "wb-pinned" || s === "wb-closed" || s === "narrow-wb")
    return { kind: "thread", threadId: "t1", pinned: true };
  if (s === "wb-all") return { kind: "all" };
  if (s === "wb-profile") return { kind: "profile", profileId: "explore" };
  if (s === "wb-trial") return { kind: "trial", threadId: "t8" };
  if (s === "cleanup-context") return { kind: "trial", threadId: "t9" };
  return { kind: "thread", threadId: "t1", pinned: false };
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={STATES}>
        {(state) => (
          <ShellStateProvider
            key={state}
            initialArea={state.startsWith("wb-") || state === "narrow-wb" ? "workbench" : "chat"}
            initialTab="runtime"
            initialEndOpen={state === "chat"}
            initialContext={contextFor(state)}
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
