// 셸 상태: 창 폭 단계, 왼쪽 패널, 오른쪽 well(열림·탭), 팔레트. 페이지 상태는 각 목업이 따로 갖는다.
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

export interface ShellState {
  layout: Layout;
  startOpen: boolean;
  setStartOpen: (open: boolean) => void;
  endOpen: boolean;
  setEndOpen: (open: boolean) => void;
  /** 오른쪽 well의 지금 탭 id(Shell의 rightTabs 중 하나). */
  endTab: string;
  openEnd: (tab: string) => void;
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
  children: ReactNode;
}

export function ShellStateProvider({
  initialTab = "inbox",
  initialPaletteOpen = false,
  children,
}: ShellStateProviderProps) {
  const layout = useWindowLayout();
  const [startOpen, setStartOpen] = useState(layout !== "compact");
  const [endOpen, setEndOpen] = useState(layout === "wide");
  const [endTab, setEndTab] = useState(initialTab);
  const [paletteOpen, setPaletteOpen] = useState(initialPaletteOpen);

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

  const openEnd = useCallback((tab: string) => {
    setEndTab(tab);
    setEndOpen(true);
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      layout,
      startOpen,
      setStartOpen,
      endOpen,
      setEndOpen,
      endTab,
      openEnd,
      paletteOpen,
      setPaletteOpen,
    }),
    [layout, startOpen, endOpen, endTab, openEnd, paletteOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
