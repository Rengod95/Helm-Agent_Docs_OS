// 크래프트 v5 화면 상태. 상태 전환기는 없고 눌러서 움직이는 값만 둔다: 선택, 켜진 곳, 훅 줄 순서, 대체, 만들기, 실패 서랍.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { reducedMotion } from "./viewport";
import {
  ANGLE,
  CAPS,
  CONTRIB_ORDER,
  GROUPS,
  INITIAL_ORDER,
  PLUGINS,
  capSlot,
  groupById,
  hookDef,
  hasContrib,
  matchesKind,
  type Contrib,
  type Health,
  type KindFilter,
  type LayerKey,
  type Plugin,
  type Sel,
} from "./data";

export interface BuilderState {
  /** 열린 곳의 훅(줄의 더하기, 빈 줄). 없으면 처음부터 */
  hook: string | null;
  template: string | null;
  /** "대화에서 만들기"로 시작한 지난 대화 */
  thread: string | null;
}
export interface PendingMove {
  hook: string;
  id: string;
  to: number;
  /** 새 순서에서 먼저 답할 수 있는 핸들러가 새로 생겨 건너뛰어질 수 있는 핸들러 이름 */
  skipped: string[];
}
const nameOf = (plugins: readonly Plugin[], id: string): string =>
  plugins.find((p) => p.id === id)?.name ?? id;
/** 차단 줄에서 앞선 핸들러가 이전 순서에는 없던 핸들러가 새로 앞서게 된 것들 */
function newlySkippable(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((id, i) => {
    const was = new Set(before.slice(0, before.indexOf(id)));
    return after.slice(0, i).some((x) => !was.has(x));
  });
}
export interface DragState {
  id: string;
  /** 줄에서 끌면 그 줄의 훅, 지도에서 끌면 null */
  from: string | null;
  label: string;
  x: number;
  y: number;
  over: { hook: string; index: number } | null;
}
export interface Created {
  name: string;
  hook: string | null;
  template: string | null;
  command?: string;
}

export type MapView = "orbit" | "strata" | "link";
export type View = MapView | "detail";
export interface Filter {
  kind: KindFilter;
  contrib: readonly Contrib[];
}
export type RunMode = "sample" | "recent";
export interface DetailTarget {
  k: "plugin" | "group";
  id: string;
}

export interface Mock {
  plugins: Plugin[];
  sel: Sel;
  /** 고르면 오른쪽 패널이 열린다. open=false면 고르기만 한다(Esc) */
  select: (s: Sel, open?: boolean) => void;
  /** 오른쪽 선택 패널이 열려 있나 */
  panel: boolean;
  closePanel: () => void;
  /** 지도(orbit)·순서(strata)·플러그인 자세히(detail) */
  view: View;
  setView: (v: MapView) => void;
  detail: DetailTarget | null;
  /** 자세히 보기에서 돌아갈 곳 */
  back: MapView;
  /** 자세히 보기를 연다. code=true면 코드가 펼쳐진 채로 */
  openDetail: (t: DetailTarget, code?: boolean) => void;
  detailCode: boolean;
  closeDetail: () => void;
  run: RunMode;
  setRun: (r: RunMode) => void;
  /** 고리를 눌러 연 층(아래 패널). 고르기(sel)와 따로 산다 */
  ring: LayerKey | null;
  openRing: (l: LayerKey) => void;
  closeRing: () => void;
  layerList: (l: LayerKey) => Plugin[];
  moveInLayer: (l: LayerKey, id: string, to: number) => void;
  filter: Filter;
  setKind: (k: KindFilter) => void;
  toggleContrib: (c: Contrib) => void;
  clearFilter: () => void;
  /** 필터에 맞나(필터가 없으면 모두 맞다) */
  matches: (p: Plugin) => boolean;
  filtering: boolean;
  /** 켜고 끄기: 전역 하나뿐이다 */
  setOn: (id: string, on: boolean) => void;
  setGroupOn: (gid: string, on: boolean) => void;
  toggle: (id: string) => void;
  isOn: (id: string) => boolean;
  health: (id: string) => Health | undefined;
  resetHealth: (id: string) => void;
  order: Record<string, string[]>;
  move: (hook: string, id: string, to: number) => void;
  /** 순서를 바꾸면 앞선 차단 핸들러가 먼저 답해 건너뛰어질 수 있는 핸들러가 생길 때, 저장 전에 묻는다 */
  pendingMove: PendingMove | null;
  confirmMove: () => void;
  cancelMove: () => void;
  addToLane: (hook: string, id: string) => void;
  /** 슬롯(훅의 내장, 기능 줄) → 대체한 플러그인 */
  replaced: Record<string, string>;
  replace: (slot: string, id: string | null) => void;
  builder: BuilderState | null;
  openBuilder: (hook: string | null, template?: string | null, thread?: string | null) => void;
  setThread: (id: string | null) => void;
  setTemplate: (id: string) => void;
  closeBuilder: () => void;
  create: (c: Created) => void;
  drawer: { open: boolean; focus: string | null };
  openDrawer: (focus: string | null) => void;
  closeDrawer: () => void;
  drag: DragState | null;
  setDrag: (d: DragState | null) => void;
  notice: string | null;
  notify: (text: string) => void;
}

const MockContext = createContext<Mock | null>(null);
export function useMock(): Mock {
  const m = useContext(MockContext);
  if (m === null) throw new Error("MockProvider 밖에서 useMock을 불렀어요");
  return m;
}

const initialOn = (): Record<string, boolean> =>
  Object.fromEntries(PLUGINS.map((p) => [p.id, p.on]));
const initialHealth = (): Record<string, Health | undefined> =>
  Object.fromEntries(PLUGINS.map((p) => [p.id, p.health]));
/** 새로 만든 플러그인이 앉을 지도 자리(바깥 고리, 빈 각도) */
const FREE_ANGLES = [176, 214];

export function MockProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>(PLUGINS);
  const [sel, setSel] = useState<Sel>({ k: "agent" });
  const [panel, setPanel] = useState(false);
  const [view, setViewState] = useState<View>("orbit");
  const [back, setBack] = useState<MapView>("orbit");
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [detailCode, setDetailCode] = useState(false);
  const [run, setRun] = useState<RunMode>("sample");
  const [ring, setRing] = useState<LayerKey | null>(null);
  const [layerOrder, setLayerOrder] = useState<Record<string, string[]>>({});
  const [filter, setFilter] = useState<Filter>({ kind: "all", contrib: [] });
  const [onMap, setOnMap] = useState<Record<string, boolean>>(initialOn);
  const [healthMap, setHealthMap] = useState<Record<string, Health | undefined>>(initialHealth);
  const [order, setOrder] = useState<Record<string, string[]>>(() =>
    structuredClone(INITIAL_ORDER),
  );
  const [replaced, setReplaced] = useState<Record<string, string>>({});
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [drawer, setDrawerState] = useState<{ open: boolean; focus: string | null }>({
    open: false,
    focus: null,
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const created = useRef(0);

  const notify = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const health = useCallback((id: string) => healthMap[id], [healthMap]);
  const isOn = useCallback(
    (id: string): boolean => onMap[id] === true && healthMap[id]?.autoOff !== true,
    [onMap, healthMap],
  );

  const setOn = useCallback((id: string, on: boolean) => {
    setOnMap((prev) => ({ ...prev, [id]: on }));
    if (on)
      setHealthMap((prev) => (prev[id]?.autoOff === true ? { ...prev, [id]: undefined } : prev));
  }, []);
  const setGroupOn = useCallback(
    (gid: string, on: boolean) => {
      const g = groupById(gid);
      if (g === undefined) return;
      for (const id of g.members) setOn(id, on);
    },
    [setOn],
  );
  const toggle = useCallback(
    (id: string) => {
      const on = onMap[id] === true && healthMap[id]?.autoOff !== true;
      setOn(id, !on);
      notify(on ? "껐어요" : "켰어요");
    },
    [onMap, healthMap, setOn, notify],
  );
  const resetHealth = useCallback(
    (id: string) => {
      setHealthMap((prev) => ({ ...prev, [id]: undefined }));
      setOnMap((prev) => ({ ...prev, [id]: true }));
      notify("다시 켰어요");
    },
    [notify],
  );

  const applyMove = useCallback((hook: string, id: string, to: number) => {
    setOrder((prev) => {
      const lane = prev[hook] ?? [];
      const from = lane.indexOf(id);
      if (from < 0) return prev;
      const next = lane.filter((x) => x !== id);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
      return { ...prev, [hook]: next };
    });
  }, []);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const move = useCallback(
    (hook: string, id: string, to: number) => {
      const lane = order[hook] ?? [];
      if (lane.indexOf(id) < 0) return;
      const next = lane.filter((x) => x !== id);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
      const skipped =
        hookDef(hook)?.fold === "first"
          ? newlySkippable(lane, next).map((x) => nameOf(plugins, x))
          : [];
      if (skipped.length === 0) applyMove(hook, id, to);
      else setPendingMove({ hook, id, to, skipped });
    },
    [order, plugins, applyMove],
  );
  const confirmMove = useCallback(() => {
    if (pendingMove !== null) applyMove(pendingMove.hook, pendingMove.id, pendingMove.to);
    setPendingMove(null);
  }, [pendingMove, applyMove]);
  const cancelMove = useCallback(() => setPendingMove(null), []);
  const addToLane = useCallback(
    (hook: string, id: string) => {
      if ((order[hook] ?? []).includes(id)) {
        notify("이미 이 줄에 있어요");
        return;
      }
      setOrder((prev) => ({ ...prev, [hook]: [...(prev[hook] ?? []), id] }));
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === id && !p.hooks.includes(hook) ? { ...p, hooks: [...p.hooks, hook] } : p,
        ),
      );
      setOnMap((prev) => (prev[id] === true ? prev : { ...prev, [id]: true }));
      notify(`${hook}에 더했어요`);
    },
    [order, notify],
  );

  const replace = useCallback(
    (slot: string, id: string | null) => {
      setReplaced((prev) => {
        const next = { ...prev };
        if (id === null) delete next[slot];
        else next[slot] = id;
        return next;
      });
      if (id !== null) {
        setOnMap((prev) => (prev[id] === true ? prev : { ...prev, [id]: true }));
        notify("대체했어요");
      } else notify("내장으로 되돌렸어요");
    },
    [notify],
  );

  const select = useCallback((s: Sel, open = true) => {
    setSel(s);
    setPanel(open && s.k !== "layer");
  }, []);
  const closePanel = useCallback(() => setPanel(false), []);
  const setView = useCallback((v: MapView) => {
    const apply = (): void => {
      setViewState(v);
      setBack(v);
    };
    // 보기를 바꿀 때 같은 플러그인의 이름표가 자기 자리로 옮겨 가도록 View Transition을 쓴다(움직임을 줄이면 바로 바꾼다).
    if (typeof document.startViewTransition === "function" && !reducedMotion())
      document.startViewTransition(() => flushSync(apply));
    else apply();
  }, []);
  const openDetail = useCallback((t: DetailTarget, code = false) => {
    setDetail(t);
    setDetailCode(code);
    setViewState("detail");
  }, []);
  const closeDetail = useCallback(() => setViewState(back), [back]);
  const openRing = useCallback((l: LayerKey) => {
    setRing(l);
    setSel({ k: "layer", id: l });
    setPanel(false);
  }, []);
  const closeRing = useCallback(() => {
    setRing(null);
    setSel((cur) => (cur.k === "layer" ? { k: "agent" } : cur));
  }, []);
  const layerList = useCallback(
    (l: LayerKey): Plugin[] => {
      const all = plugins.filter((p) => p.layer === l);
      const saved = layerOrder[l] ?? [];
      const first = saved
        .map((id) => all.find((p) => p.id === id))
        .filter((p): p is Plugin => p !== undefined);
      return [...first, ...all.filter((p) => !saved.includes(p.id))];
    },
    [plugins, layerOrder],
  );
  const moveInLayer = useCallback(
    (l: LayerKey, id: string, to: number) => {
      const ids = layerList(l).map((p) => p.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      const next = ids.filter((x) => x !== id);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
      setLayerOrder((prev) => ({ ...prev, [l]: next }));
    },
    [layerList],
  );
  const setKind = useCallback((kind: KindFilter) => setFilter((f) => ({ ...f, kind })), []);
  const toggleContrib = useCallback(
    (c: Contrib) =>
      setFilter((f) => ({
        ...f,
        contrib: f.contrib.includes(c)
          ? f.contrib.filter((x) => x !== c)
          : CONTRIB_ORDER.filter((x) => x === c || f.contrib.includes(x)),
      })),
    [],
  );
  const clearFilter = useCallback(() => setFilter({ kind: "all", contrib: [] }), []);
  const filtering = filter.kind !== "all" || filter.contrib.length > 0;
  const matches = useCallback(
    (p: Plugin): boolean =>
      matchesKind(p, filter.kind) &&
      (filter.contrib.length === 0 || filter.contrib.some((c) => hasContrib(p, c))),
    [filter],
  );
  const openBuilder = useCallback(
    (hook: string | null, template: string | null = null, thread: string | null = null) =>
      setBuilder({ hook, template, thread }),
    [],
  );
  const setThread = useCallback(
    (id: string | null) => setBuilder((b) => (b === null ? b : { ...b, thread: id })),
    [],
  );
  const setTemplate = useCallback(
    (id: string) => setBuilder((b) => (b === null ? b : { ...b, template: id })),
    [],
  );
  const closeBuilder = useCallback(() => setBuilder(null), []);

  const create = useCallback(
    (c: Created) => {
      const n = created.current;
      created.current += 1;
      const id = c.command !== undefined ? `cmd-${n}` : `new-${n}`;
      const plugin: Plugin = {
        id,
        name: c.name,
        role: c.command !== undefined ? "명령 훅" : "새로 만든 플러그인",
        layer: "plugin",
        origin: "user",
        version: "0.0.1",
        on: true,
        hooks: c.hook === null ? [] : [c.hook],
        provides: [],
        pieces:
          c.template === "skill"
            ? [{ kind: "skill", name: "new-skill" }]
            : c.template === "command"
              ? [{ kind: "command", name: "/new" }]
              : [],
      };
      setPlugins((prev) => [...prev, plugin]);
      setOnMap((prev) => ({ ...prev, [id]: true }));
      if (c.hook !== null)
        setOrder((prev) => ({ ...prev, [c.hook ?? ""]: [...(prev[c.hook ?? ""] ?? []), id] }));
      ANGLE[id] = FREE_ANGLES[n % FREE_ANGLES.length] ?? 271;
      setSel({ k: "plugin", id });
      setPanel(true);
      setBuilder(null);
      notify("만들었어요");
    },
    [notify],
  );

  const openDrawer = useCallback(
    (focus: string | null) => setDrawerState({ open: true, focus }),
    [],
  );
  const closeDrawer = useCallback(() => setDrawerState({ open: false, focus: null }), []);

  const value = useMemo<Mock>(
    () => ({
      plugins,
      sel,
      select,
      panel,
      closePanel,
      view,
      setView,
      detail,
      back,
      openDetail,
      detailCode,
      closeDetail,
      run,
      setRun,
      ring,
      openRing,
      closeRing,
      layerList,
      moveInLayer,
      filter,
      setKind,
      toggleContrib,
      clearFilter,
      matches,
      filtering,
      setOn,
      setGroupOn,
      toggle,
      isOn,
      health,
      resetHealth,
      order,
      move,
      pendingMove,
      confirmMove,
      cancelMove,
      addToLane,
      replaced,
      replace,
      builder,
      openBuilder,
      setThread,
      setTemplate,
      closeBuilder,
      create,
      drawer,
      openDrawer,
      closeDrawer,
      drag,
      setDrag,
      notice,
      notify,
    }),
    [
      plugins,
      sel,
      select,
      panel,
      closePanel,
      view,
      setView,
      detail,
      back,
      openDetail,
      detailCode,
      closeDetail,
      run,
      ring,
      openRing,
      closeRing,
      layerList,
      moveInLayer,
      filter,
      setKind,
      toggleContrib,
      clearFilter,
      matches,
      filtering,
      setOn,
      setGroupOn,
      toggle,
      isOn,
      health,
      resetHealth,
      order,
      move,
      pendingMove,
      confirmMove,
      cancelMove,
      addToLane,
      replaced,
      replace,
      builder,
      openBuilder,
      setThread,
      setTemplate,
      closeBuilder,
      create,
      drawer,
      openDrawer,
      closeDrawer,
      drag,
      notice,
      notify,
    ],
  );
  return <MockContext.Provider value={value}>{children}</MockContext.Provider>;
}

// ── 파생값 ────────────────────────────────────────────────────────
export interface Lit {
  /** 지금 고른 플러그인(밝은 점 하나). 그룹이나 층을 골랐으면 없다 */
  primary: string | null;
  plugins: ReadonlySet<string>;
  hooks: ReadonlySet<string>;
  caps: ReadonlySet<string>;
  /** 선택이 있으면 true: 밝지 않은 것은 흐리게 */
  active: boolean;
}
/** 선택에서 밝힐 플러그인, 훅 줄, 기능 줄. 지도와 순서가 같은 값을 읽어 서로 따라간다. */
export function litOf(sel: Sel, plugins: readonly Plugin[], order: Record<string, string[]>): Lit {
  const byId = (id: string): Plugin | undefined => plugins.find((p) => p.id === id);
  const ps = new Set<string>();
  const hs = new Set<string>();
  const cs = new Set<string>();
  const take = (p: Plugin | undefined): void => {
    if (p === undefined) return;
    ps.add(p.id);
    for (const h of p.hooks) hs.add(h);
    for (const c of p.provides) cs.add(c);
  };
  if (sel.k === "plugin") {
    // 그룹의 구성원을 고르면 그룹 전체가 켜진다: 여러 층에 걸친 것은 한 덩어리로 읽는다
    const p = byId(sel.id);
    const g = p?.group === undefined ? undefined : groupById(p.group);
    if (g === undefined) take(p);
    else for (const id of g.members) take(byId(id));
  } else if (sel.k === "layer") {
    for (const p of plugins) if (p.layer === sel.id) take(p);
  } else if (sel.k === "group") {
    for (const id of groupById(sel.id)?.members ?? []) take(byId(id));
  } else if (sel.k === "hook") {
    hs.add(sel.id);
    for (const id of order[sel.id] ?? []) ps.add(id);
  } else if (sel.k === "builtin") {
    if (sel.slot.startsWith("hook:")) hs.add(sel.slot.slice(5));
    else cs.add(sel.slot.slice(4));
  }
  return {
    primary: sel.k === "plugin" ? sel.id : null,
    plugins: ps,
    hooks: hs,
    caps: cs,
    active: sel.k !== "agent",
  };
}

/** 몇 개가 켜져 있나(그룹 카드용) */
export function groupState(
  gid: string,
  isOn: (id: string) => boolean,
): { on: number; total: number } {
  const g = groupById(gid);
  const ids = g?.members ?? [];
  return { on: ids.filter(isOn).length, total: ids.length };
}

/** 바깥 대체 상태에서 이 플러그인이 가려졌나(내장 제공자가 대체됐다) */
export function shadowedBy(id: string, replaced: Record<string, string>): string | null {
  for (const c of CAPS) {
    const by = replaced[capSlot(c.id)];
    if (by !== undefined && c.builtin === id && by !== id) return by;
  }
  return null;
}
export const replacesAnything = (id: string, replaced: Record<string, string>): boolean =>
  Object.values(replaced).some((by) => by === id);
export { GROUPS };
