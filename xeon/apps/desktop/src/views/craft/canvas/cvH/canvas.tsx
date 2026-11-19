// cvH "선로" 프로필 캔버스. 무늬 없는 면 위에 코어 루프가 굵은 본선으로 가로지르고, 플러그인은 종류마다 다르게 갈라진 지선 끝의 역 표지판이다.
// 왼쪽 목록에서 줄을 누르면 캔버스가 그 노드로 부드럽게 옮겨 가 가운데에 놓고(필요하면 확대) 한 번 밝힌 뒤 키보드 초점을 준다.
// 노드를 누르면(Enter도) 큰 플로팅 패널이 노드 반대편에 뜬다. 두 번 누르거나 패널의 "안으로"로 플러그인 내부에 들어간다.
// 쉴 때 도는 것이 없다: 시점 이동과 밝힘 한 번만 움직이고 끝나면 멈춘다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewportStore,
  type FitViewOptions,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { InfoTip } from "../../info-tip.tsx";
import { useCraftTheme } from "../../orbit.tsx";
import type { SharedProfileId } from "../shared-sample.ts";
import { relationsFor } from "./facts.ts";
import { Glyph, KIND_COLOR, KindBadge } from "./glyphs.tsx";
import { PluginInside } from "./inside.tsx";
import {
  addGroup,
  addPlugin,
  CARD_H,
  CARD_W,
  entriesOf,
  focusRect,
  groupOfMember,
  hasPlugin,
  isBlock,
  layoutProfile,
  movePlugin,
  PILL_HALF,
  pluginOf,
  relationsOf,
  removeGroup,
  removePlugin,
  setStartDrive,
  type CanvasProfile,
  type Kind,
  type Layout,
} from "./model.ts";
import {
  CanvasActionsContext,
  CROSSING_BOX,
  NODE_TYPES,
  QUIET_BOX,
  STATION_BOX,
  cardLabel,
  type CanvasActions,
  type CanvasNode,
} from "./nodes.tsx";
import { Palette, PALETTE_W, RAIL_W } from "./palette.tsx";
import { GroupPanel, PANEL_W, PluginPanel, type PanelActions } from "./panel.tsx";
import { DRAFT_SOURCE, extOf } from "./sample-ext.ts";
import {
  chooseProfile,
  currentProfile,
  INSTALLED_GROUPS,
  setProfile,
  toggleFold,
  toggleRelations,
  unfold,
  useCanvasStore,
} from "./store.ts";
import { PROFILE_WORD } from "./words.ts";

const PROFILES: readonly SharedProfileId[] = ["dev", "scale", "empty"];
/** 이보다 좁은 창에서는 목록을 배지 막대로 접은 채 연다 */
const WIDE_ENOUGH = 1280;
/** 패널에서 고른 노드로 옮길 때 이 배율보다 작으면 이 배율까지 당긴다(가까이 단계) */
const FOCUS_ZOOM = 0.92;

function detachView(work: Promise<boolean>): void {
  detach(work, rethrow);
}

interface Spot {
  readonly key: string;
  readonly n: number;
}

/** 방향키로 갈 다음 카드: 그 방향의 카드 가운데 주축 거리 + 옆축 거리×2가 가장 작은 것 */
function nextCard(
  layout: Layout,
  from: string,
  dir: "up" | "down" | "left" | "right",
): string | null {
  const centres = layout.cards.map((c) => ({
    key: c.name,
    x: c.rect.x + c.rect.w / 2,
    y: c.rect.y + c.rect.h / 2,
  }));
  const here = centres.find((n) => n.key === from);
  if (here === undefined) return centres[0]?.key ?? null;
  let best: string | null = null;
  let score = Number.POSITIVE_INFINITY;
  for (const n of centres) {
    if (n.key === from) continue;
    const dx = n.x - here.x;
    const dy = n.y - here.y;
    const main = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    const side = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    if (main <= 2) continue;
    const s = main + side * 2;
    if (s < score) {
      score = s;
      best = n.key;
    }
  }
  return best;
}

const ARROWS: Readonly<Record<string, "up" | "down" | "left" | "right">> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** 빈 자리: 프로필에 그 종류가 하나도 없을 때 지선 끝에 점선 자리를 둔다 */
function sockets(layout: Layout, profile: CanvasProfile): CanvasNode[] {
  const kinds = new Set(entriesOf(profile).map((n) => pluginOf(n)?.kind));
  const xOf = (id: string): number => layout.stations.find((s) => s.id === id)?.x ?? 0;
  const want: readonly { readonly kind: Kind; readonly x: number; readonly y: number }[] = [
    { kind: "inject", x: xOf("context") - PILL_HALF - 46 + 13, y: -(92 + 18 + CARD_H / 2) },
    { kind: "tool", x: xOf("tools") + PILL_HALF + 46 + 13, y: -(92 + 18 + CARD_H / 2) },
    { kind: "drive", x: xOf("input-received") + 13, y: 92 + 18 },
  ];
  return want
    .filter((w) => !kinds.has(w.kind))
    .map((w) => ({
      id: `socket:${w.kind}`,
      type: "socket",
      position: { x: w.x, y: w.y },
      width: CARD_W,
      height: CARD_H / 2,
      data: { kind: w.kind },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 2,
    }));
}

function buildNodes(
  layout: Layout,
  profile: CanvasProfile,
  selected: string | null,
  spot: Spot | null,
  showAll: boolean,
): CanvasNode[] {
  const hot = selected === null ? null : hotSet(profile, selected);
  const nodes: CanvasNode[] = [
    {
      id: "rails",
      type: "rails",
      position: { x: layout.bounds.x, y: layout.bounds.y },
      width: layout.bounds.w,
      height: layout.bounds.h,
      data: { rails: layout.rails, bounds: layout.bounds, hot },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
    },
    {
      id: "relations",
      type: "relations",
      position: { x: layout.bounds.x, y: layout.bounds.y },
      width: layout.bounds.w,
      height: layout.bounds.h,
      data: { relations: layout.relations, bounds: layout.bounds, hot, showAll },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 1,
    },
  ];
  layout.stations.forEach((s, i) => {
    const block = isBlock(s.id);
    const box = block ? (s.used ? STATION_BOX : QUIET_BOX) : CROSSING_BOX;
    nodes.push({
      id: `station:${s.id}`,
      type: "station",
      position: { x: s.x - box.w / 2, y: -box.h / 2 },
      width: box.w,
      height: box.h,
      data: {
        slot: s.id,
        index: layout.stations.slice(0, i + 1).filter((x) => isBlock(x.id)).length,
        used: s.used,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 3,
    });
  });
  for (const g of layout.groups) {
    nodes.push({
      id: `group:${g.id}`,
      type: "group",
      position: { x: g.rect.x, y: g.rect.y },
      width: g.rect.w,
      height: g.rect.h,
      data: {
        id: g.id,
        members: g.members,
        folded: g.folded,
        selected: selected === `group:${g.id}`,
        spot: spot?.key === `group:${g.id}` ? spot.n : 0,
      },
      draggable: false,
      selectable: false,
      zIndex: 3,
      ariaLabel: t("desktop.craft.canvas.cvH.group.aria", { name: g.id, count: g.members.length }),
    });
  }
  for (const c of layout.cards) {
    const parent = c.group === null ? undefined : layout.groups.find((g) => g.id === c.group);
    const rels = relationsFor(profile, c.name);
    const unmet = rels.find((r) => r.kind === "depends" && r.unmet && r.from === c.name);
    nodes.push({
      id: c.name,
      type: "plugin",
      position:
        parent === undefined
          ? { x: c.rect.x, y: c.rect.y }
          : { x: c.rect.x - parent.rect.x, y: c.rect.y - parent.rect.y },
      ...(parent === undefined
        ? {}
        : { parentId: `group:${parent.id}`, extent: "parent" as const }),
      width: c.rect.w,
      height: c.rect.h,
      data: {
        name: c.name,
        marks: {
          base: profile.base.includes(c.name),
          start: profile.startDrive === c.name,
          order: c.order,
          group: c.group,
          relations: rels.length,
          unmet:
            unmet === undefined
              ? null
              : t("desktop.craft.canvas.cvH.mark.unmet", { capability: unmet.via ?? "" }),
        },
        selected: selected === c.name,
        spot: spot?.key === c.name ? spot.n : 0,
      },
      draggable: false,
      selectable: false,
      zIndex: 4,
      ariaLabel: cardLabel(c.name),
    });
  }
  for (const s of layout.seeds) {
    nodes.push({
      id: s.key,
      type: "seed",
      position: { x: s.rect.x, y: s.rect.y },
      width: s.rect.w,
      height: s.rect.h,
      data: { threadId: s.threadId, tool: DRAFT_SOURCE.tool },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 4,
    });
  }
  for (const p of layout.parts) {
    nodes.push({
      id: `part:${p.part}`,
      type: "part",
      position: { x: p.x - 28, y: p.y - 10 },
      width: 64,
      height: 20,
      data: { part: p },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 5,
    });
  }
  nodes.push(...sockets(layout, profile));
  return nodes;
}

/** 고른 노드와 그 관계 상대들(선을 밝힌다) */
function hotSet(profile: CanvasProfile, key: string): ReadonlySet<string> {
  const out = new Set<string>([key]);
  if (key.startsWith("group:")) {
    const g = profile.groups.find((x) => `group:${x.id}` === key);
    for (const m of g?.members ?? []) out.add(m);
    return out;
  }
  for (const r of relationsFor(profile, key)) {
    out.add(r.from.replace("seed:", ""));
    if (r.to !== null) out.add(r.to);
  }
  return out;
}

interface Drag {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly moved: boolean;
}

function Board(props: { readonly onEnter: (name: string) => void }): ReactElement {
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const theme = useCraftTheme();
  const reduced = useMotionReduced();
  const rf = useReactFlow();
  const zoom = useViewportStore((s) => Math.round(s.transform[2] * 100));
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth >= WIDE_ENOUGH);
  const [selected, setSelected] = useState<string | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [legend, setLegend] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState("");
  const [panelSide, setPanelSide] = useState<"left" | "right">("right");
  const wrap = useRef<HTMLDivElement>(null);
  const inset = paletteOpen ? PALETTE_W : RAIL_W;

  const layout = useMemo(
    () => layoutProfile({ profile, folded: store.folded }),
    [profile, store.folded],
  );
  const nodes = useMemo(
    () => buildNodes(layout, profile, selected, spot, store.relations),
    [layout, profile, selected, spot, store.relations],
  );

  const fitOptions = useMemo(
    (): FitViewOptions => ({
      padding: {
        top: "64px",
        left: inset === PALETTE_W ? "276px" : "64px",
        right: "40px",
        bottom: "64px",
      },
      maxZoom: 1,
      minZoom: 0.3,
    }),
    [inset],
  );
  const fit = useCallback(
    (animate: boolean): void => {
      detachView(rf.fitView({ ...fitOptions, duration: animate && !reduced ? 260 : 0 }));
    },
    [rf, fitOptions, reduced],
  );
  // 목록을 접고 펼 때 화면에 맞춘다(처음과 프로필을 바꿀 때는 React Flow를 새로 띄우며 맞춘다)
  useEffect(() => {
    fit(false);
  }, [fit]);

  /** 흐름 좌표의 상자를 보이는 칸(목록 오른쪽)의 가운데로 */
  const centreOn = useCallback(
    (
      rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
      minZoom: number,
    ): number => {
      const z = Math.max(rf.getZoom(), minZoom);
      const box = wrap.current?.getBoundingClientRect();
      const shift = inset / 2 / z;
      detachView(
        rf.setCenter(rect.x + rect.w / 2 - shift, rect.y + rect.h / 2, {
          zoom: z,
          duration: reduced ? 0 : 520,
        }),
      );
      return box === undefined ? 0 : box.width;
    },
    [rf, inset, reduced],
  );

  /** 목록에서 고른 것을 캔버스에서 찾아 그리로 간다. 프로필에 없으면 상세 패널을 연다 */
  const focusOn = useCallback(
    (key: string): void => {
      setFocused(key);
      const name = key.replace("group:", "");
      const isGroup = key.startsWith("group:");
      const group = isGroup
        ? profile.groups.find((g) => g.id === name)
        : groupOfMember(profile.groups, key);
      if (!isGroup && !hasPlugin(profile, key)) {
        setSelected(key);
        setPanelSide("right");
        setAnnounce(t("desktop.craft.canvas.cvH.announce.notIn", { name: key }));
        return;
      }
      if (isGroup && group === undefined) {
        setAnnounce(t("desktop.craft.canvas.cvH.announce.notIn", { name }));
        return;
      }
      // 접힌 묶음의 구성원이면 묶음을 펴고, 편 배치에서 자리를 구한다
      let folded = store.folded;
      if (!isGroup && group !== undefined && folded.has(group.id)) {
        unfold(group.id);
        const next = new Set(folded);
        next.delete(group.id);
        folded = next;
      }
      const rect = focusRect(layoutProfile({ profile, folded }), key);
      if (rect === undefined) return;
      centreOn(rect, isGroup ? 0.7 : FOCUS_ZOOM);
      setSpot((s) => ({ key, n: (s?.n ?? 0) + 1 }));
      setAnnounce(t("desktop.craft.canvas.cvH.announce.focus", { name: key }));
      // 이동이 끝난 뒤 키보드 초점을 노드로 옮긴다(Enter로 패널, 방향키로 이웃)
      window.setTimeout(
        () => {
          const el = wrap.current?.querySelector<HTMLElement>(
            `.react-flow__node[data-id="${CSS.escape(key)}"]`,
          );
          el?.focus({ preventScroll: true });
        },
        reduced ? 0 : 540,
      );
    },
    [profile, store.folded, centreOn, reduced],
  );

  const select = useCallback(
    (key: string): void => {
      setSelected(key);
      setFocused(key);
      const el = wrap.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(key)}"]`,
      );
      const box = wrap.current?.getBoundingClientRect();
      if (el !== undefined && el !== null && box !== undefined) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - box.left;
        // 노드가 보이는 칸의 오른쪽 절반에 있으면 패널은 왼쪽에(목록 옆), 아니면 오른쪽에
        const side = cx > inset + (box.width - inset) / 2 ? "left" : "right";
        setPanelSide(side);
        // 패널이 노드를 덮으면 노드를 패널 밖 칸의 가운데로 옮긴다
        const panelLeft = side === "right" ? box.width - 16 - PANEL_W : inset + 16;
        const panelRight = panelLeft + PANEL_W;
        if (r.right - box.left > panelLeft && r.left - box.left < panelRight) {
          const free =
            side === "right" ? { a: inset, b: panelLeft } : { a: panelRight, b: box.width };
          const z = rf.getZoom();
          const vp = rf.getViewport();
          const want = (free.a + free.b) / 2;
          detachView(
            rf.setViewport(
              { x: vp.x + (want - cx), y: vp.y, zoom: z },
              { duration: reduced ? 0 : 300 },
            ),
          );
        }
      }
    },
    [inset, rf, reduced],
  );

  const change = useCallback((next: CanvasProfile, message: string): void => {
    setProfile(next);
    setAnnounce(message);
  }, []);

  const panelActions: PanelActions = useMemo(
    () => ({
      close: () => {
        setSelected(null);
      },
      focus: focusOn,
      enter: props.onEnter,
      remove: (name) => {
        const r = removePlugin(profile, name);
        if (r.ok) {
          change(r.profile, t("desktop.craft.canvas.cvH.announce.removed", { name }));
          setSelected(null);
        }
      },
      removeGroup: (id) => {
        change(
          removeGroup(profile, id),
          t("desktop.craft.canvas.cvH.announce.removed", { name: id }),
        );
        setSelected(null);
      },
      add: (name) => {
        change(
          addPlugin(profile, name, INSTALLED_GROUPS),
          t("desktop.craft.canvas.cvH.announce.added", { name }),
        );
        window.setTimeout(() => {
          focusOn(name);
        }, 0);
      },
      move: (name, dir) => {
        change(
          movePlugin(profile, name, dir),
          t("desktop.craft.canvas.cvH.announce.moved", { name }),
        );
      },
      setStart: (name) => {
        change(
          setStartDrive(profile, name),
          t("desktop.craft.canvas.cvH.announce.start", { name }),
        );
      },
      toggleFold,
    }),
    [profile, change, focusOn, props.onEnter],
  );

  const canvasActions: CanvasActions = useMemo(
    () => ({ select, enter: props.onEnter, toggleFold }),
    [select, props.onEnter],
  );

  // 끌어 넣기: 목록 줄에서 5px 넘게 움직이면 끌기가 된다. 캔버스 위에서 놓으면 넣는다(자리는 종류가 정한다)
  const startDrag = useCallback(
    (name: string, e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let moved = false;
      const move = (ev: PointerEvent): void => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        moved = true;
        setDrag({ name, x: ev.clientX, y: ev.clientY, moved });
      };
      const up = (ev: PointerEvent): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDrag(null);
        if (!moved) return;
        const box = wrap.current?.getBoundingClientRect();
        if (
          box !== undefined &&
          ev.clientX > box.left + inset &&
          ev.clientX < box.right &&
          ev.clientY > box.top &&
          ev.clientY < box.bottom
        ) {
          panelActions.add(name);
        }
        // 끌기 끝의 click이 줄 누르기(포커스)로 번지지 않게 한 번 막는다
        window.addEventListener(
          "click",
          (c) => {
            c.stopPropagation();
            c.preventDefault();
          },
          { capture: true, once: true },
        );
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [inset, panelActions],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const target =
      e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".react-flow__node") : null;
    const id = target?.dataset.id;
    if (e.key === "Escape" && selected !== null) {
      setSelected(null);
      return;
    }
    if (id === undefined) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      select(id);
      return;
    }
    if (e.key === "Enter" && e.shiftKey && pluginOf(id) !== undefined) {
      e.preventDefault();
      props.onEnter(id);
      return;
    }
    const dir = ARROWS[e.key];
    if (dir !== undefined) {
      e.preventDefault();
      const next = nextCard(layout, id, dir);
      if (next !== null) focusOn(next);
    }
  };

  const entries = entriesOf(profile);
  const drafts = entries.filter((n) => extOf(n)?.review === "draft").length;
  // 접힌 묶음 안의 것도 센다(선은 묶음 역으로 모여도 경고는 남는다)
  const unmet = relationsOf(profile).filter((r) => r.unmet).length;
  const selectedGroup = selected?.startsWith("group:") === true ? selected.slice(6) : null;

  return (
    <CanvasActionsContext value={canvasActions}>
      <div
        ref={wrap}
        className="cvh-root relative min-h-0 flex-1 overflow-hidden"
        data-scheme={theme}
        onKeyDown={onKeyDown}
      >
        <ReactFlow
          key={store.current}
          className="cvh-flow"
          fitView
          fitViewOptions={fitOptions}
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
          minZoom={0.25}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          aria-label={t("desktop.craft.canvas.cvH.canvas.label", {
            profile: t(PROFILE_WORD[store.current]),
          })}
          onPaneClick={() => {
            setSelected(null);
          }}
          onNodeClick={(_, node) => {
            if (node.type === "plugin" || node.type === "group") select(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            if (node.type === "plugin") props.onEnter(node.id);
          }}
        />

        {/* 위: 지금 보는 프로필과 경고(보이게) */}
        <div
          className="pointer-events-none absolute top-3 z-10 flex items-center gap-2"
          style={{ left: inset + 16 }}
        >
          <div className="cvh-float pointer-events-auto flex h-9 items-center gap-2.5 rounded-[10px] px-3 shadow-none">
            <span className="text-[11px] text-[var(--cvh-ink-3)]">
              {t("desktop.craft.canvas.cvH.palette.profile")}
            </span>
            <span className="text-[13px] font-medium text-[var(--cvh-ink)]">
              {t(PROFILE_WORD[store.current])}
            </span>
            <span className="text-[12px] text-[var(--cvh-ink-3)]">
              {t("desktop.craft.canvas.cvH.head.counts", {
                plugins: entries.length,
                groups: profile.groups.length,
              })}
            </span>
          </div>
          {drafts > 0 && (
            <span className="cvh-float pointer-events-auto flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[12px] text-[var(--cs-color-warning-text)] shadow-none">
              {t("desktop.craft.canvas.cvH.head.drafts", { count: drafts })}
            </span>
          )}
          {unmet > 0 && (
            <span className="cvh-float pointer-events-auto flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[12px] text-[var(--cs-color-warning-text)] shadow-none">
              <Glyph name="warn" size={12} />
              {t("desktop.craft.canvas.cvH.head.unmet", { count: unmet })}
            </span>
          )}
        </div>

        <Palette
          profile={profile}
          profiles={PROFILES}
          scene={store.current}
          onProfile={(id) => {
            setSelected(null);
            chooseProfile(id);
          }}
          open={paletteOpen}
          onToggle={() => {
            setPaletteOpen((o) => !o);
          }}
          focused={focused}
          onPick={focusOn}
          onAdd={panelActions.add}
          onAddGroup={(id) => {
            const g = INSTALLED_GROUPS.find((x) => x.id === id);
            if (g === undefined) return;
            change(
              addGroup(profile, g),
              t("desktop.craft.canvas.cvH.announce.added", { name: id }),
            );
            window.setTimeout(() => {
              focusOn(`group:${id}`);
            }, 0);
          }}
          onPointerDown={startDrag}
        />

        {selected !== null && selectedGroup === null && (
          <PluginPanel
            key={selected}
            name={selected}
            profile={profile}
            side={panelSide}
            inset={inset}
            actions={panelActions}
          />
        )}
        {selectedGroup !== null && (
          <GroupPanel
            key={selected}
            id={selectedGroup}
            profile={profile}
            folded={store.folded.has(selectedGroup)}
            side={panelSide}
            inset={inset}
            actions={panelActions}
          />
        )}

        {/* 아래 오른쪽: 확대, 맞춤, 관계 선, 범례 */}
        <div className="absolute right-4 bottom-4 z-10 flex flex-col items-end gap-2">
          {legend && <Legend />}
          <div className="cvh-float flex items-center gap-0.5 rounded-[10px] p-1 shadow-none">
            <button
              type="button"
              className="cvh-icon-btn"
              aria-pressed={store.relations}
              aria-label={t("desktop.craft.canvas.cvH.tool.relations")}
              title={t("desktop.craft.canvas.cvH.tool.relations")}
              onClick={toggleRelations}
            >
              <Glyph name="relations" size={14} />
            </button>
            <button
              type="button"
              className="cvh-icon-btn"
              aria-pressed={legend}
              aria-label={t("desktop.craft.canvas.cvH.tool.legend")}
              title={t("desktop.craft.canvas.cvH.tool.legend")}
              onClick={() => {
                setLegend((l) => !l);
              }}
            >
              <Glyph name="doc" size={14} />
            </button>
            <span className="mx-1 h-4 w-px bg-[var(--cvh-hair)]" />
            <button
              type="button"
              className="cvh-icon-btn"
              aria-label={t("desktop.craft.canvas.cvH.tool.zoomOut")}
              onClick={() => {
                detachView(rf.zoomOut({ duration: reduced ? 0 : 160 }));
              }}
            >
              <Glyph name="minus" size={13} />
            </button>
            <span
              className="cvh-mono w-11 text-center text-[11px] text-[var(--cvh-ink-3)] tabular-nums"
              aria-live="off"
            >
              {zoom}%
            </span>
            <button
              type="button"
              className="cvh-icon-btn"
              aria-label={t("desktop.craft.canvas.cvH.tool.zoomIn")}
              onClick={() => {
                detachView(rf.zoomIn({ duration: reduced ? 0 : 160 }));
              }}
            >
              <Glyph name="plus" size={13} />
            </button>
            <button
              type="button"
              className="cvh-icon-btn"
              aria-label={t("desktop.craft.canvas.cvH.tool.fit")}
              title={t("desktop.craft.canvas.cvH.tool.fit")}
              onClick={() => {
                fit(true);
              }}
            >
              <Glyph name="fit" size={13} />
            </button>
          </div>
        </div>

        {drag?.moved === true && (
          <div
            className="cvh-float pointer-events-none fixed z-50 flex items-center gap-2 rounded-[10px] px-2.5 py-1.5"
            style={{ left: drag.x + 12, top: drag.y + 10 }}
          >
            {(() => {
              const p = pluginOf(drag.name);
              return p === undefined ? null : <KindBadge kind={p.kind} size={18} />;
            })()}
            <span className="cvh-mono text-[12px] text-[var(--cvh-ink)]">{drag.name}</span>
          </div>
        )}
        <div className="sr-only" aria-live="polite">
          {announce}
        </div>
      </div>
    </CanvasActionsContext>
  );
}

/** 범례: 선의 문법. 본선, 종류마다의 갈림, 관계 선 */
function legendRow(svg: ReactElement, text: string): ReactElement {
  return (
    <li className="flex items-center gap-3 text-[12px] text-[var(--cvh-ink-2)]">
      <svg width={64} height={22} viewBox="0 0 64 22" aria-hidden="true" className="shrink-0">
        {svg}
      </svg>
      {text}
    </li>
  );
}

const k = (kind: Kind): string => KIND_COLOR[kind];

function Legend(): ReactElement {
  return (
    <div
      className="cvh-float w-[300px] rounded-[12px] p-3.5"
      role="note"
      aria-label={t("desktop.craft.canvas.cvH.tool.legend")}
    >
      <div className="mb-2 flex items-center gap-1 text-[12px] font-medium text-[var(--cvh-ink-3)]">
        {t("desktop.craft.canvas.cvH.legend.lines")}
        <InfoTip text={t("desktop.craft.canvas.cvH.legend.info")} />
      </div>
      <ul className="flex flex-col gap-1.5">
        {legendRow(
          <path d="M2 11h60" stroke="var(--cvh-rail)" strokeWidth={6} strokeLinecap="round" />,
          t("desktop.craft.canvas.cvH.legend.trunk"),
        )}
        {legendRow(
          <>
            <path d="M2 16h60" stroke="var(--cvh-rail-soft)" strokeWidth={3} />
            <path d="M18 2v6c0 5 4 8 12 8" stroke={k("inject")} strokeWidth={2.5} fill="none" />
          </>,
          t("desktop.craft.canvas.cvH.branch.inject"),
        )}
        {legendRow(
          <>
            <path d="M2 11h60" stroke="var(--cvh-rail-soft)" strokeWidth={3} />
            <path d="M32 3v18" stroke={k("hook")} strokeWidth={2.5} />
            <rect
              x={28}
              y={7}
              width={8}
              height={8}
              transform="rotate(45 32 11)"
              fill="var(--cvh-ground)"
              stroke={k("hook")}
              strokeWidth={1.5}
            />
          </>,
          t("desktop.craft.canvas.cvH.branch.hook"),
        )}
        {legendRow(
          <>
            <path d="M2 4h60" stroke="var(--cvh-rail-soft)" strokeWidth={3} />
            <path
              d="M32 4v4a5 5 0 1 0 0.1 0M32 13v8"
              stroke={k("drive")}
              strokeWidth={2.5}
              fill="none"
            />
          </>,
          t("desktop.craft.canvas.cvH.branch.drive"),
        )}
        {legendRow(
          <>
            <path d="M2 18h60" stroke="var(--cvh-rail-soft)" strokeWidth={3} />
            <path
              d="M16 18c8 0 14-2 14-8V3M26 4h8"
              stroke={k("tool")}
              strokeWidth={2.5}
              fill="none"
            />
          </>,
          t("desktop.craft.canvas.cvH.branch.tool"),
        )}
        {legendRow(
          <path d="M4 15Q32 0 60 11" className="cvh-rel" data-kind="handoff" />,
          t("desktop.craft.canvas.cvH.rel.handoff"),
        )}
        {legendRow(
          <path d="M4 15Q32 0 60 11" className="cvh-rel" data-kind="depends" />,
          t("desktop.craft.canvas.cvH.rel.depends"),
        )}
        {legendRow(
          <path d="M4 15Q32 0 60 11" className="cvh-rel" data-kind="replaces" />,
          t("desktop.craft.canvas.cvH.rel.replaces"),
        )}
        {legendRow(
          <path d="M4 15Q32 0 60 11" className="cvh-rel" data-kind="creates" />,
          t("desktop.craft.canvas.cvH.rel.creates"),
        )}
        {legendRow(
          <rect
            x={6}
            y={3}
            width={52}
            height={16}
            rx={6}
            fill="none"
            stroke="var(--cvh-rail-soft)"
            strokeWidth={2}
          />,
          t("desktop.craft.canvas.cvH.rel.owns"),
        )}
      </ul>
    </div>
  );
}

/** 프로필 캔버스와 플러그인 내부를 오가는 화면 하나. 돌아오면 보던 시점을 되살린다 */
export function ProfileCanvas(): ReactElement {
  const [inside, setInside] = useState<string | null>(null);
  if (inside !== null)
    return (
      <PluginInside
        key={inside}
        name={inside}
        onBack={() => {
          setInside(null);
        }}
        onOpen={setInside}
      />
    );
  return (
    <ReactFlowProvider>
      <Board onEnter={setInside} />
    </ReactFlowProvider>
  );
}
