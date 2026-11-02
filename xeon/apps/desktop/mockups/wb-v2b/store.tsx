// 시안 상태: ?state= 마다 처음 화면을 정하고, 이후는 로컬 상태로 고른다.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Screen = "map" | "group" | "table" | "diff" | "flow" | "empty";
export type MapMode = "normal" | "failure" | "thread";
export type ComposeEdit = null | "drop" | "invalid" | "connect";

export interface MockState {
  screen: Screen;
  ctx: string;
  selected: string | null;
  hover: string | null;
  mapMode: MapMode;
  /** 그룹 하위 캔버스: 런타임에서 열면 읽기 전용, 구성(결정 2·6)에서는 편집. */
  composer: boolean;
  edit: ComposeEdit;
  /** 흐름: 테스트 실행 겹침. */
  trial: boolean;
  wellTab: "inspect" | "library" | "inbox";
  wellOpen: boolean;
}

export const STATES = [
  { id: "S1", label: "S1 지도 · 전체" },
  { id: "S2", label: "S2 선택 · 초점 경로" },
  { id: "S3", label: "S3 올리면 연결" },
  { id: "S4", label: "S4 Helm 열기" },
  { id: "S5", label: "S5 구성 · 놓기 미리보기" },
  { id: "S6", label: "S6 구성 · 잘못된 연결" },
  { id: "S7", label: "S7 대화 프레임 · 주도" },
  { id: "S8", label: "S8 프로필 차이" },
  { id: "S9", label: "S9 층 × 훅 열지도" },
  { id: "S10", label: "S10 Helm 흐름" },
  { id: "S11", label: "S11 테스트 실행" },
  { id: "S12", label: "S12 실패" },
  { id: "S13", label: "S13 빈 · 첫 플러그인" },
  { id: "S14", label: "S14 구성 · 포트 잇기" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const base: MockState = {
  screen: "map",
  ctx: "all",
  selected: null,
  hover: null,
  mapMode: "normal",
  composer: false,
  edit: null,
  trial: false,
  wellTab: "inspect",
  wellOpen: false,
};

export function initialFor(id: StateId): MockState {
  switch (id) {
    case "S1":
      return base;
    case "S2":
      return { ...base, selected: "helm", wellOpen: true };
    case "S3":
      return { ...base, hover: "web" };
    case "S4":
      return { ...base, screen: "group", selected: "helm" };
    case "S5":
      return { ...base, screen: "group", composer: true, edit: "drop" };
    case "S6":
      return { ...base, screen: "group", composer: true, edit: "invalid" };
    case "S7":
      return { ...base, ctx: "t1", mapMode: "thread", selected: "helm" };
    case "S8":
      return { ...base, screen: "diff", ctx: "t1" };
    case "S9":
      return { ...base, screen: "table" };
    case "S10":
      return { ...base, screen: "flow", ctx: "t1" };
    case "S11":
      return { ...base, screen: "flow", ctx: "x-helm5", trial: true };
    case "S12":
      return { ...base, mapMode: "failure", selected: "review", wellOpen: true };
    case "S13":
      return { ...base, screen: "empty" };
    case "S14":
      return { ...base, screen: "flow", composer: true, edit: "connect" };
  }
}

interface Ctx extends MockState {
  set: (p: Partial<MockState>) => void;
  notice: string | null;
  notify: (s: string) => void;
}
const C = createContext<Ctx | null>(null);
export const useMock = () => {
  const c = useContext(C);
  if (c === null) throw new Error("MockProvider 밖");
  return c;
};

export function MockProvider({ state, children }: { state: StateId; children: ReactNode }) {
  const [s, setS] = useState<MockState>(() => initialFor(state));
  const [notice, setNotice] = useState<string | null>(null);
  const value = useMemo<Ctx>(
    () => ({
      ...s,
      set: (p) => setS((o) => ({ ...o, ...p })),
      notice,
      notify: (t) => {
        setNotice(t);
        window.setTimeout(() => setNotice((n) => (n === t ? null : n)), 1800);
      },
    }),
    [s, notice],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
