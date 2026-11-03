// e04 상태 기계(목업 전용): 크래프트 여섯 상태 빈칸(N-47)과 찾기·거르기 결과 없음(N-48).
import type { After } from "../_chat-rt";

export type Screen = "ext" | "detail" | "metrics" | "proposals" | "settings" | "palette";
export type ListMode = "ready" | "loading" | "empty" | "error";
export type TabMode = "ready" | "loading" | "offline" | "empty" | "error";
export type MetricsMode = "ready" | "loading" | "many" | "empty" | "off";

export interface S {
  screen: Screen;
  list: ListMode;
  q: string;
  layer: string;
  tab: string;
  tabMode: TabMode;
  metrics: MetricsMode;
  /** 다시 읽기를 몇 번 했는지(실패 대본). */
  tries: number;
}

export type A =
  | { t: "start" }
  | { t: "q"; q: string }
  | { t: "layer"; v: string }
  | { t: "clear" }
  | { t: "load" }
  | { t: "loaded" }
  | { t: "failed" }
  | { t: "retry" }
  | { t: "tab"; v: string };

export function init(): S {
  return {
    screen: "ext",
    list: "ready",
    q: "",
    layer: "all",
    tab: "points",
    tabMode: "ready",
    metrics: "ready",
    tries: 0,
  };
}

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "q":
      return { ...s, q: a.q };
    case "layer":
      return { ...s, layer: a.v };
    case "clear":
      return { ...s, q: "", layer: "all" };
    case "load":
      return { ...s, list: "loading" };
    case "loaded":
      return { ...s, list: "ready" };
    case "failed":
      return { ...s, list: "error" };
    case "retry":
      return { ...s, list: "loading", tries: s.tries + 1 };
    case "tab":
      return { ...s, tab: a.v };
  }
}

export const SCRIPTS: Record<string, readonly A[]> = {
  base: [],
  "filter-empty": [{ t: "q", q: "lint" }, { t: "layer", v: "L3" }, { t: "clear" }],
  "list-load-fail": [{ t: "load" }, { t: "failed" }, { t: "retry" }, { t: "loaded" }],
};

export function effect(a: A, s: S, after: After<A>): void {
  if (a.t === "load") after(1200, { t: "failed" });
  if (a.t === "retry") after(1000, { t: "loaded" });
  if (a.t === "start" && s.list === "ready" && s.q === "") return;
}
