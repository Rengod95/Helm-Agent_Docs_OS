// cv4 프로필 캔버스: 가로 레일(바닥 층) 위에 플러그인 판(뜬 층)이 붙는 자리마다 서고, 상세는 맨 위 층의 플로팅 판에 뜬다.
// 사이드 패널에서 줄을 누르면 캔버스가 그 노드로 부드럽게 옮겨 가고(멀면 확대), 노드가 한 번 밝아지며 상세가 열린다.
// 키보드(캔버스): 화살표 = 그 방향의 다음 노드, Enter = 상세, Shift+Enter = 안으로, Alt+↑↓ = 같은 자리 안 순서, Delete = 빼기, Esc = 닫기.
// 끌기: 목록 줄을 캔버스에 놓으면 넣고(붙는 자리가 미리 밝아진다), 판을 목록으로 끌어 놓으면 뺀다.
import { t } from "@fresnel/client/i18n";
import { FloatingBar, FloatingBarItem, FloatingBarSeparator, ZoomControl } from "@caustic/react";
import { Maximize } from "@caustic/react/icons";
import { detach, rethrow } from "@fresnel/contracts";
import { ReactFlow, useReactFlow, useViewportStore } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { InfoTip } from "../../info-tip.tsx";
import { useCraftTheme } from "../../orbit.tsx";
import { Icon, KIND_COLOR, KindTile } from "./glyphs.tsx";
import { POOL_HALF, RAIL_HALF, layoutProfile, type ProfileLayout, type Rect } from "./layout.ts";
import {
  addPlugin,
  laneOf,
  nudge,
  placedOf,
  pluginOf,
  relationsOf,
  removeBundle,
  removePlugin,
  setStartDrive,
  type Anchor,
  type RelationKind,
} from "./model.ts";
import {
  CanvasActionsContext,
  NODE_TYPES,
  type CanvasActions,
  type CanvasNode,
  type Mark,
} from "./nodes.tsx";
import { Palette } from "./palette.tsx";
import {
  BuilderDetail,
  BundleDetail,
  PANEL_W,
  PluginDetail,
  RelationSwatch,
  type PanelActions,
} from "./panel.tsx";
import { bundleMetaOf } from "../shared-meta.ts";
import { currentProfile, setCollapsed, setProfile, updateStore, useCanvasStore } from "./store.ts";
import { KIND_WORD, RELATION_HINT, RELATION_WORD } from "./words.ts";

/** 이보다 좁은 창에서는 사이드 패널을 타일 막대로 접은 채 연다 */
const WIDE_ENOUGH = 1280;
/** 맞춤 보기 여백(화면 픽셀). 위는 프로필 머리, 아래는 도구 막대, 오른쪽은 앱의 세로 도구 자리 */
const FIT_PAD = { top: "72px", left: "28px", right: "60px", bottom: "64px" } as const;
/** 처음 시점의 여백(화면 픽셀): 위는 프로필 머리(40) 아래 24, 오른쪽은 앱의 세로 도구 자리 */
const OPEN_PAD = { top: 76, left: 32, right: 64, bottom: 72 } as const;
/** 처음 시점의 가장 작은 배율: 중간 단계(48% 이상)에서 이름과 하는 일이 읽히는 크기. 판들이 넉넉히 들어가면 0.8까지 키운다 */
const OPEN_ZOOM = 0.6;
const OPEN_ZOOM_MAX = 0.8;

/** 판·묶음·빌더가 차지한 상자(레일의 빈 양 끝은 뺀다). 판이 없으면 null */
function contentBox(layout: ProfileLayout): Rect | null {
  const rs: Rect[] = [...layout.plates, ...layout.bundles];
  if (layout.builder !== null) rs.push(layout.builder);
  if (rs.length === 0) return null;
  const x0 = Math.min(...rs.map((r) => r.x));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  return { x: x0 - 24, y: layout.bounds.y, w: x1 - x0 + 48, h: layout.bounds.h };
}
const REL_KINDS: readonly RelationKind[] = ["handoff", "depends", "reads", "creates", "replaces"];

interface Drag {
  readonly name: string;
  readonly from: "palette" | "canvas";
  readonly x: number;
  readonly y: number;
  readonly over: "canvas" | "palette" | "none";
}

function detachView(work: Promise<boolean>): void {
  detach(work, rethrow);
}

function intersects(
  a: DOMRect,
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 붙는 자리의 레일 위 점(끌 때 미리 밝히는 곳) */
function anchorPoint(layout: ProfileLayout, a: Anchor): { x: number; y: number } | null {
  if (a === "drive") {
    const b = layout.boundaries.find((x) => x.id === "input-received");
    return b === undefined ? null : { x: b.x, y: -RAIL_HALF };
  }
  if (a.startsWith("boundary:")) {
    const b = layout.boundaries.find((x) => `boundary:${x.id}` === a);
    return b === undefined ? null : { x: b.x, y: RAIL_HALF };
  }
  const spot =
    layout.sockets.find((k) => k.anchor === a) ?? layout.ticks.find((k) => k.anchor === a);
  if (spot === undefined) return null;
  return { x: spot.x, y: laneOf(a) === "feed" ? -RAIL_HALF : RAIL_HALF };
}

function rectIn(layout: ProfileLayout, id: string): Rect | null {
  if (id === "@builder") return layout.builder;
  if (id.startsWith("bundle:")) return layout.bundles.find((b) => `bundle:${b.id}` === id) ?? null;
  const plate = layout.plates.find((p) => p.placed.plugin.name === id);
  if (plate !== undefined) return plate;
  return layout.bundles.find((b) => b.collapsed && b.members.includes(id)) ?? null;
}

export function ProfileCanvas(props: { readonly onOpen: (name: string) => void }): ReactNode {
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const rf = useReactFlow();
  const theme = useCraftTheme();
  const reduced = useMotionReduced();
  const zoom = useViewportStore((s) => s.transform[2]);
  const [selected, setSelected] = useState<string | null>(null);
  const [arrive, setArrive] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [say, setSay] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth >= WIDE_ENOUGH);
  const wrapRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutProfile(profile, store.collapsed), [profile, store.collapsed]);
  const empty = profile.entries.length === 0;
  const placed = useMemo(() => placedOf(profile), [profile]);
  const relations = useMemo(() => relationsOf(profile), [profile]);
  const bundleList = useMemo(
    () =>
      profile.entries.flatMap((e) =>
        e.type === "bundle" ? [{ id: e.id, members: e.members }] : [],
      ),
    [profile],
  );

  // 맞춤 보기: 배치가 아는 테두리(판·묶음·레일·빌더)로 맞춘다. 끝없이 긴 바닥 띠는 넣지 않는다.
  // 처음(ReactFlow가 준비되면), 맞춤 단추, 패널을 접고 펼 때(폭이 바뀐 다음 프레임). 프로필을 바꾸면 index.tsx가 새로 그린다
  const fitLayout = useCallback(
    (duration: number): void => {
      const b = layout.bounds;
      detachView(
        rf.fitBounds(
          { x: b.x, y: b.y, width: b.w, height: b.h },
          { padding: FIT_PAD, duration: reduced ? 0 : duration },
        ),
      );
    },
    [layout, rf, reduced],
  );
  /**
   * 처음 보는 시점: 판의 글이 읽히는 배율(OPEN_ZOOM, 중간 단계)보다 작게 열지 않고, 내용의 위 끝을 프로필 머리 바로 아래에 붙인다.
   * 다 들어가면 가로 가운데에, 넘치면 루프가 시작하는 왼쪽(스타트 Drive, 입력 받기)부터 보이고 나머지는 옮겨 본다(맞춤 단추는 전체를 맞춘다)
   */
  const openView = useCallback((): void => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    const b = layout.bounds;
    const c = contentBox(layout) ?? b;
    const availW = box.width - OPEN_PAD.left - OPEN_PAD.right;
    const availH = box.height - OPEN_PAD.top - OPEN_PAD.bottom;
    const fitAll = Math.min(availW / b.w, availH / b.h);
    const fitContent = Math.min(availW / c.w, availH / b.h, OPEN_ZOOM_MAX);
    const z = Math.max(fitAll, Math.max(OPEN_ZOOM, fitContent));
    // 가로: 전체가 들어가면 전체를, 아니면 판들(내용)을 가운데에. 넘치면 판들의 왼쪽 끝부터
    const box2 = b.w * z <= availW ? b : c;
    const x =
      box2.w * z <= availW
        ? OPEN_PAD.left + (availW - box2.w * z) / 2 - box2.x * z
        : OPEN_PAD.left - box2.x * z;
    // 빈 프로필은 위 가운데의 안내 말 아래로 내린다
    const y = (empty ? OPEN_PAD.top + 48 : OPEN_PAD.top) - b.y * z;
    detachView(rf.setViewport({ x, y, zoom: z }, { duration: 0 }));
  }, [layout, rf, empty]);
  // 사용자가 직접 옮기거나 확대하기 전까지는 캔버스 크기가 바뀔 때마다(처음 잴 때, 패널을 접고 펼 때) 처음 시점으로 다시 맞춘다
  const autoFit = useRef(true);
  const paneW = useViewportStore((s) => s.width);
  const paneH = useViewportStore((s) => s.height);
  useEffect(() => {
    if (!autoFit.current || paneW === 0 || paneH === 0) return;
    openView();
  }, [paneW, paneH, openView]);
  const togglePalette = useCallback((): void => {
    autoFit.current = true;
    setPaletteOpen((o) => !o);
  }, []);

  const rectOf = useCallback((id: string): Rect | null => rectIn(layout, id), [layout]);

  /** 노드로 시점을 옮긴다: 플로팅 판이 가리지 않는 왼쪽 빈 자리 가운데로. 멀면 읽을 만큼 확대 */
  const glideTo = useCallback(
    (r: Rect | null, keepZoom: boolean): void => {
      const box = wrapRef.current?.getBoundingClientRect();
      if (r === null || box === undefined) return;
      autoFit.current = false;
      const free = box.width - PANEL_W - 32;
      // 판 하나는 읽을 만큼(92~105%) 키우고, 넓은 받침판은 빈 자리에 다 들어오게 줄인다
      const room = Math.min((free - 64) / r.w, (box.height - 180) / r.h);
      const z = keepZoom ? zoom : Math.max(0.4, Math.min(Math.max(zoom, 0.92), 1.05, room));
      const shift = (box.width / 2 - free / 2) / z;
      detachView(
        rf.setCenter(r.x + r.w / 2 + shift, r.y + r.h / 2, {
          zoom: z,
          duration: reduced ? 0 : 420,
        }),
      );
    },
    [zoom, rf, reduced],
  );
  const glide = useCallback(
    (id: string, keepZoom: boolean): void => glideTo(rectOf(id), keepZoom),
    [glideTo, rectOf],
  );

  /** 포커스: 접힌 묶음 안이면 먼저 펼친다(펼친 뒤 배치가 바뀌면 이어서 옮긴다) */
  const focusOn = useCallback(
    (id: string): void => {
      const p = pluginOf(id);
      const inBundle = placed.find((x) => x.plugin.name === id)?.source;
      if (p !== undefined && placed.every((x) => x.plugin.name !== id)) {
        setSelected(id);
        setSay(t("desktop.craft.canvas.cv3.say.notIn", { name: id }));
        return;
      }
      setSelected(id);
      setArrive((a) => ({ id, n: a.n + 1 }));
      setSay(t("desktop.craft.canvas.cv3.say.focused", { name: id.replace(/^bundle:/, "") }));
      if (inBundle?.type === "bundle" && store.collapsed.has(inBundle.id)) {
        // 접힌 묶음 안이면 펼치고, 펼친 배치에서의 자리로 간다
        const open = new Set([...store.collapsed].filter((b) => b !== inBundle.id));
        setCollapsed(inBundle.id, false);
        glideTo(rectIn(layoutProfile(profile, open), id), false);
        return;
      }
      glide(id, false);
    },
    [placed, store.collapsed, profile, glide, glideTo],
  );

  const selectFromCanvas = useCallback(
    (id: string): void => {
      setSelected(id);
      // 플로팅 판이 노드를 가리면 시점만 옮긴다(확대는 그대로)
      const el = wrapRef.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id.startsWith("bundle:") || id === "@builder" ? id : `p:${id}`)}"]`,
      );
      const box = wrapRef.current?.getBoundingClientRect();
      if (el === null || el === undefined || box === undefined) return;
      const r = el.getBoundingClientRect();
      const panel = {
        left: box.right - PANEL_W - 32,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      };
      if (intersects(r, panel) || r.left < box.left || r.top < box.top + 48) glide(id, true);
    },
    [glide],
  );

  const add = useCallback(
    (name: string): void => {
      const next = addPlugin(profile, name);
      if (next === profile) return;
      setProfile(next);
      setSay(t("desktop.craft.canvas.cv3.say.added", { name }));
      setSelected(name);
      setArrive((a) => ({ id: name, n: a.n + 1 }));
      glideTo(rectIn(layoutProfile(next, store.collapsed), name), false);
    },
    [profile, store.collapsed, glideTo],
  );

  const remove = useCallback(
    (name: string): void => {
      const r = removePlugin(profile, name);
      if (!r.ok) {
        setSay(
          t(
            r.reason === "base"
              ? "desktop.craft.canvas.cv3.say.baseFixed"
              : "desktop.craft.canvas.cv3.say.absent",
          ),
        );
        return;
      }
      setProfile(r.profile);
      setSelected(null);
      setSay(t("desktop.craft.canvas.cv3.say.removed", { names: r.removed.join(", ") }));
    },
    [profile],
  );

  const toggleBundle = useCallback(
    (id: string): void => {
      const next = !store.collapsed.has(id);
      setCollapsed(id, next);
      setSay(
        t(next ? "desktop.craft.canvas.cv3.say.folded" : "desktop.craft.canvas.cv3.say.unfolded", {
          name: bundleMetaOf(id).displayName,
        }),
      );
    },
    [store.collapsed],
  );

  // ── 끌기 ──
  const latest = useRef({ add, remove });
  useLayoutEffect(() => {
    latest.current = { add, remove };
  }, [add, remove]);
  const whereIs = useCallback((x: number, y: number): Drag["over"] => {
    const inRect = (r: DOMRect | undefined): boolean =>
      r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (inRect(paletteRef.current?.getBoundingClientRect())) return "palette";
    if (inRect(wrapRef.current?.getBoundingClientRect())) return "canvas";
    return "none";
  }, []);
  const startPointer = useCallback(
    (name: string, from: Drag["from"], e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      const move = (m: PointerEvent): void => {
        if (!dragging && Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
        dragging = true;
        setDrag({ name, from, x: m.clientX, y: m.clientY, over: whereIs(m.clientX, m.clientY) });
      };
      const end = (m: PointerEvent): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        if (!dragging) return;
        setDrag(null);
        const over = whereIs(m.clientX, m.clientY);
        if (from === "palette" && over === "canvas") latest.current.add(name);
        if (from === "canvas" && over === "palette") latest.current.remove(name);
      };
      const cancel = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        setDrag(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
    },
    [whereIs],
  );

  // ── 키보드 ──
  const nodeIds = useMemo(
    (): readonly { readonly id: string; readonly r: Rect }[] => [
      ...layout.plates.map((p) => ({ id: p.placed.plugin.name, r: p })),
      ...layout.bundles.filter((b) => b.collapsed).map((b) => ({ id: `bundle:${b.id}`, r: b })),
    ],
    [layout],
  );
  const focusNodeEl = (id: string): void => {
    const key = id.startsWith("bundle:") ? id : `p:${id}`;
    wrapRef.current
      ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(key)}"]`)
      ?.focus();
  };
  const onKey = (id: string, e: KeyboardEvent<HTMLElement>): void => {
    const name = id;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey && pluginOf(name) !== undefined) props.onOpen(name);
      else selectFromCanvas(name);
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && pluginOf(name) !== undefined) {
      e.preventDefault();
      remove(name);
      return;
    }
    const dirs: Readonly<Record<string, readonly [number, number]>> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const dir = dirs[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    if (
      e.altKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      pluginOf(name) !== undefined
    ) {
      const next = nudge(profile, name, e.key === "ArrowUp" ? -1 : 1);
      if (next !== profile) {
        setProfile(next);
        setSay(t("desktop.craft.canvas.cv3.say.moved", { name }));
      }
      return;
    }
    const here = nodeIds.find((n) => n.id === name);
    if (here === undefined) return;
    const hx = here.r.x + here.r.w / 2;
    const hy = here.r.y + here.r.h / 2;
    let best: string | null = null;
    let score = Number.POSITIVE_INFINITY;
    for (const n of nodeIds) {
      if (n.id === name) continue;
      const dx = n.r.x + n.r.w / 2 - hx;
      const dy = n.r.y + n.r.h / 2 - hy;
      const main = dx * dir[0] + dy * dir[1];
      if (main <= 4) continue;
      const side = Math.abs(dir[0] === 0 ? dx : dy);
      const s = main + side * 2;
      if (s < score) {
        score = s;
        best = n.id;
      }
    }
    if (best !== null) {
      focusNodeEl(best);
      glide(best, true);
    }
  };

  const actions: CanvasActions = {
    select: selectFromCanvas,
    open: props.onOpen,
    toggleBundle,
    pointerDown: (name, e) => {
      startPointer(name, "canvas", e);
    },
    key: onKey,
  };

  // ── 밝힐 것 ──
  const litRel = useMemo(() => {
    const s = new Set<number>();
    if (selected === null) return s;
    layout.relations.forEach((r, i) => {
      if (r.relation.from === selected || r.relation.to === selected) s.add(i);
      if (selected === "@builder" && r.relation.kind === "creates") s.add(i);
    });
    return s;
  }, [selected, layout]);
  const visibleRel = useMemo(() => {
    const s = new Set<number>();
    layout.relations.forEach((r, i) => {
      if (store.allRelations || r.relation.kind === "handoff" || litRel.has(i)) s.add(i);
    });
    return s;
  }, [layout, store.allRelations, litRel]);
  const related = useMemo(() => {
    const s = new Set<string>();
    for (const i of litRel) {
      const r = layout.relations[i];
      if (r === undefined) continue;
      s.add(r.relation.from);
      s.add(r.relation.to);
    }
    if (selected !== null) s.add(selected);
    return s;
  }, [litRel, layout, selected]);

  const dragTarget = useMemo(() => {
    if (drag === null || drag.from !== "palette") return null;
    const p = pluginOf(drag.name);
    if (p === undefined) return null;
    const pt = anchorPoint(layout, p.anchor);
    return pt === null ? null : { ...pt, kind: p.kind };
  }, [drag, layout]);

  // 층 순서(xyflow는 음수 zIndex를 판 아래 바닥 뒤로 보내 누를 수 없게 하므로 0부터):
  // 띠 0 · 바닥 1 · 받침판·빌더 2 · 관계 선 3 · 판·더미 4
  const nodes = useMemo((): CanvasNode[] => {
    const markOf = (id: string): Mark =>
      id === selected ? "selected" : related.has(id) ? "related" : "none";
    const b = layout.bounds;
    const list: CanvasNode[] = [
      {
        id: "pool",
        type: "pool",
        position: { x: layout.railX0 - 640, y: -POOL_HALF },
        data: { width: layout.railX1 - layout.railX0 + 1280 },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 0,
      },
      {
        id: "floor",
        type: "floor",
        position: { x: b.x - 80, y: b.y - 80 },
        data: {
          layout,
          lit: related,
          target: dragTarget,
          showCross: store.allRelations || selected !== null,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 1,
      },
      {
        id: "links",
        type: "links",
        position: { x: b.x - 80, y: b.y - 80 },
        data: { layout, visible: visibleRel, lit: litRel },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 3,
      },
    ];
    for (const g of layout.bundles) {
      const id = `bundle:${g.id}`;
      list.push({
        id,
        type: g.collapsed ? "pile" : "pedestal",
        position: { x: g.x, y: g.y },
        data: { geo: g, mark: markOf(id), arrive: arrive.id === id ? arrive.n : 0 },
        draggable: false,
        selectable: false,
        focusable: g.collapsed,
        zIndex: g.collapsed ? 4 : 2,
        ariaLabel: t("desktop.craft.canvas.cv3.a11y.bundle", {
          name: bundleMetaOf(g.id).displayName,
          n: g.members.length,
        }),
      });
    }
    for (const p of layout.plates) {
      const name = p.placed.plugin.name;
      list.push({
        id: `p:${name}`,
        type: "plate",
        position: { x: p.x, y: p.y },
        data: {
          geo: p,
          mark: markOf(name),
          arrive: arrive.id === name ? arrive.n : 0,
          dim: drag?.from === "canvas" && drag.name === name,
        },
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 4,
        ariaLabel: t("desktop.craft.canvas.cv3.a11y.plate", {
          name,
          kind: t(KIND_WORD[p.placed.plugin.kind]),
          where: "",
        }),
      });
    }
    if (layout.builder !== null) {
      list.push({
        id: "@builder",
        type: "builder",
        position: { x: layout.builder.x, y: layout.builder.y },
        data: { mark: markOf("@builder") },
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 2,
      });
    }
    return list;
  }, [layout, related, selected, arrive, drag, dragTarget, visibleRel, litRel, store.allRelations]);

  const onWrapKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains("react-flow__node")) {
      if (e.key === "Escape") setSelected(null);
      return;
    }
    const raw = e.target.getAttribute("data-id");
    if (raw === null) return;
    const id = raw.startsWith("p:") ? raw.slice(2) : raw;
    onKey(id, e);
  };

  const removeBundleById = (id: string): void => {
    setProfile(removeBundle(profile, id));
    setSelected(null);
    setSay(t("desktop.craft.canvas.cv3.say.removed", { names: bundleMetaOf(id).displayName }));
  };

  const panelActions: PanelActions = {
    close: () => {
      setSelected(null);
    },
    focus: focusOn,
    open: props.onOpen,
    remove,
    add,
    nudge: (name, delta) => {
      const next = nudge(profile, name, delta);
      if (next !== profile) setProfile(next);
    },
    setStart: (name) => {
      setProfile(setStartDrive(profile, name));
      setSay(t("desktop.craft.canvas.cv3.say.start", { name }));
    },
    toggleBundle,
    removeBundle: removeBundleById,
    testRun: (name) => {
      setSay(t("desktop.craft.canvas.cv3.say.testRun", { name }));
    },
  };

  const pendingReview = placed.filter(
    (p) => p.plugin.meta.review.state === "draft" || p.plugin.meta.pending !== null,
  ).length;
  const selectedPlaced =
    selected === null ? undefined : placed.find((p) => p.plugin.name === selected);
  const selectedBundle =
    selected !== null && selected.startsWith("bundle:")
      ? bundleList.find((b) => `bundle:${b.id}` === selected)
      : undefined;
  const dragPlugin = drag === null ? undefined : pluginOf(drag.name);

  return (
    <CanvasActionsContext value={actions}>
      {/* Esc는 어디에 포커스가 있든(목록 줄 포함) 떠 있는 상세를 닫는다 */}
      <div
        className="cv4-root flex min-h-0 flex-1"
        data-scheme={theme}
        onKeyDown={(e) => {
          if (e.key === "Escape" && selected !== null) setSelected(null);
        }}
      >
        <div ref={paletteRef} className="flex">
          <Palette
            profile={profile}
            current={store.current}
            bundles={bundleList}
            focused={selected}
            open={paletteOpen}
            onProfile={(id) => {
              updateStore((s) => ({ ...s, current: id }));
              setSelected(null);
            }}
            onPick={focusOn}
            onAdd={add}
            onRemove={remove}
            onRemoveBundle={removeBundleById}
            onPointerDown={(name, e) => {
              startPointer(name, "palette", e);
            }}
            onToggle={togglePalette}
          />
        </div>
        <div
          ref={wrapRef}
          className={`cv4-stage relative min-h-0 min-w-0 flex-1 overflow-hidden${drag?.over === "canvas" && drag.from === "palette" ? " cv4-drop" : ""}`}
          onKeyDown={onWrapKey}
        >
          <ReactFlow
            className="cv4-flow"
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable
            edgesFocusable={false}
            disableKeyboardA11y
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            zoomOnDoubleClick={false}
            minZoom={0.2}
            maxZoom={1.8}
            onMoveStart={(e) => {
              if (e !== null) autoFit.current = false;
            }}
            proOptions={{ hideAttribution: true }}
            aria-label={t("desktop.craft.canvas.cv3.canvas")}
            onPaneClick={() => {
              setSelected(null);
            }}
          />

          {/* 위 왼쪽: 프로필 머리 */}
          <div className="glass glass-shadow-3 rounded-toolbar absolute top-3 left-3 z-10 flex h-10 items-center gap-3 ps-3.5 pe-3">
            <span className="text-[13px] font-semibold text-text-primary">
              {t(
                store.current === "dev"
                  ? "desktop.craft.canvas.cv3.profile.dev"
                  : store.current === "empty"
                    ? "desktop.craft.canvas.cv3.profile.empty"
                    : store.current === "attach"
                      ? "desktop.craft.canvas.cv4.profile.attach"
                      : "desktop.craft.canvas.sample.scale",
              )}
            </span>
            <span className="text-[12px] text-text-tertiary tabular-nums">
              {t("desktop.craft.canvas.cv3.head.counts", {
                n: placed.length,
                base: profile.base.length,
                bundles: bundleList.length,
              })}
            </span>
            {profile.startDrive === null ? (
              <span className="text-[12px] text-text-tertiary">
                {t("desktop.craft.canvas.cv3.head.noStart")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <KindTile kind="drive" size={16} />
                {t("desktop.craft.canvas.cv3.head.start", { name: profile.startDrive })}
              </span>
            )}
            {pendingReview > 0 ? (
              <span className="cv4-pill cv4-pill-warn">
                {t("desktop.craft.canvas.cv3.head.review", { n: pendingReview })}
              </span>
            ) : null}
          </div>

          {/* 아래 오른쪽 도구 막대: 막대 하나만 면(caustic FloatingBar의 유리)을 갖고, 안의 단추는 전부 ghost다.
              앱의 확대 막대(`craft/finder.tsx`의 ZoomBar)와 같은 부품·크기: 관계 보기, 범례(정보), 확대·축소, 맞춤 */}
          <div className="absolute right-3 bottom-3 z-10">
            <FloatingBar label={t("desktop.craft.canvas.cv3.tool.label")} size="sm">
              <FloatingBarItem
                icon={<Icon name="links" size={16} />}
                active={store.allRelations}
                aria-label={t("desktop.craft.canvas.cv3.tool.relations")}
                title={t("desktop.craft.canvas.cv3.tool.relations")}
                onClick={() => {
                  updateStore((s) => ({ ...s, allRelations: !s.allRelations }));
                }}
              />
              <span className="grid size-control-sm place-items-center">
                <InfoTip
                  label={t("desktop.craft.canvas.cv3.legend.label")}
                  text={[
                    t("desktop.craft.canvas.cv3.legend.layers"),
                    ...REL_KINDS.map((k) => `${t(RELATION_WORD[k])}: ${t(RELATION_HINT[k])}`),
                    t("desktop.craft.canvas.cv3.legend.keys"),
                  ]}
                />
              </span>
              <FloatingBarSeparator />
              <ZoomControl
                variant="ghost"
                size="sm"
                readout="static"
                value={`${String(Math.round(zoom * 100))}%`}
                label={t("desktop.craft.canvas.cv3.tool.zoom")}
                zoomOutLabel={t("desktop.craft.canvas.cv3.tool.zoomOut")}
                zoomInLabel={t("desktop.craft.canvas.cv3.tool.zoomIn")}
                onZoomOut={() => {
                  detachView(rf.zoomOut({ duration: reduced ? 0 : 160 }));
                }}
                onZoomIn={() => {
                  detachView(rf.zoomIn({ duration: reduced ? 0 : 160 }));
                }}
              />
              <FloatingBarSeparator />
              <FloatingBarItem
                icon={<Maximize aria-hidden />}
                aria-label={t("desktop.craft.canvas.cv3.tool.fit")}
                title={t("desktop.craft.canvas.cv3.tool.fit")}
                onClick={() => {
                  autoFit.current = true;
                  fitLayout(260);
                }}
              />
            </FloatingBar>
          </div>

          {/* 관계 보기를 켜면 선의 문법을 보이게 둔다(그림 옆의 말) */}
          {store.allRelations ? (
            <div className="glass glass-shadow-3 rounded-xl absolute bottom-15 right-3 z-10 flex flex-col gap-1 px-3 py-2.5">
              {REL_KINDS.map((k) => (
                <span key={k} className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <RelationSwatch kind={k} />
                  {t(RELATION_WORD[k])}
                </span>
              ))}
            </div>
          ) : null}

          {empty ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
              <div className="glass glass-shadow-3 rounded-toolbar flex items-center gap-2 px-3.5 py-2 text-[13px] text-text-secondary">
                <Icon name="left" size={14} />
                {t("desktop.craft.canvas.cv3.empty")}
              </div>
            </div>
          ) : null}

          {selected !== null && selected.startsWith("bundle:") && selectedBundle !== undefined ? (
            <BundleDetail
              key={selected}
              id={selectedBundle.id}
              members={placed.filter(
                (p) => p.source.type === "bundle" && p.source.id === selectedBundle.id,
              )}
              collapsed={store.collapsed.has(selectedBundle.id)}
              actions={panelActions}
            />
          ) : selected === "@builder" ? (
            <BuilderDetail
              created={relations.filter((r) => r.kind === "creates").map((r) => r.to)}
              actions={panelActions}
            />
          ) : selected !== null && pluginOf(selected) !== undefined ? (
            <PluginDetail
              key={selected}
              name={selected}
              profile={profile}
              placed={selectedPlaced}
              actions={panelActions}
            />
          ) : null}

          {drag?.from === "canvas" ? (
            <div className="pointer-events-none absolute top-16 left-3 z-20 glass glass-shadow-3 rounded-xl px-3 py-2 text-[12.5px] text-text-secondary">
              {t("desktop.craft.canvas.cv3.say.dropToRemove")}
            </div>
          ) : null}
        </div>
        {drag !== null && dragPlugin !== undefined ? (
          <div
            className="cv4-ghost cv4-chrome pointer-events-none fixed top-0 left-0 z-50 flex h-9 items-center gap-2 px-2.5"
            style={{ transform: `translate(${String(drag.x + 12)}px, ${String(drag.y + 10)}px)` }}
          >
            <KindTile kind={dragPlugin.kind} size={20} />
            <span className="text-[13px] text-text-primary">{dragPlugin.name}</span>
            <span className="text-[11.5px]" style={{ color: KIND_COLOR[dragPlugin.kind] }}>
              {t(KIND_WORD[dragPlugin.kind])}
            </span>
          </div>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {say}
        </div>
      </div>
    </CanvasActionsContext>
  );
}
