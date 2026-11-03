// 목업 로컬 상태: 지금 크래프트 화면, 대화 맥락, 화면별 고른 값. 엔진·wire를 부르지 않는다.
// ?state=S1..S14가 처음 값을 정한다(스펙 §14.6의 S12~S15는 여기 S1·S5·S8·S12, NOTES 표).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { profiles as baseProfiles, type Profile } from "./fixtures";

export const STATES = [
  { id: "S1", label: "S1 W6 replay 실패 상세" },
  { id: "S2", label: "S2 W6 새 테스트(O-12)" },
  { id: "S3", label: "S3 W6 bench · 시작 실패" },
  { id: "S4", label: "S4 W6 빈" },
  { id: "S5", label: "S5 W7 기본" },
  { id: "S6", label: "S6 W7 대화 하나 · 1일" },
  { id: "S7", label: "S7 W7 계측 꺼짐" },
  { id: "S8", label: "S8 W8 프로필 편집" },
  { id: "S9", label: "S9 W8 적용 실패" },
  { id: "S10", label: "S10 W8 그룹 구성" },
  { id: "S11", label: "S11 W9 종류" },
  { id: "S12", label: "S12 W9 이름 오류" },
  { id: "S13", label: "S13 W9 확인" },
  { id: "S14", label: "S14 W9 결과" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

/** 크래프트 내비 id(§4.9.3). 이 시안이 그리는 것은 trials·metrics·compose·create 넷. */
export type Screen =
  | "overview"
  | "extensions"
  | "tests"
  | "metrics"
  | "compose"
  | "create"
  | "engine";
export type Period = "1d" | "7d" | "30d";
export type CreateStep = 0 | 1 | 2 | 3;

interface Init {
  screen: Screen;
  context: "all" | "cache";
  selectedTest: string | null;
  newTrialOpen: boolean;
  startError: boolean;
  emptyTests: boolean;
  period: Period;
  instrumentationOff: boolean;
  composeTab: "profiles" | "group";
  applyFailed: boolean;
  createStep: CreateStep;
  name: string;
}

function initOf(s: StateId): Init {
  const base: Init = {
    screen: "tests",
    context: "cache",
    selectedTest: "t3",
    newTrialOpen: false,
    startError: false,
    emptyTests: false,
    period: "7d",
    instrumentationOff: false,
    composeTab: "profiles",
    applyFailed: false,
    createStep: 0,
    name: "lens-review",
  };
  switch (s) {
    case "S1":
      return base;
    case "S2":
      return { ...base, newTrialOpen: true };
    case "S3":
      return { ...base, selectedTest: "t2", startError: true };
    case "S4":
      return { ...base, emptyTests: true, selectedTest: null };
    case "S5":
      return { ...base, screen: "metrics", context: "all" };
    case "S6":
      return { ...base, screen: "metrics", period: "1d" };
    case "S7":
      return { ...base, screen: "metrics", context: "all", instrumentationOff: true };
    case "S8":
      return { ...base, screen: "compose" };
    case "S9":
      return { ...base, screen: "compose", applyFailed: true };
    case "S10":
      return { ...base, screen: "compose", composeTab: "group" };
    case "S11":
      return { ...base, screen: "create" };
    case "S12":
      return { ...base, screen: "create", createStep: 1, name: "Lens_Review" };
    case "S13":
      return { ...base, screen: "create", createStep: 2 };
    case "S14":
      return { ...base, screen: "create", createStep: 3 };
  }
}

/** 셸의 처음 크래프트 대화 맥락(t1 = 캐시 무효화 조사, null = 전체). 셸 상태가 정본이고 store는 처음 값만 준다. */
export const initialContextOf = (s: StateId): string | null =>
  initOf(s).context === "cache" ? "t1" : null;

export interface Mock extends Init {
  state: StateId;
  set: (patch: Partial<Init>) => void;
  profiles: Profile[];
  setProfiles: (p: Profile[]) => void;
  /** 화면 아래 한 줄 알림(토스트 대신. 목업은 셸 토스트가 없다). */
  notice: string | null;
  notify: (text: string) => void;
}

const Ctx = createContext<Mock | null>(null);
export function useMock(): Mock {
  const v = useContext(Ctx);
  if (v === null) throw new Error("MockProvider 밖");
  return v;
}

export function MockProvider({ state, children }: { state: StateId; children: ReactNode }) {
  const [init, setInit] = useState(() => initOf(state));
  const [profiles, setProfiles] = useState(baseProfiles);
  const [notice, setNotice] = useState<string | null>(null);
  const set = useCallback((patch: Partial<Init>) => setInit((p) => ({ ...p, ...patch })), []);
  const notify = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 2400);
  }, []);
  const value = useMemo<Mock>(
    () => ({ ...init, state, set, profiles, setProfiles, notice, notify }),
    [init, state, set, profiles, notice, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
