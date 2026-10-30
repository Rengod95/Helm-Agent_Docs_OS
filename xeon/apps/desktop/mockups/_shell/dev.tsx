// 목업 전용: 화면 상태와 테마를 바꾸는 개발용 띠(창 위쪽, 앱 화면 밖)와 그 상태를 URL과 맞추는 뿌리.
// URL ?state=<id>&theme=light|dark. 상태를 바꾸면 페이지 상태를 처음부터 다시 만든다(key).
import { Select, SelectOption } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export interface MockStateDef<S extends string> {
  id: S;
  label: string;
}

function DevSwitcher<S extends string>({
  states,
  state,
  theme,
  onState,
  onTheme,
}: {
  states: readonly MockStateDef<S>[];
  state: S;
  theme: Theme;
  onState: (s: S) => void;
  onTheme: (t: Theme) => void;
}) {
  return (
    <div
      role="region"
      aria-label="목업 전용 상태 전환"
      className="order-first flex h-9 flex-none items-center justify-end gap-2 border-b border-border-subtle bg-bg-inset px-3 text-ui-xs text-text-tertiary"
    >
      <span className="mr-auto">목업 전용 · 실제 앱에는 없어요</span>
      {states.length > 1 && (
        <Select
          size="xs"
          aria-label="화면 상태"
          value={state}
          onValueChange={(v) => onState(v as S)}
          className="w-40"
        >
          {states.map((s) => (
            <SelectOption key={s.id} value={s.id}>
              {s.label}
            </SelectOption>
          ))}
        </Select>
      )}
      <Select
        size="xs"
        aria-label="테마"
        value={theme}
        onValueChange={(v) => onTheme(v as Theme)}
        className="w-24"
      >
        <SelectOption value="light">라이트</SelectOption>
        <SelectOption value="dark">다크</SelectOption>
      </Select>
    </div>
  );
}

/** 목업 뿌리: URL 상태·테마를 읽고 data-theme을 걸고, 개발용 띠를 붙인다. children은 지금 상태로 페이지를 그린다. */
export function MockRoot<S extends string>({
  states,
  children,
}: {
  states: readonly MockStateDef<S>[];
  children: (state: S) => ReactNode;
}) {
  const first = states[0];
  if (first === undefined) throw new Error("states가 비어 있어요");
  const read = (): { state: S; theme: Theme } => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("state");
    const found = states.find((x) => x.id === s);
    return {
      state: found ? found.id : first.id,
      theme: p.get("theme") === "dark" ? "dark" : "light",
    };
  };
  const [{ state, theme }, setParams] = useState(read);
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
      <div key={state} className="flex min-h-0 flex-1 flex-col">
        {children(state)}
      </div>
      <DevSwitcher
        states={states}
        state={state}
        theme={theme}
        onState={(s) => setParams((p) => ({ ...p, state: s }))}
        onTheme={(t) => setParams((p) => ({ ...p, theme: t }))}
      />
    </div>
  );
}
