// 시안 상태: ?state= 마다 처음 화면을 정하고, 이후는 로컬 상태로 고른다.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { StageId } from "./data";

export type Screen = "overview" | "layers" | "detail" | "matrix" | "diff";
export type Overlay = null | "add-l1" | "explain";

export interface MockState {
  screen: Screen;
  /** 보는 대상(맥락) 값 */
  view: string;
  /** 포커스(관계 렌즈)할 플러그인 */
  focus: string | null;
  stage: StageId | null;
  detail: string;
  overlay: Overlay;
  /** 프리셋 적용 미리보기(보는 것 ≠ 바꾸는 것) */
  preview: string | null;
  failure: boolean;
}

export const STATES = [
  { id: "overview", label: "개요 · 턴 흐름 그림" },
  { id: "layers", label: "층 · 내장과 내 것, 더하기" },
  { id: "add-l1", label: "에이전트 핵심(L1)에 더하기 · 시작" },
  { id: "focus", label: "포커스 · Helm 관계 렌즈" },
  { id: "detail", label: "상세 · Helm 구성과 흐름" },
  { id: "detail-router", label: "상세 · 비용 라우터(내 L1)" },
  { id: "explain", label: "보는 대상 설명(처음)" },
  { id: "thread", label: "대화 · 실시간" },
  { id: "preset-preview", label: "프리셋 적용 미리보기" },
  { id: "preset-diff", label: "프리셋 ↔ 대화 차이" },
  { id: "matrix", label: "층 × 지점 표" },
  { id: "failure", label: "실패" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const base: MockState = {
  screen: "overview",
  view: "all",
  focus: null,
  stage: "tool",
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
      return { ...base, screen: "layers", stage: null };
    case "add-l1":
      return { ...base, screen: "layers", stage: null, overlay: "add-l1" };
    case "focus":
      return { ...base, screen: "layers", stage: null, focus: "helm" };
    case "detail":
      return { ...base, screen: "detail", detail: "helm" };
    case "detail-router":
      return { ...base, screen: "detail", detail: "cost-router" };
    case "explain":
      return { ...base, screen: "layers", stage: null, overlay: "explain" };
    case "thread":
      return { ...base, screen: "layers", stage: null, view: "t1" };
    case "preset-preview":
      return { ...base, screen: "layers", stage: null, view: "t1", preview: "p-explore" };
    case "preset-diff":
      return { ...base, screen: "diff", view: "t1", preview: "p-explore" };
    case "matrix":
      return { ...base, screen: "matrix" };
    case "failure":
      return { ...base, screen: "layers", stage: null, failure: true };
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
