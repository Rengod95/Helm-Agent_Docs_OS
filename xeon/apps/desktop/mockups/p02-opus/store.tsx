// 목업 로컬 상태. 엔진·wire 없이 화면 상태(S1~S7)와 상호작용만 흉내 낸다.
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
import { threads } from "./fixtures";

export const STATES = [
  { id: "S1", label: "S1 기본" },
  { id: "S2", label: "S2 대화 안 고름" },
  { id: "S3", label: "S3 빈 대화" },
  { id: "S4", label: "S4 다시 연결 중" },
  { id: "S5", label: "S5 잠긴 대화" },
  { id: "S6", label: "S6 질문 카드" },
  { id: "S7", label: "S7 팔레트" },
] as const;
export type StateId = (typeof STATES)[number]["id"];
export const isStateId = (v: string | null): v is StateId => STATES.some((s) => s.id === v);

/** 창 폭 단계. caustic AppShell과 같은 경계(1100, 720)를 쓴다. */
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

export type EndTab = "inbox" | "helm" | "work";
/** 승인 카드 상태. once는 allowed가 되었다가 1초 뒤 gone. */
export type Decision = "pending" | "allowed" | "always" | "denied" | "answered" | "gone";
export type ApprovalId = "a1" | "a2";

interface Mock {
  state: StateId;
  layout: Layout;
  /** 무대에 보이는 것: 대화, 대화 안 고름, 빈 새 대화 */
  view: "thread" | "none" | "empty";
  startOpen: boolean;
  setStartOpen: (open: boolean) => void;
  endOpen: boolean;
  setEndOpen: (open: boolean) => void;
  endTab: EndTab;
  openEnd: (tab: EndTab) => void;
  currentId: string | null;
  currentTitle: string;
  selectThread: (id: string) => void;
  newThread: () => void;
  decisions: Record<ApprovalId, Decision>;
  decide: (id: ApprovalId, d: Exclude<Decision, "gone">) => void;
  answer: { pick: string | null; text: string };
  setAnswer: (a: { pick: string | null; text: string }) => void;
  reconnecting: boolean;
  reconnect: () => void;
  lockedOpen: boolean;
  setLockedOpen: (open: boolean) => void;
  observing: boolean;
  setObserving: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  running: boolean;
  stop: () => void;
  sent: string[];
  send: (text: string) => void;
  pendingApprovals: number;
  composerFocusRef: React.RefObject<HTMLTextAreaElement | null>;
}

const MockContext = createContext<Mock | null>(null);

export function useMock(): Mock {
  const m = useContext(MockContext);
  if (m === null) throw new Error("MockProvider 밖에서 useMock을 불렀어요");
  return m;
}

export function MockProvider({ state, children }: { state: StateId; children: ReactNode }) {
  const layout = useWindowLayout();
  const [view, setView] = useState<Mock["view"]>(
    state === "S2" ? "none" : state === "S3" ? "empty" : "thread",
  );
  const [startOpen, setStartOpen] = useState(layout !== "compact");
  const [endOpen, setEndOpen] = useState(layout === "wide");
  const [endTab, setEndTab] = useState<EndTab>("inbox");
  const [currentId, setCurrentId] = useState<string | null>(
    state === "S2" || state === "S3" ? null : state === "S5" ? "t6" : "t1",
  );
  const [decisions, setDecisions] = useState<Record<ApprovalId, Decision>>({
    a1: "pending",
    a2: "pending",
  });
  const [answer, setAnswer] = useState<Mock["answer"]>({ pick: null, text: "" });
  const [reconnecting, setReconnecting] = useState(state === "S4");
  const [lockedOpen, setLockedOpen] = useState(state === "S5");
  const [observing, setObserving] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(state === "S7");
  const [running, setRunning] = useState(state !== "S3");
  const [sent, setSent] = useState<string[]>([]);
  const composerFocusRef = useRef<HTMLTextAreaElement | null>(null);

  // 폭 단계가 바뀌면 그 단계의 기본값으로: 넓으면 둘 다 붙박이, 중간이면 끝 영역은 시트(닫힘), 좁으면 둘 다 시트.
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    setStartOpen(layout !== "compact");
    setEndOpen(layout === "wide");
  }, [layout]);

  const openEnd = useCallback((tab: EndTab) => {
    setEndTab(tab);
    setEndOpen(true);
  }, []);

  const selectThread = useCallback(
    (id: string) => {
      const t = threads.find((x) => x.id === id);
      setCurrentId(id);
      setView("thread");
      if (t?.status === "locked") setLockedOpen(true);
      if (layout === "compact") setStartOpen(false);
    },
    [layout],
  );

  const newThread = useCallback(() => {
    setCurrentId(null);
    setView("empty");
    setRunning(false);
    setSent([]);
    if (layout === "compact") setStartOpen(false);
  }, [layout]);

  const decide = useCallback((id: ApprovalId, d: Exclude<Decision, "gone">) => {
    setDecisions((prev) => ({ ...prev, [id]: d }));
    // "허용"(한 번)은 기록으로 1초 보였다가 사라진다.
    if (d === "allowed")
      window.setTimeout(
        () => setDecisions((prev) => (prev[id] === "allowed" ? { ...prev, [id]: "gone" } : prev)),
        1000,
      );
  }, []);

  const send = useCallback(
    (text: string) => {
      setSent((prev) => [...prev, text]);
      if (view === "empty") setView("thread");
    },
    [view],
  );

  const current = threads.find((t) => t.id === currentId);
  const currentTitle =
    view === "empty" || (view === "thread" && current === undefined)
      ? "새 대화"
      : current
        ? current.title === ""
          ? "제목 없음"
          : current.title
        : "";
  const pendingApprovals = (["a1", "a2"] as const).filter(
    (id) => decisions[id] === "pending",
  ).length;

  const value = useMemo<Mock>(
    () => ({
      state,
      layout,
      view,
      startOpen,
      setStartOpen,
      endOpen,
      setEndOpen,
      endTab,
      openEnd,
      currentId,
      currentTitle,
      selectThread,
      newThread,
      decisions,
      decide,
      answer,
      setAnswer,
      reconnecting,
      reconnect: () => setReconnecting(false),
      lockedOpen,
      setLockedOpen,
      observing,
      setObserving,
      paletteOpen,
      setPaletteOpen,
      running,
      stop: () => setRunning(false),
      sent,
      send,
      pendingApprovals,
      composerFocusRef,
    }),
    [
      state,
      layout,
      view,
      startOpen,
      endOpen,
      endTab,
      openEnd,
      currentId,
      currentTitle,
      selectThread,
      newThread,
      decisions,
      decide,
      answer,
      reconnecting,
      lockedOpen,
      observing,
      paletteOpen,
      running,
      sent,
      send,
      pendingApprovals,
    ],
  );

  return <MockContext.Provider value={value}>{children}</MockContext.Provider>;
}
