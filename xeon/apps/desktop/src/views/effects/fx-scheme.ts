// 이펙트가 따를 테마. 앱 설정(`<html data-theme>`)과 운영체제 설정을 함께 듣는다.
// border-beam의 theme="auto"는 운영체제 설정만 읽어 앱에서 라이트를 고른 다크 Mac에서 어긋난다. 그래서 여기서 정해 넘긴다.

import { useSyncExternalStore } from "react";
import { schemeOf, type FxScheme } from "./fx-config.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function osDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_QUERY).matches
  );
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const media =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DARK_QUERY)
      : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer?.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

function current(): FxScheme {
  if (typeof document === "undefined") return "dark";
  return schemeOf(document.documentElement, osDark());
}

/** 지금 테마. 바뀌면 다시 그린다 */
export function useFxScheme(): FxScheme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}
