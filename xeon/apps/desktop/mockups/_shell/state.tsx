// 셸 상태: 창 폭 단계, 영역(대화·크래프트, §4.9), 왼쪽 패널, 오른쪽 well(열림·탭, 영역마다 따로), 팔레트,
// 크래프트 보기 기준(workbench.context, §4.9.3·§4.9.5: 전체·대화·프로필·테스트, 대화는 따라감/고정). 페이지 상태는 각 목업이 따로 갖는다.
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

/** 크래프트 보기 기준(§4.9.5 [제안] workbench.context). 대화 기준은 pinned가 거짓이면 대화 영역에서 연 대화를 따라간다(결정 11). */
export type WorkbenchContext =
  | { kind: "all" }
  | { kind: "thread"; threadId: string; pinned: boolean }
  | { kind: "profile"; profileId: string }
  | { kind: "trial"; threadId: string };

/** 두 1급 영역(§4.9.1). 왼쪽 패널 머리의 SegmentedControl로 바꾼다(DP-18). */
export type Area = "chat" | "workbench";

export interface ShellState {
  layout: Layout;
  /** 지금 영역. */
  area: Area;
  setArea: (area: Area) => void;
  /** 크래프트 보기 기준(왼쪽 패널 칸 하나가 모든 크래프트 화면을 정한다, §4.9.3). */
  context: WorkbenchContext;
  setContext: (c: WorkbenchContext) => void;
  /** 대화 영역에서 대화를 열 때 부른다: 기준이 따라가는 대화면 그 대화로 바뀐다. 고정이면 그대로. */
  followThread: (threadId: string) => void;
  /** "크래프트에서 보기": 그 대화로 고정(pin)하고 크래프트로 간다. */
  pinThread: (threadId: string) => void;
  /** 옛 호환: 기준이 대화나 테스트이면 그 대화 id, 아니면 null("전체"·프로필). */
  contextThreadId: string | null;
  /** 옛 호환: null이면 전체, 아니면 따라가는 대화 기준. */
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
  /** 처음 크래프트 탭(기본 "inbox"). */
  initialWorkbenchTab?: string;
  /** 처음 오른쪽 well 열림. 없으면 폭 단계 기본값(넓으면 열림). */
  initialEndOpen?: boolean;
  /** 처음 크래프트 대화 맥락(기본 t1 "캐시 무효화 조사", 따라감). null이면 전체. initialContext가 있으면 그것을 쓴다. */
  initialContextThreadId?: string | null;
  /** 처음 보기 기준(프로필·테스트·고정 대화 등). */
  initialContext?: WorkbenchContext;
  children: ReactNode;
}

export function ShellStateProvider({
  initialTab = "inbox",
  initialPaletteOpen = false,
  initialArea = "chat",
  initialWorkbenchTab = "inbox",
  initialEndOpen,
  initialContextThreadId = "t1",
  initialContext,
  children,
}: ShellStateProviderProps) {
  const layout = useWindowLayout();
  const [area, setAreaRaw] = useState<Area>(initialArea);
  const [context, setContext] = useState<WorkbenchContext>(
    initialContext ??
      (initialContextThreadId === null
        ? { kind: "all" }
        : { kind: "thread", threadId: initialContextThreadId, pinned: false }),
  );
  const followThread = useCallback(
    (threadId: string) =>
      setContext((c) => (c.kind === "thread" && !c.pinned ? { ...c, threadId } : c)),
    [],
  );
  const pinThread = useCallback((threadId: string) => {
    setContext({ kind: "thread", threadId, pinned: true });
    setAreaRaw("workbench");
  }, []);
  const contextThreadId =
    context.kind === "thread" || context.kind === "trial" ? context.threadId : null;
  const setContextThreadId = useCallback(
    (id: string | null) =>
      setContext(id === null ? { kind: "all" } : { kind: "thread", threadId: id, pinned: false }),
    [],
  );
  const [startOpen, setStartOpen] = useState(layout !== "compact");
  const [endOpen, setEndOpen] = useState(layout === "wide" ? (initialEndOpen ?? false) : false);
  // 영역마다 마지막 오른쪽 탭을 기억한다(§4.9.2).
  const [endTabs, setEndTabs] = useState<Record<Area, string>>({
    chat: initialTab,
    workbench: initialWorkbenchTab,
  });
  const endTab = endTabs[area];
  const [paletteOpen, setPaletteOpen] = useState(initialPaletteOpen);
  const setArea = useCallback((a: Area) => setAreaRaw(a), []);

  // 폭 단계가 바뀌면 그 단계의 기본값으로: 왼쪽은 넓으면 붙박이, 좁으면 뜨는 면. 오른쪽 well은 항상 뜨는 면이라 폭이 바뀌면 닫는다.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setStartOpen(layout !== "compact");
    setEndOpen(false);
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
      context,
      setContext,
      followThread,
      pinThread,
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
    [
      layout,
      area,
      setArea,
      context,
      followThread,
      pinThread,
      contextThreadId,
      setContextThreadId,
      startOpen,
      endOpen,
      endTab,
      openEnd,
      paletteOpen,
    ],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
