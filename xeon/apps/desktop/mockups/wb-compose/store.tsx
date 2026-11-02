// 목업 로컬 상태: 보기(그룹·흐름·프로필·코드), 고른 그룹, 고른 블록, 테스트 실행, 포트 연결 중. 엔진·wire를 부르지 않는다.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const STATES = [
  { id: "S1", label: "S1 Helm 구성" },
  { id: "S2", label: "S2 빈 구성기" },
  { id: "S3", label: "S3 검사 실패" },
  { id: "S4", label: "S4 흐름(Helm)" },
  { id: "S5", label: "S5 흐름 편집 · 포트 연결" },
  { id: "S6", label: "S6 테스트 실행" },
  { id: "S7", label: "S7 프로필 쌓기" },
  { id: "S8", label: "S8 코드 보기" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export type View = "group" | "flow" | "profile" | "code";
export type GroupId = "helm" | "lens-review" | "new";

interface Init {
  view: View;
  group: GroupId;
  selected: string | null;
  trial: boolean;
  draft: boolean;
  gateAdded: boolean;
  nav: "compose" | "create";
  well: "palette" | "inspect" | null;
  closeStart: boolean;
}

function initOf(s: StateId): Init {
  const base: Init = {
    view: "group",
    group: "helm",
    selected: "drive",
    trial: false,
    draft: false,
    gateAdded: false,
    nav: "compose",
    well: null,
    closeStart: false,
  };
  switch (s) {
    case "S1":
      return base;
    case "S2":
      return { ...base, group: "new", selected: null, nav: "create", well: "palette" };
    case "S3":
      return { ...base, group: "lens-review", selected: "drive2", nav: "create" };
    case "S4":
      return { ...base, view: "flow", selected: "explore" };
    case "S5":
      return {
        ...base,
        view: "flow",
        group: "lens-review",
        selected: "gate",
        draft: true,
        gateAdded: true,
        nav: "create",
        well: "palette",
        closeStart: true,
      };
    case "S6":
      return { ...base, view: "flow", selected: null, trial: true };
    case "S7":
      return { ...base, view: "profile", selected: null };
    case "S8":
      return { ...base, view: "code", group: "lens-review", selected: "drive", nav: "create" };
  }
}

interface Mock extends Init {
  state: StateId;
  set: (p: Partial<Init>) => void;
  notice: string | null;
  notify: (text: string) => void;
}

const Ctx = createContext<Mock | null>(null);

export function MockProvider({ state, children }: { state: StateId; children: ReactNode }) {
  const [v, setV] = useState<Init>(() => initOf(state));
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const set = useCallback((p: Partial<Init>) => setV((o) => ({ ...o, ...p })), []);
  const notify = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 2400);
  }, []);
  const value = useMemo<Mock>(
    () => ({ ...v, state, set, notice, notify }),
    [v, state, set, notice, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMock(): Mock {
  const m = useContext(Ctx);
  if (m === null) throw new Error("MockProvider 밖");
  return m;
}
