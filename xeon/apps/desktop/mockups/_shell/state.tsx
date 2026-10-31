// 셸 상태: 창 폭 단계, 영역(대화·작업대, §4.9), 왼쪽 패널, 오른쪽 well(열림·탭, 영역마다 따로), 팔레트,
// 작업대 대화 맥락(workbench.contextThreadId, §4.9.5). 페이지 상태는 각 목업이 따로 갖는다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** 창 폭 단계. caustic 중단점과 같은 경계(1100, 720). */
export type Layout = "wide" | "medium" | "compact";
const layoutOf = (w: number): Layout => (w <= 720 ? "compact" : w <= 1100 ? "medium" : "wide");

function useWindowLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() => layoutOf(window.innerWidth));
  useEffect(() => {
    const update = () => setLayout(layoutOf(window.innerWidth));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return layout;
}

/** 두 1급 영역(§4.9.1). 왼쪽 패널 머리의 SegmentedControl로 바꾼다(DP-18). */
export type Area = "chat" | "workbench";

export interface ShellState {
  layout: Layout;
  /** 지금 영역. */
  area: Area;
  setArea: (area: Area) => void;
  /** 작업대 화면이 볼 대화(thread id). null이면 "전체"(§4.9.3 대화 맥락 칸). */
  contextThreadId: string | null;
  setContextThreadId: (id: string | null) => void;
  startOpen: boolean;
  setStartOpen: (open: boolean) => void;
  endOpen: boolean;
  setEndOpen: (open: boolean) => void;
  /** 오른쪽 well의 지금 탭 id(Shell의 rightTabs 중 하나). 영역마다 따로 기억한다(§4.9.2). */
  endTab: string;
  /** 탭을 열고 well을 편다. inArea를 주면 그 영역의 탭으로 기억한다(영역을 같이 바꿀 때). */
  openEnd: (tab: string, inArea?: Area) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const s = useContext(ShellContext);
  if (s === null) throw new Error("ShellStateProvider 밖에서 useShell을 불렀어요");
  return s;
}

export interface ShellStateProviderProps {
  /** 처음 열린 오른쪽 탭(기본 "inbox"). */
  initialTab?: string;
  /** 처음부터 팔레트를 연다(팔레트 상태 화면). */
  initialPaletteOpen?: boolean;
  /** 처음 영역(기본 "chat"). */
  initialArea?: Area;
  /** 처음 작업대 탭(기본 "inbox"). */
  initialWorkbenchTab?: string;
  /** 처음 오른쪽 well 열림. 없으면 폭 단계 기본값(넓으면 열림). */
  initialEndOpen?: boolean;
  /** 처음 작업대 대화 맥락(기본 t1 "캐시 무효화 조사"). */
  initialContextThreadId?: string | null;
  children: ReactNode;
}

export function ShellStateProvider({
  initialTab = "inbox",
  initialPaletteOpen = false,
  initialArea = "chat",
  initialWorkbenchTab = "inbox",
  initialEndOpen,
  initialContextThreadId = "t1",
  children,
}: ShellStateProviderProps) {
  const layout = useWindowLayout();
  const [area, setAreaRaw] = useState<Area>(initialArea);
  const [contextThreadId, setContextThreadId] = useState<string | null>(initialContextThreadId);
  const [startOpen, setStartOpen] = useState(layout !== "compact");
  const [endOpen, setEndOpen] = useState(layout === "wide" ? (initialEndOpen ?? true) : false);
  // 영역마다 마지막 오른쪽 탭을 기억한다(§4.9.2).
  const [endTabs, setEndTabs] = useState<Record<Area, string>>({
    chat: initialTab,
    workbench: initialWorkbenchTab,
  });
  const endTab = endTabs[area];
  const [paletteOpen, setPaletteOpen] = useState(initialPaletteOpen);
  const setArea = useCallback((a: Area) => setAreaRaw(a), []);

  // 폭 단계가 바뀌면 그 단계의 기본값으로: 넓으면 둘 다 붙박이, 중간이면 well은 닫힘(뜨는 면), 좁으면 둘 다 뜨는 면.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setStartOpen(layout !== "compact");
    setEndOpen(layout === "wide");
  }, [layout]);

  const openEnd = useCallback(
    (tab: string, inArea?: Area) => {
      setEndTabs((t) => ({ ...t, [inArea ?? area]: tab }));
      setEndOpen(true);
    },
    [area],
  );

  const value = useMemo<ShellState>(
    () => ({
      layout,
      area,
      setArea,
      contextThreadId,
      setContextThreadId,
      startOpen,
      setStartOpen,
      endOpen,
      setEndOpen,
      endTab,
      openEnd,
      paletteOpen,
      setPaletteOpen,
    }),
    [layout, area, setArea, contextThreadId, startOpen, endOpen, endTab, openEnd, paletteOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
