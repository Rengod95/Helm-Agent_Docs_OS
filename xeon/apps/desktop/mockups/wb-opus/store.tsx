// 크래프트 시안 상태(로컬만, §14.7). ?state=S1..S11이 첫 화면과 조건을 정하고, 그 뒤는 누름으로 바뀐다.
import { toast } from "@caustic/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { extensions as baseExtensions, useShell, type Extension, type ShellState } from "../_shell";

export const STATES = [
  { id: "S1", label: "S1 W1 개요" },
  { id: "S2", label: "S2 W1 안전 모드" },
  { id: "S3", label: "S3 W2 확장 목록" },
  { id: "S4", label: "S4 W2 오프라인" },
  { id: "S5", label: "S5 W3 helm 훅" },
  { id: "S6", label: "S6 W3 review 기록" },
  { id: "S7", label: "S7 W4 Helm 탐구" },
  { id: "S8", label: "S8 W4 확장 꺼짐" },
  { id: "S9", label: "S9 W4 화면 오류" },
  { id: "S10", label: "S10 W5 런타임 탭" },
  { id: "S11", label: "S11 W5 drive 없음" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export type Screen = "overview" | "extensions" | "detail" | "view" | "chat" | "other";
export type DetailTab =
  | "overview"
  | "points"
  | "lease"
  | "settings"
  | "metrics"
  | "log"
  | "versions"
  | "views";

/** 상태별 첫 영역(오른쪽 well 처음 탭·열림은 main.tsx가 ShellStateProvider에 준다). */
export const isChatState = (s: StateId) => s === "S10" || s === "S11";

interface Initial {
  screen: Screen;
  detailExt: string;
  detailTab: DetailTab;
}
const INITIAL: Record<StateId, Initial> = {
  S1: { screen: "overview", detailExt: "helm", detailTab: "overview" },
  S2: { screen: "overview", detailExt: "helm", detailTab: "overview" },
  S3: { screen: "extensions", detailExt: "helm", detailTab: "overview" },
  S4: { screen: "extensions", detailExt: "helm", detailTab: "overview" },
  S5: { screen: "detail", detailExt: "helm", detailTab: "points" },
  S6: { screen: "detail", detailExt: "review", detailTab: "log" },
  S7: { screen: "view", detailExt: "helm", detailTab: "views" },
  S8: { screen: "view", detailExt: "helm", detailTab: "views" },
  S9: { screen: "view", detailExt: "helm", detailTab: "views" },
  S10: { screen: "chat", detailExt: "helm", detailTab: "overview" },
  S11: { screen: "chat", detailExt: "helm", detailTab: "overview" },
};

export interface Mock extends ShellState {
  state: StateId;
  screen: Screen;
  /** 내비가 W6–W9 화면(다른 시안)을 고르면 그 라벨. */
  otherLabel: string;
  otherLabelId: string;
  go: (s: Screen, label?: string, id?: string) => void;
  detailExt: string;
  detailTab: DetailTab;
  setDetailTab: (t: DetailTab) => void;
  openDetail: (name: string, tab?: DetailTab) => void;
  openView: () => void;
  /** W4 "대화로": 맥락 대화의 대화 화면으로 가서 Helm well을 다시 연다(DP-24). */
  backToChat: (tab?: string) => void;
  safeMode: boolean;
  offline: boolean;
  viewError: boolean;
  driveHolder: string | null;
  exts: Extension[];
  ext: (name: string) => Extension | undefined;
  /** "다음 단계 경계에 적용" 대기 중인 확장. */
  pending: Set<string>;
  setEnabled: (name: string, on: boolean) => void;
  reenable: (name: string) => void;
  driveGroup: string;
  setDriveGroup: (g: string) => void;
}

const Ctx = createContext<Mock | null>(null);
export function useMock(): Mock {
  const m = useContext(Ctx);
  if (m === null) throw new Error("MockProvider 밖이에요");
  return m;
}

export function MockProvider({ state, children }: { state: StateId; children: ReactNode }) {
  const shell = useShell();
  const init = INITIAL[state];
  // 영역마다 마지막 화면을 기억한다(§4.9.2): 크래프트 화면은 wbScreen, 대화 영역이면 늘 "chat".
  const [wbScreen, setWbScreen] = useState<Screen>(
    init.screen === "chat" ? "overview" : init.screen,
  );
  const screen: Screen = shell.area === "chat" ? "chat" : wbScreen;
  const [otherLabel, setOtherLabel] = useState("");
  const [otherLabelId, setOtherLabelId] = useState("");
  const [detailExt, setDetailExt] = useState(init.detailExt);
  const [detailTab, setDetailTab] = useState<DetailTab>(init.detailTab);
  const [exts, setExts] = useState<Extension[]>(() =>
    baseExtensions.map((e) =>
      state === "S8" && e.name === "helm" ? { ...e, status: "disabled", drive: "none" } : e,
    ),
  );
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [driveGroup, setDriveGroup] = useState("auto");
  const timers = useRef<number[]>([]);

  const ext = useCallback((name: string) => exts.find((e) => e.name === name), [exts]);

  // 켜기·끄기: 행에 "다음 단계 경계에 적용"이 1초 보이고 상태가 바뀐다(§14.7).
  const setEnabled = useCallback((name: string, on: boolean) => {
    setPending((p) => new Set(p).add(name));
    const id = window.setTimeout(() => {
      setExts((xs) =>
        xs.map((e) =>
          e.name === name
            ? {
                ...e,
                status: on ? "enabled" : "disabled",
                failures: on ? e.failures : e.failures,
                drive: on ? e.drive : "none",
              }
            : e,
        ),
      );
      setPending((p) => {
        const n = new Set(p);
        n.delete(name);
        return n;
      });
      toast({
        title: on ? `${name}을 켰어요` : `${name}을 껐어요`,
        description: "다음 단계 경계에 적용했어요.",
      });
    }, 1000);
    timers.current.push(id);
  }, []);

  const reenable = useCallback((name: string) => {
    setExts((xs) =>
      xs.map((e) => (e.name === name ? { ...e, status: "enabled", failures: 0 } : e)),
    );
    toast({ title: `${name}을 다시 켰어요`, description: "실패 장부를 비웠어요." });
  }, []);

  const go = useCallback(
    (s: Screen, label = "", id = "") => {
      if (s === "chat") return shell.setArea("chat");
      setWbScreen(s);
      setOtherLabel(label);
      setOtherLabelId(id);
      shell.setArea("workbench");
    },
    [shell],
  );

  const value = useMemo<Mock>(
    () => ({
      ...shell,
      state,
      screen,
      otherLabel,
      otherLabelId,
      go,
      detailExt,
      detailTab,
      setDetailTab,
      openDetail: (name, tab = "overview") => {
        setDetailExt(name);
        setDetailTab(tab);
        go("detail");
      },
      openView: () => go("view"),
      backToChat: (tab = "helm/panel") => {
        go("chat");
        shell.openEnd(tab, "chat");
      },
      safeMode: state === "S2",
      offline: state === "S4",
      viewError: state === "S9",
      driveHolder:
        state === "S11"
          ? null
          : (exts.find((e) => e.drive === "holder" && e.status === "enabled")?.name ?? null),
      exts,
      ext,
      pending,
      setEnabled,
      reenable,
      driveGroup,
      setDriveGroup,
    }),
    [
      shell,
      state,
      screen,
      otherLabel,
      otherLabelId,
      go,
      detailExt,
      detailTab,
      exts,
      ext,
      pending,
      setEnabled,
      reenable,
      driveGroup,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
