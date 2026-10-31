// 목업 로컬 상태: 화면(지도·구성), 지도 줌 단계, 고른 블록, 맥락, 둘러보기 단계, 구성 보기. ?state=가 처음 값을 정한다.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const STATES = [
  { id: "overview", label: "지도 · 개요" },
  { id: "layer", label: "지도 · 층" },
  { id: "detail", label: "지도 · 상세 + 검사" },
  { id: "tour-1", label: "구조 살펴보기 1/5" },
  { id: "tour-3", label: "구조 살펴보기 3/5" },
  { id: "hull", label: "대화 맥락 · 실시간 임대" },
  { id: "diff", label: "프로필 ↔ 대화 차이" },
  { id: "matrix", label: "층 × 지점 표" },
  { id: "failure", label: "실패" },
  { id: "compose", label: "구성 · Helm 부품" },
  { id: "flow", label: "구성 · Helm 흐름" },
  { id: "trial", label: "구성 · 시험 실행" },
  { id: "profile", label: "구성 · 프로필 쌓기" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export type Screen = "map" | "compose";
export type Zoom = "overview" | "layer" | "detail";
export type MapView = "canvas" | "matrix";
export type ComposeView = "parts" | "flow" | "profile";

export interface Init {
  screen: Screen;
  zoom: Zoom;
  mapView: MapView;
  composeView: ComposeView;
  ctx: string;
  selected: string | null;
  tour: number | null;
  diff: boolean;
  trial: boolean;
  failure: boolean;
}

export function initOf(s: StateId): Init {
  const b: Init = {
    screen: "map",
    zoom: "overview",
    mapView: "canvas",
    composeView: "parts",
    ctx: "all",
    selected: null,
    tour: null,
    diff: false,
    trial: false,
    failure: false,
  };
  switch (s) {
    case "layer":
      return { ...b, zoom: "layer" };
    case "detail":
      return { ...b, zoom: "detail", selected: "helm", ctx: "t1" };
    case "tour-1":
      return { ...b, tour: 0 };
    case "tour-3":
      return { ...b, zoom: "layer", tour: 2 };
    case "hull":
      return { ...b, zoom: "layer", ctx: "t1" };
    case "diff":
      return { ...b, zoom: "layer", ctx: "t1", diff: true };
    case "matrix":
      return { ...b, mapView: "matrix", zoom: "layer" };
    case "failure":
      return { ...b, zoom: "layer", failure: true, selected: "review" };
    case "compose":
      return { ...b, screen: "compose", composeView: "parts", ctx: "t1" };
    case "flow":
      return { ...b, screen: "compose", composeView: "flow", ctx: "t1" };
    case "trial":
      return { ...b, screen: "compose", composeView: "flow", ctx: "x:lens5", trial: true };
    case "profile":
      return { ...b, screen: "compose", composeView: "profile", ctx: "p:explore" };
    default:
      return b;
  }
}

interface Mock extends Init {
  set: (p: Partial<Init>) => void;
  select: (id: string | null) => void;
  notice: string | null;
  notify: (t: string) => void;
}

const Ctx = createContext<Mock | null>(null);
export const useMock = () => {
  const m = useContext(Ctx);
  if (m === null) throw new Error("MockProvider 밖");
  return m;
};

export function MockProvider({
  state,
  children,
  onSelect,
}: {
  state: StateId;
  children: ReactNode;
  onSelect?: (id: string | null) => void;
}) {
  const [v, setV] = useState<Init>(() => initOf(state));
  const [notice, setNotice] = useState<string | null>(null);
  const set = useCallback((p: Partial<Init>) => setV((o) => ({ ...o, ...p })), []);
  const select = useCallback(
    (id: string | null) => {
      setV((o) => ({ ...o, selected: id }));
      onSelect?.(id);
    },
    [onSelect],
  );
  const notify = useCallback((t: string) => {
    setNotice(t);
    window.setTimeout(() => setNotice(null), 2200);
  }, []);
  const value = useMemo<Mock>(
    () => ({ ...v, set, select, notice, notify }),
    [v, set, select, notice, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
