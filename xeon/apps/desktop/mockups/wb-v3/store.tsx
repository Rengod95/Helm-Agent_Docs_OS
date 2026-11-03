// 시안 상태: ?state= 마다 처음 화면을 정하고, 이후는 로컬 상태로 고른다.
// 구조 화면은 층 × 단계 표 하나다(지도·그림 보기는 쓰지 않음). 옛 상태 id는 그대로 두고 모두 표로 연다.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { LayerId, StageId } from "./data";

export type Screen = "structure" | "detail" | "diff";
export type Overlay = null | "add-l1" | "explain";

/** 표에서 고른 것: 칸(row+col), 층 행(row만), 단계 열(col만), 없음. */
export interface Pick {
  row?: LayerId | undefined;
  col?: StageId | undefined;
}

export interface MockState {
  screen: Screen;
  /** 보기 기준(맥락) 값 */
  view: string;
  /** 포커스 렌즈할 플러그인 */
  focus: string | null;
  pick: Pick;
  detail: string;
  overlay: Overlay;
  /** 프로필 적용 미리보기(보는 것 ≠ 바꾸는 것) */
  preview: string | null;
  failure: boolean;
}

export const STATES = [
  { id: "overview", label: "개요 · 도구 단계 고름" },
  { id: "layers", label: "개요 · 기능 층 고름" },
  { id: "add-l1", label: "에이전트 코어(L1)에 더하기 · 시작" },
  { id: "focus", label: "포커스 · Helm 관계" },
  { id: "detail", label: "상세 · Helm 구성과 흐름" },
  { id: "detail-router", label: "상세 · 비용 라우터(내 L1)" },
  { id: "explain", label: "보기 기준 설명(처음)" },
  { id: "thread", label: "개요 · 대화 실시간" },
  { id: "preset-preview", label: "프로필 적용 미리보기" },
  { id: "preset-diff", label: "프로필 ↔ 대화 차이" },
  { id: "matrix", label: "개요 · 고른 것 없음" },
  { id: "failure", label: "실패" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const base: MockState = {
  screen: "structure",
  view: "all",
  focus: null,
  pick: { col: "tool" },
  detail: "helm",
  overlay: null,
  preview: null,
  failure: false,
};

export function initialFor(id: StateId): MockState {
  switch (id) {
    case "overview":
      return base;
    case "layers":
      return { ...base, pick: { row: "L2" } };
    case "add-l1":
      return { ...base, pick: { row: "L1" }, overlay: "add-l1" };
    case "focus":
      return { ...base, pick: {}, focus: "helm" };
    case "detail":
      return { ...base, screen: "detail", detail: "helm" };
    case "detail-router":
      return { ...base, screen: "detail", detail: "cost-router" };
    case "explain":
      return { ...base, pick: {}, overlay: "explain" };
    case "thread":
      return { ...base, view: "t1" };
    case "preset-preview":
      return { ...base, pick: {}, view: "t1", preview: "p-explore" };
    case "preset-diff":
      return { ...base, screen: "diff", view: "t1", preview: "p-explore" };
    case "matrix":
      return { ...base, pick: {} };
    case "failure":
      return { ...base, pick: { row: "L3", col: "boundary" }, failure: true };
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
