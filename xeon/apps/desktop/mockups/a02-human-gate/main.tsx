// N-05~N-07 사람 확인·승인 출처·진행권 충돌 목업 진입점. ?state=<id>(기본 asking), ?scenario=<id>[&step=n], ?theme=dark, ?dev=1(시나리오 막대).
// 상태와 시나리오는 flow.ts의 한 상태 기계다: 상태 = 대본의 앞 n개 동작을 바로 적용한 모습.
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
        {(state) => (
          <ShellStateProvider
            key={state}
            initialTab={
              state === "other-inbox" ? "inbox" : state === "helm-well" ? "helm/panel" : "runtime"
            }
            initialEndOpen={
              !state.startsWith("child") && state !== "approval-expired" && state !== "other-thread"
            }
          >
            <App state={state} />
          </ShellStateProvider>
        )}
      </MockRoot>
    </StrictMode>,
  );
