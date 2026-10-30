// 설정 묶음 목업 진입 도우미: 글꼴(맨 먼저, DP-15) → MockRoot(?state, ?theme) → ShellStateProvider → 페이지.
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { loadCausticFonts, MockRoot, ShellStateProvider, type MockStateDef } from "../_shell";

export function mountSettingsPage<S extends string>(
  states: readonly MockStateDef<S>[],
  render: (state: S) => ReactNode,
) {
  loadCausticFonts();
  const root = document.getElementById("root");
  if (root === null) return;
  createRoot(root).render(
    <StrictMode>
      <MockRoot states={states}>
        {(state) => <ShellStateProvider>{render(state)}</ShellStateProvider>}
      </MockRoot>
    </StrictMode>,
  );
}

/** ?tab= 값(옆 시안에서 탭을 눌러 왔을 때). */
export function initialTabParam(): string | null {
  return new URLSearchParams(window.location.search).get("tab");
}
