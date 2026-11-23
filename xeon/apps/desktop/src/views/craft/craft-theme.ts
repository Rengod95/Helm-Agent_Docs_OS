// 크래프트 그림의 테마(어두움·밝음). 앱이 정한 테마(`data-theme`)가 있으면 따르고, 없으면 시스템 설정을 따른다.
// 프로필 캔버스(`canvas/cv6`)가 쓴다. 옛 개요의 지도(`orbit.tsx`)에 있던 것을 옮겼다(AGE-69).
import { useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function schemeNow(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function useCraftTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeScheme, schemeNow, () => "dark");
}
