// 크래프트 v5 화면 상태. 상태 전환기는 없고 눌러서 움직이는 값만 둔다: 선택, 켜진 곳, 훅 줄 순서, 대체, 만들기, 실패 서랍.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ANGLE,
  CAPS,
  GROUPS,
  INITIAL_ORDER,
  PLUGINS,
  REACH_LABEL,
  capSlot,
  groupById,
  reachRank,
  type Health,
  type Plugin,
  type Reach,
  type Sel,
} from "./data";

export interface BuilderState {
  /** 열린 곳의 훅(줄의 더하기, 빈 줄). 없으면 처음부터 */
  hook: string | null;
  template: string | null;
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
  reach: Reach;
  command?: string;
}

export interface Mock {
  plugins: Plugin[];
  sel: Sel;
  select: (s: Sel) => void;
  reach: (id: string) => Reach;
  setReach: (id: string, r: Reach) => void;
  setGroupReach: (gid: string, r: Reach) => void;
  /** 점 하나로 켜고 끄기: 끄면 마지막 범위를 기억하고, 켜면 그 범위로 돌아온다 */
  toggle: (id: string) => void;
  isOn: (id: string) => boolean;
  health: (id: string) => Health | undefined;
  resetHealth: (id: string) => void;
  order: Record<string, string[]>;
  move: (hook: string, id: string, to: number) => void;
  addToLane: (hook: string, id: string) => void;
  /** 슬롯(훅의 내장, 기능 줄) → 대체한 플러그인 */
  replaced: Record<string, string>;
  replace: (slot: string, id: string | null) => void;
  builder: BuilderState | null;
  openBuilder: (hook: string | null, template?: string | null) => void;
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

const initialReach = (): Record<string, Reach> => Object.fromEntries(PLUGINS.map((p) => [p.id, p.reach]));
const initialHealth = (): Record<string, Health | undefined> => Object.fromEntries(PLUGINS.map((p) => [p.id, p.health]));
/** 새로 만든 플러그인이 앉을 지도 자리(바깥 고리, 빈 각도) */
const FREE_ANGLES = [271, 94];

export function MockProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<Plugin[]>(PLUGINS);
  const [sel, setSel] = useState<Sel>({ k: "agent" });
  const [reachMap, setReachMap] = useState<Record<string, Reach>>(initialReach);
  const lastReach = useRef<Record<string, Reach>>({});
  const [healthMap, setHealthMap] = useState<Record<string, Health | undefined>>(initialHealth);
  const [order, setOrder] = useState<Record<string, string[]>>(() => structuredClone(INITIAL_ORDER));
  const [replaced, setReplaced] = useState<Record<string, string>>({});
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [drawer, setDrawerState] = useState<{ open: boolean; focus: string | null }>({ open: false, focus: null });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const created = useRef(0);

  const notify = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const reach = useCallback((id: string): Reach => reachMap[id] ?? "off", [reachMap]);
  const health = useCallback((id: string) => healthMap[id], [healthMap]);
  const isOn = useCallback(
    (id: string): boolean => reach(id) !== "off" && healthMap[id]?.autoOff !== true,
    [reach, healthMap],
  );

  const setReach = useCallback(
    (id: string, r: Reach) => {
      const cur = reachMap[id] ?? "off";
      if (cur !== "off") lastReach.current[id] = cur;
      setReachMap((prev) => ({ ...prev, [id]: r }));
      if (r !== "off") setHealthMap((prev) => (prev[id]?.autoOff === true ? { ...prev, [id]: undefined } : prev));
    },
    [reachMap],
  );
  const setGroupReach = useCallback(
    (gid: string, r: Reach) => {
      const g = groupById(gid);
      if (g === undefined) return;
      for (const id of g.members) setReach(id, r);
    },
    [setReach],
  );
  const toggle = useCallback(
    (id: string) => {
      const on = (reachMap[id] ?? "off") !== "off" && healthMap[id]?.autoOff !== true;
      if (on) {
        setReach(id, "off");
        notify("꺼요 · 이번 단계가 끝나면 적용돼요");
      } else {
        setReach(id, lastReach.current[id] ?? "project");
        notify("켜요 · 이번 단계가 끝나면 적용돼요");
      }
    },
    [reachMap, healthMap, setReach, notify],
  );
  const resetHealth = useCallback(
    (id: string) => {
      setHealthMap((prev) => ({ ...prev, [id]: undefined }));
      if ((reachMap[id] ?? "off") === "off") setReachMap((prev) => ({ ...prev, [id]: lastReach.current[id] ?? "project" }));
      notify("다시 켰어요 · 실패 기록은 남아요");
    },
    [reachMap, notify],
  );

  const move = useCallback((hook: string, id: string, to: number) => {
    setOrder((prev) => {
      const lane = prev[hook] ?? [];
      const from = lane.indexOf(id);
      if (from < 0) return prev;
      const next = lane.filter((x) => x !== id);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
      return { ...prev, [hook]: next };
    });
  }, []);
  const addToLane = useCallback(
    (hook: string, id: string) => {
      if ((order[hook] ?? []).includes(id)) {
        notify("이미 이 줄에 있어요");
        return;
      }
      setOrder((prev) => ({ ...prev, [hook]: [...(prev[hook] ?? []), id] }));
      setPlugins((prev) => prev.map((p) => (p.id === id && !p.hooks.includes(hook) ? { ...p, hooks: [...p.hooks, hook] } : p)));
      if ((reachMap[id] ?? "off") === "off") setReachMap((prev) => ({ ...prev, [id]: lastReach.current[id] ?? "project" }));
      notify(`${hook}에 더했어요 · ${T_PLUGIN_FILE}에 훅이 적혀요`);
    },
    [order, reachMap, notify],
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
        if ((reachMap[id] ?? "off") === "off") setReachMap((prev) => ({ ...prev, [id]: lastReach.current[id] ?? "project" }));
        notify("대체했어요 · 내장은 가려져요");
      } else notify("내장으로 되돌렸어요");
    },
    [reachMap, notify],
  );

  const select = useCallback((s: Sel) => setSel(s), []);
  const openBuilder = useCallback((hook: string | null, template: string | null = null) => setBuilder({ hook, template }), []);
  const setTemplate = useCallback((id: string) => setBuilder((b) => (b === null ? b : { ...b, template: id })), []);
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
        reach: c.reach,
        hooks: c.hook === null ? [] : [c.hook],
        provides: [],
        pieces: c.template === "skill" ? [{ kind: "skill", name: "new-skill" }] : c.template === "command" ? [{ kind: "command", name: "/new" }] : [],
      };
      setPlugins((prev) => [...prev, plugin]);
      setReachMap((prev) => ({ ...prev, [id]: c.reach }));
      if (c.hook !== null) setOrder((prev) => ({ ...prev, [c.hook ?? ""]: [...(prev[c.hook ?? ""] ?? []), id] }));
      ANGLE[id] = FREE_ANGLES[n % FREE_ANGLES.length] ?? 271;
      setSel({ k: "plugin", id });
      setBuilder(null);
      notify(`${REACH_LABEL[c.reach]}에 저장 · 이번 단계가 끝나면 적용돼요`);
    },
    [notify],
  );

  const openDrawer = useCallback((focus: string | null) => setDrawerState({ open: true, focus }), []);
  const closeDrawer = useCallback(() => setDrawerState({ open: false, focus: null }), []);

  const value = useMemo<Mock>(
    () => ({
      plugins, sel, select, reach, setReach, setGroupReach, toggle, isOn, health, resetHealth, order, move, addToLane,
      replaced, replace, builder, openBuilder, setTemplate, closeBuilder, create, drawer, openDrawer, closeDrawer,
      drag, setDrag, notice, notify,
    }),
    [plugins, sel, select, reach, setReach, setGroupReach, toggle, isOn, health, resetHealth, order, move, addToLane,
      replaced, replace, builder, openBuilder, setTemplate, closeBuilder, create, drawer, openDrawer, closeDrawer, drag, notice, notify],
  );
  return <MockContext.Provider value={value}>{children}</MockContext.Provider>;
}

const T_PLUGIN_FILE = "확장 정보 파일";

// ── 파생값 ────────────────────────────────────────────────────────
export interface Lit {
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
  if (sel.k === "plugin") take(byId(sel.id));
  else if (sel.k === "group") for (const id of groupById(sel.id)?.members ?? []) take(byId(id));
  else if (sel.k === "hook") {
    hs.add(sel.id);
    for (const id of order[sel.id] ?? []) ps.add(id);
  } else if (sel.k === "builtin") {
    if (sel.slot.startsWith("hook:")) hs.add(sel.slot.slice(5));
    else cs.add(sel.slot.slice(4));
  }
  return { plugins: ps, hooks: hs, caps: cs, active: sel.k !== "agent" };
}

/** 몇 개가 켜져 있나(그룹 카드용) */
export function groupState(gid: string, reach: (id: string) => Reach, isOn: (id: string) => boolean): { on: number; total: number; widest: Reach } {
  const g = groupById(gid);
  const ids = g?.members ?? [];
  let widest: Reach = "off";
  for (const id of ids) if (reachRank(reach(id)) > reachRank(widest)) widest = reach(id);
  return { on: ids.filter(isOn).length, total: ids.length, widest };
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
