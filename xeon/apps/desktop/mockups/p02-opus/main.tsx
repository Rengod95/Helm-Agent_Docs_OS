import "@caustic/tokens/fonts.css";
// P-02 대화 셸 목업 진입점. ?state=S1..S7 로 화면 상태, ?theme=light|dark 로 테마를 고른다(기본 S1, 라이트).
import "./mockup.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { DevSwitcher, type Theme } from "./dev-switcher";
import { isStateId, MockProvider, type StateId } from "./store";

function readParams(): { state: StateId; theme: Theme } {
  const p = new URLSearchParams(window.location.search);
  const s = p.get("state");
  return { state: isStateId(s) ? s : "S1", theme: p.get("theme") === "dark" ? "dark" : "light" };
}

function Root() {
  const [{ state, theme }, setParams] = useState(readParams);
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    const url = new URL(window.location.href);
    url.searchParams.set("state", state);
    if (theme === "dark") url.searchParams.set("theme", "dark");
    else url.searchParams.delete("theme");
    window.history.replaceState(null, "", url);
  }, [state, theme]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-app">
      {/* 상태를 바꾸면 로컬 상태를 처음부터 다시 만든다 */}
      <MockProvider key={state} state={state}>
        <App />
      </MockProvider>
      <DevSwitcher
        state={state}
        theme={theme}
        onState={(s) => setParams((p) => ({ ...p, state: s }))}
        onTheme={(t) => setParams((p) => ({ ...p, theme: t }))}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
