// 목업 로컬 상태: 맥락, 고른 노드, 줌·이동, 재생 위치, 비교, 보기(캔버스·목록), 특수 상태(안전 모드, 오프라인, 빈, 밀집).
// ?state=가 처음 값을 정한다. 엔진·wire를 부르지 않는다.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const STATES = [
  { id: "S1", label: "S1 기본 · 맥락 전체" },
  { id: "S2", label: "S2 대화 맥락 · 실시간" },
  { id: "S3", label: "S3 검사기 · helm" },
  { id: "S4", label: "S4 프로필 맥락" },
  { id: "S5", label: "S5 비교 · 대화 ↔ 프로필" },
  { id: "S6", label: "S6 재생 · 턴 중간" },
  { id: "S7", label: "S7 실패 강조 · review" },
  { id: "S8", label: "S8 안전 모드" },
  { id: "S9", label: "S9 빈 · 내장만" },
  { id: "S10", label: "S10 오프라인" },
  { id: "S11", label: "S11 밀집 · 축소" },
  { id: "S12", label: "S12 테스트 맥락" },
  { id: "S13", label: "S13 목록 보기" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export type Mode = "normal" | "safe" | "empty" | "offline" | "dense";

export interface View {
  x: number;
  y: number;
  k: number;
}

interface Init {
  ctx: string;
  compare: string | null;
  selected: string | null;
  replay: number | null;
  mode: Mode;
  view: "canvas" | "list";
  zoom: View;
  inspectorOpen: boolean;
}

const FIT: View = { x: -60, y: 8, k: 0.78 };

function initOf(s: StateId): Init {
  const base: Init = {
    ctx: "all",
    compare: null,
    selected: null,
    replay: null,
    mode: "normal",
    view: "canvas",
    zoom: FIT,
    inspectorOpen: false,
  };
  switch (s) {
    case "S2":
      return { ...base, ctx: "t1" };
    case "S3":
      return {
        ...base,
        ctx: "t1",
        selected: "helm",
        inspectorOpen: true,
        zoom: { x: -2, y: 8, k: 0.9 },
      };
    case "S4":
      return { ...base, ctx: "p:explore" };
    case "S5":
      return { ...base, ctx: "t1", compare: "p:quiet" };
    case "S6":
      return { ...base, ctx: "t1", replay: 9 };
    case "S7":
      return {
        ...base,
        ctx: "t1",
        selected: "review",
        inspectorOpen: true,
        zoom: { x: -150, y: 8, k: 0.9 },
      };
    case "S8":
      return { ...base, mode: "safe" };
    case "S9":
      return { ...base, mode: "empty" };
    case "S10":
      return { ...base, ctx: "t1", mode: "offline" };
    case "S11":
      return { ...base, mode: "dense", zoom: { x: 36, y: 30, k: 0.5 } };
    case "S12":
      return { ...base, ctx: "x:lens5" };
    case "S13":
      return { ...base, ctx: "t1", view: "list" };
    default:
      return base;
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

export const FIT_VIEW = FIT;

export function MockProvider({
  state,
  children,
  onSelect,
}: {
  state: StateId;
  children: ReactNode;
  /** 고르면 셸 well(검사 탭)을 연다. */
  onSelect?: (id: string | null) => void;
}) {
  const [v, setV] = useState<Init>(() => initOf(state));
  const [notice, setNotice] = useState<string | null>(null);
  const set = useCallback((p: Partial<Init>) => setV((o) => ({ ...o, ...p })), []);
  const select = useCallback(
    (id: string | null) => {
      setV((o) => ({ ...o, selected: id, inspectorOpen: id !== null }));
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

export const initialFor = initOf;
