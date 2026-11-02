// 크래프트 v4 화면 상태. 상태 전환기는 없고, 눌러서 움직이는 값만 둔다(범위·단위·보기·선택·서랍·빌더).
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  INITIAL_OVERRIDES,
  SCOPES,
  effective,
  scopeOf,
  type BuilderContext,
  type Effective,
  type LayerId,
  type Overrides,
  type Plugin,
  type ScopeId,
  type Selection,
  type StageId,
  type Tri,
  type Unit,
  unitPath,
} from "./data";

export type CanvasView = "table" | "loop";
export type InspectorTab = "flow" | "profile" | "code";
export type Drawer = "none" | "extensions";

export interface BuilderState {
  /** 열린 곳: 버튼이면 null, 더하기 칸이면 그 칸 */
  at: { layer: LayerId; stage: StageId } | null;
  template: string | null;
}

export interface Mock {
  scope: ScopeId;
  setScope: (s: ScopeId) => void;
  unit: Unit;
  setUnit: (u: Unit) => void;
  view: CanvasView;
  setView: (v: CanvasView) => void;
  selection: Selection | null;
  select: (s: Selection | null) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (b: boolean) => void;
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  drawer: Drawer;
  setDrawer: (d: Drawer) => void;
  health: boolean;
  setHealth: (b: boolean) => void;
  overrides: Overrides;
  /** 보는 범위에서 값을 쓴다. null이면 이 범위에서 정한 값을 지워 위에서 물려받는다. */
  write: (pluginId: string, v: Tri | null) => void;
  eff: (p: Plugin) => Effective;
  builder: BuilderState | null;
  openBuilder: (at: BuilderState["at"], template: string | null) => void;
  setTemplate: (id: string) => void;
  closeBuilder: () => void;
  builderContext: () => BuilderContext;
  notice: string | null;
  notify: (text: string) => void;
}

const Ctx = createContext<Mock | null>(null);
export function useMock(): Mock {
  const m = useContext(Ctx);
  if (m === null) throw new Error("MockProvider 밖에서 useMock을 불렀어요");
  return m;
}

export function MockProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<ScopeId>("global");
  const [unit, setUnit] = useState<Unit>({ kind: "loop" });
  const [view, setView] = useState<CanvasView>("table");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("flow");
  const [drawer, setDrawer] = useState<Drawer>("none");
  const [health, setHealth] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>(INITIAL_OVERRIDES);
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const select = useCallback((s: Selection | null) => {
    setSelection(s);
    if (s !== null) setInspectorOpen(true);
  }, []);

  const write = useCallback(
    (pluginId: string, v: Tri | null) => {
      setOverrides((o) => {
        const here = { ...o[scope] };
        if (v === null) delete here[pluginId];
        else here[pluginId] = v;
        return { ...o, [scope]: here };
      });
      const s = scopeOf(scope);
      notify(`${s.writes} 저장 · ${v === null ? "물려받기" : v === "on" ? "켜짐" : "꺼짐"} · 이번 단계가 끝나면 적용돼요`);
    },
    [scope, notify],
  );

  const eff = useCallback((p: Plugin) => effective(p, scope, overrides), [scope, overrides]);

  const builderContext = useCallback((): BuilderContext => {
    const s = scopeOf(scope);
    return {
      scopeId: scope,
      scopeLabel: s.label,
      scopeValue: s.value,
      writeTarget: s.target,
      unitPath: unitPath(unit).map((x) => x.label),
      layer: builder?.at?.layer ?? null,
      stage: builder?.at?.stage ?? null,
    };
  }, [scope, unit, builder]);

  const value = useMemo<Mock>(
    () => ({
      scope,
      setScope,
      unit,
      setUnit,
      view,
      setView,
      selection,
      select,
      inspectorOpen,
      setInspectorOpen,
      tab,
      setTab,
      drawer,
      setDrawer,
      health,
      setHealth,
      overrides,
      write,
      eff,
      builder,
      openBuilder: (at, template) => setBuilder({ at, template }),
      setTemplate: (id) => setBuilder((b) => (b === null ? b : { ...b, template: id })),
      closeBuilder: () => setBuilder(null),
      builderContext,
      notice,
      notify,
    }),
    [scope, unit, view, selection, select, inspectorOpen, tab, drawer, health, overrides, write, eff, builder, builderContext, notice, notify],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const SCOPE_LIST = SCOPES;
