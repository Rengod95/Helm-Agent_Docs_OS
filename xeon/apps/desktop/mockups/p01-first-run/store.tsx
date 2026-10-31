// P-01 목업 상태. 엔진 없이 단계 완료·펼침·오류·오프라인만 흉내 낸다. firstRunView의 steps/next/readyToChat 대용.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toolsMissing, toolsReady, type ToolRow } from "./fixtures";

export const STATES = [
  { id: "S1", label: "S1 키 등록" },
  { id: "S2", label: "S2 기본 모델" },
  { id: "S3", label: "S3 기본 그룹" },
  { id: "S4", label: "S4 웹 검색" },
  { id: "S5", label: "S5 필수 도구 없음" },
  { id: "S6", label: "S6 키 저장 실패" },
  { id: "S7", label: "S7 오프라인" },
  { id: "S8", label: "S8 읽는 중" },
  { id: "S9", label: "S9 팔레트" },
  { id: "S10", label: "S10 대화 시작(O-07)" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const STEP_IDS = ["tools", "key", "model", "groups", "search"] as const;
export type StepId = (typeof STEP_IDS)[number];
type Flags = Record<StepId, boolean>;

const order: Record<StateId, number> = {
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  S5: 0,
  S6: 1,
  S7: 1,
  S8: 0,
  S9: 1,
  S10: 5,
};

interface FirstRun {
  state: StateId;
  tools: ToolRow[];
  done: Flags;
  failed: Flags;
  open: StepId | null;
  setOpen: (id: StepId | null) => void;
  provider: string;
  setProvider: (p: string) => void;
  model: string;
  setModel: (m: string) => void;
  groupsOn: Record<string, boolean>;
  setGroup: (id: string, on: boolean) => void;
  busy: "key" | "model" | null;
  keyError: boolean;
  offline: boolean;
  loading: boolean;
  ready: boolean;
  recheck: () => void;
  saveKey: () => void;
  saveModel: () => void;
  confirmGroups: () => void;
  dismissSearch: () => void;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
}

const Ctx = createContext<FirstRun | null>(null);
export function useFirstRun(): FirstRun {
  const v = useContext(Ctx);
  if (v === null) throw new Error("FirstRunProvider 밖이에요");
  return v;
}

export function FirstRunProvider({ state, children }: { state: StateId; children: ReactNode }) {
  const n = order[state];
  const [done, setDone] = useState<Flags>(() => {
    const f = Object.fromEntries(STEP_IDS.map((id, i) => [id, i < n])) as Flags;
    if (state === "S5") f.tools = false;
    return f;
  });
  const [tools, setTools] = useState(state === "S5" ? toolsMissing : toolsReady);
  const [loading, setLoading] = useState(state === "S8");
  const [open, setOpen] = useState<StepId | null>(n >= 5 ? null : (STEP_IDS[n] ?? null));
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("anthropic/sonnet-5-5");
  const [groupsOn, setGroupsOn] = useState<Record<string, boolean>>({
    "grp.helm": true,
    "grp.learning": true,
  });
  const [busy, setBusy] = useState<FirstRun["busy"]>(null);
  const [keyError, setKeyError] = useState(state === "S6");
  const [dialogOpen, setDialogOpen] = useState(state === "S10");
  const offline = state === "S7";

  const finish = useCallback((id: StepId) => {
    setDone((d) => ({ ...d, [id]: true }));
    const next = STEP_IDS[STEP_IDS.indexOf(id) + 1];
    setOpen(next ?? null);
  }, []);

  const value = useMemo<FirstRun>(() => {
    const failed = Object.fromEntries(STEP_IDS.map((id) => [id, false])) as Flags;
    failed.tools = !loading && tools.some((t) => t.need === "필수" && !t.ok);
    return {
      state,
      tools,
      done,
      failed,
      open,
      setOpen,
      provider,
      setProvider,
      model,
      setModel,
      groupsOn,
      setGroup: (id, on) => setGroupsOn((g) => ({ ...g, [id]: on })),
      busy,
      keyError,
      offline,
      loading,
      ready: done.key && done.model,
      recheck: () => {
        setLoading(true);
        window.setTimeout(() => {
          setLoading(false);
          setTools(toolsReady);
          setDone((d) => ({ ...d, tools: true }));
        }, 900);
      },
      saveKey: () => {
        setBusy("key");
        window.setTimeout(() => {
          setBusy(null);
          setKeyError(false);
          finish("key");
        }, 700);
      },
      saveModel: () => {
        setBusy("model");
        window.setTimeout(() => {
          setBusy(null);
          finish("model");
        }, 500);
      },
      confirmGroups: () => finish("groups"),
      dismissSearch: () => finish("search"),
      dialogOpen,
      setDialogOpen,
    };
  }, [
    state,
    tools,
    done,
    open,
    provider,
    model,
    groupsOn,
    busy,
    keyError,
    offline,
    loading,
    finish,
    dialogOpen,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
