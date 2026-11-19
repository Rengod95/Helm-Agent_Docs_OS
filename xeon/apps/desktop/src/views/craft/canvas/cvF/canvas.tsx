// cvF 프로필 캔버스("도면"): 왼쪽 판(cvD 바탕), 가로 레일 캔버스(React Flow), 떠 있는 상세 판, 오른쪽 아래 표제란(축척·관계·리뷰 대기).
// 왼쪽 판에서 플러그인을 누르면 캔버스가 그 노드로 부드럽게 움직여(필요하면 확대) 가운데 두고 한 번 빛낸다. 접힌 묶음 안이면 먼저 편다.
// 상세 판이 노드를 가리면 노드를 판 밖 가운데로 옮긴다. 쉬는 동안은 아무것도 돌지 않는다(확대 단계는 시점이 바뀔 때만 뿌리 속성 하나를 바꾼다).
// 키보드: 노드에서 Enter = 상세 판, Shift+Enter = 안으로, Delete = 빼기, Escape = 닫기. 왼쪽 판 줄에서 Enter = 그 노드로.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { IconButton } from "@caustic/react";
import { Maximize, Minus, Plus } from "@caustic/react/icons";
import {
  ConnectionMode,
  ReactFlow,
  useOnViewportChange,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { InfoTip } from "../../info-tip.tsx";
import { useCraftTheme } from "../../orbit.tsx";
import { initialScene, type SharedProfileId } from "../shared-sample.ts";
import { EDGE_TYPES, type RelationEdge, type RelationKind } from "./edges.tsx";
import { KIND_COLOR, KindGlyph, RelationMarkers, kindVars } from "./glyphs.tsx";
import { CARD_H, CARD_W, layoutProfile, type Layout } from "./layout.ts";
import {
  CATALOG,
  PROFILES,
  addGroup,
  addPlugin,
  groupIn,
  inProfile,
  installedOf,
  move,
  moveInGroup,
  namesOf,
  relationsOf,
  removeGroup,
  removePlugin,
  sourceOf,
  spotOrder,
  type Edit,
  type Kind,
  type Profile,
} from "./model.ts";
import { CanvasActionsContext, NODE_TYPES, type CanvasActions, type CanvasNode } from "./nodes.tsx";
import { Palette, type ProfileChoice } from "./palette.tsx";
import { PANEL_INSET, PANEL_W, PluginPanel, ZonePanel, type PanelActions } from "./panel.tsx";
import { groupExtOf } from "./sample-ext.ts";
import { KIND_WORD, SPOT_WORD } from "./words.ts";

const PALETTE_W = 256;
const FOCUS_ZOOM = 1;
/** 화면 맞춤: 왼쪽 판(256)과 위 범례, 아래 표제란을 피한다 */
const FIT_PADDING = { top: "60px", left: "276px", right: "28px", bottom: "92px" } as const;
const LOD_NEAR = 0.8;
const LOD_FAR = 0.42;

function lodOf(zoom: number): "near" | "mid" | "far" {
  if (zoom >= LOD_NEAR) return "near";
  if (zoom >= LOD_FAR) return "mid";
  return "far";
}

const CHOICES: readonly { readonly id: SharedProfileId; readonly name: () => string }[] = [
  { id: "dev", name: () => t("desktop.craft.canvas.cvF.profile.dev") },
  { id: "empty", name: () => t("desktop.craft.canvas.cvF.profile.empty") },
  { id: "scale", name: () => t("desktop.craft.canvas.sample.scale") },
];

function isProfileId(id: string): id is SharedProfileId {
  return id === "dev" || id === "empty" || id === "scale";
}

/** 노드의 흐름 좌표 상자 */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function rectOf(layout: Layout, id: string): Rect | null {
  if (id.startsWith("zone:")) {
    const z = layout.zones.find((x) => `zone:${x.id}` === id);
    return z === undefined ? null : { x: z.x, y: z.y, w: z.w, h: z.h };
  }
  const c = layout.cards.find((x) => x.name === id);
  return c === undefined ? null : { x: c.x, y: c.y, w: CARD_W, h: CARD_H };
}

/** 관계 선이 닿는 쪽: 가로로 멀면 옆, 세로로 멀면 위·아래 */
function sidesOf(a: Rect, b: Rect): readonly [string, string] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return dx > 0 ? ["r", "l"] : ["l", "r"];
  return dy > 0 ? ["b", "t"] : ["t", "b"];
}

export function ProfileCanvas(props: { readonly onOpen: (name: string) => void }): ReactNode {
  const rf = useReactFlow<CanvasNode, RelationEdge>();
  const theme = useCraftTheme();
  const reduced = useMotionReduced();
  const [scene, setScene] = useState<SharedProfileId>(initialScene);
  const [edits, setEdits] = useState<ReadonlyMap<SharedProfileId, Profile>>(new Map());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{ readonly id: string; readonly n: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [relations, setRelations] = useState(true);
  const [say, setSay] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  const profile = edits.get(scene) ?? PROFILES[scene];
  const installed = useMemo(() => installedOf(profile), [profile]);
  const layout = useMemo(() => layoutProfile(profile, CATALOG, collapsed), [profile, collapsed]);
  const choices = useMemo(
    (): readonly ProfileChoice[] => CHOICES.map((c) => ({ id: c.id, name: c.name() })),
    [],
  );

  // ── 시점: 확대 단계(LOD)와 축척 표시는 렌더 없이 DOM 속성 하나로 ──
  const showViewport = useCallback((v: Viewport): void => {
    const el = wrap.current;
    if (el !== null) {
      const lod = lodOf(v.zoom);
      if (el.dataset["lod"] !== lod) el.dataset["lod"] = lod;
    }
    const scale = el?.querySelector("[data-cvf-scale]");
    if (scale !== null && scale !== undefined)
      scale.textContent = `${String(Math.round(v.zoom * 100))}%`;
  }, []);
  useOnViewportChange({ onChange: showViewport, onEnd: showViewport });

  const fit = useCallback(
    (duration: number): void => {
      detach(
        rf.fitView({ padding: FIT_PADDING, maxZoom: 1.1, minZoom: 0.3, duration }).then((ok) => {
          showViewport(rf.getViewport());
          return ok;
        }),
        rethrow,
      );
    },
    [rf, showViewport],
  );
  // 처음 그릴 때 맞춘다. 장면을 바꿀 때는 고르는 곳에서 맞춘다(같은 장면 안의 편집은 시점을 그대로 둔다)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fit(0);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [fit]);

  /** 화면 안에서 노드를 놓을 곳: 왼쪽 판과 상세 판을 뺀 가운데 */
  const visibleCenter = useCallback(
    (withPanel: boolean): { readonly x: number; readonly y: number } | null => {
      const el = wrap.current;
      if (el === null) return null;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const right = withPanel ? w - PANEL_W - PANEL_INSET * 2 : w;
      return { x: (PALETTE_W + right) / 2, y: h / 2 };
    },
    [],
  );

  const centerOn = useCallback(
    (r: Rect, opts: { readonly zoomIn: boolean; readonly withPanel: boolean }): void => {
      const c = visibleCenter(opts.withPanel);
      if (c === null) return;
      const now = rf.getViewport();
      const zoom = opts.zoomIn ? Math.max(now.zoom, FOCUS_ZOOM) : now.zoom;
      const x = c.x - (r.x + r.w / 2) * zoom;
      const y = c.y - (r.y + r.h / 2) * zoom;
      detach(rf.setViewport({ x, y, zoom }, { duration: reduced ? 0 : 420 }), rethrow);
    },
    [rf, reduced, visibleCenter],
  );

  /** 노드가 상세 판 밑에 있으면(또는 화면 밖이면) 판 밖으로 옮긴다 */
  const keepClear = useCallback(
    (r: Rect): void => {
      const el = wrap.current;
      if (el === null) return;
      const v = rf.getViewport();
      const left = r.x * v.zoom + v.x;
      const right = (r.x + r.w) * v.zoom + v.x;
      const top = r.y * v.zoom + v.y;
      const bottom = (r.y + r.h) * v.zoom + v.y;
      const panelLeft = el.clientWidth - PANEL_W - PANEL_INSET * 2;
      const hidden = right > panelLeft || left < PALETTE_W || top < 0 || bottom > el.clientHeight;
      if (hidden) centerOn(r, { zoomIn: false, withPanel: true });
    },
    [rf, centerOn],
  );

  const focusNow = useCallback(
    (id: string): boolean => {
      const r = rectOf(layout, id);
      if (r === null) return false;
      setSelected(id);
      setPanel(id);
      setPulse((p) => ({ id, n: (p?.n ?? 0) + 1 }));
      centerOn(r, { zoomIn: true, withPanel: true });
      return true;
    },
    [layout, centerOn],
  );

  /** 왼쪽 판·참조 표·관계 줄에서 부른다: 그 노드로 간다 */
  const focus = useCallback(
    (name: string): void => {
      if (!inProfile(profile, name)) {
        // 프로필 밖: 상세 판만 띄운다(거기서 넣는다)
        setSelected(name);
        setPanel(name);
        setSay(t("desktop.craft.canvas.cvF.say.notIn", { name }));
        return;
      }
      const g = profile.groups.find((x) => x.members.includes(name) && groupIn(profile, x));
      if (g !== undefined && collapsed.has(g.id)) {
        setCollapsed((s) => {
          const next = new Set(s);
          next.delete(g.id);
          return next;
        });
        setPending(name);
        return;
      }
      if (focusNow(name)) setSay(t("desktop.craft.canvas.cvF.say.focused", { name }));
    },
    [profile, collapsed, focusNow],
  );
  // 펼치거나 넣은 뒤의 포커스: 새 노드가 한 번 재어진 다음 프레임에(같은 프레임이면 상세 판이 붙으며
  // ResizeObserver 알림이 한 번에 몰려 브라우저가 loop 오류를 낸다)
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (pending === null) return;
        if (focusNow(pending)) setSay(t("desktop.craft.canvas.cvF.say.focused", { name: pending }));
        setPending(null);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [pending, focusNow]);

  const focusZone = useCallback(
    (id: string): void => {
      if (focusNow(`zone:${id}`)) setSay(t("desktop.craft.canvas.cvF.say.focused", { name: id }));
    },
    [focusNow],
  );

  const apply = useCallback(
    (edit: Edit, ok: string): void => {
      if (edit.ok) {
        setEdits((m) => new Map(m).set(scene, edit.profile));
        setSay(ok);
        return;
      }
      setSay(t(`desktop.craft.canvas.cvF.refuse.${edit.reason}`));
    },
    [scene],
  );

  const toggleZone = useCallback((id: string): void => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const select = useCallback(
    (id: string): void => {
      setSelected(id);
      setPanel(id);
      const r = rectOf(layout, id);
      if (r !== null)
        requestAnimationFrame(() => {
          keepClear(r);
        });
    },
    [layout, keepClear],
  );

  const close = useCallback((): void => {
    setPanel(null);
    setSelected(null);
  }, []);

  const panelActions = useMemo(
    (): PanelActions => ({
      close,
      focus,
      focusZone,
      open: props.onOpen,
      add: (name) => {
        apply(addPlugin(profile, name), t("desktop.craft.canvas.cvF.say.added", { name }));
        setPending(name);
      },
      remove: (name) => {
        const edit = removePlugin(profile, name);
        apply(edit, t("desktop.craft.canvas.cvF.say.removed", { name }));
        if (edit.ok) setSelected(null);
      },
      move: (name, dir) => {
        apply(move(profile, CATALOG, name, dir), t("desktop.craft.canvas.cvF.say.moved", { name }));
      },
      testRun: (name) => {
        setSay(t("desktop.craft.canvas.cvF.say.testRun", { name }));
      },
      addGroup: (id) => {
        apply(addGroup(profile, id), t("desktop.craft.canvas.cvF.say.added", { name: id }));
      },
      removeGroup: (id) => {
        const edit = removeGroup(profile, id);
        apply(edit, t("desktop.craft.canvas.cvF.say.removed", { name: id }));
        if (edit.ok) setSelected(`zone:${id}`);
      },
      toggleZone,
      moveInGroup: (id, name, dir) => {
        apply(
          moveInGroup(profile, id, name, dir),
          t("desktop.craft.canvas.cvF.say.moved", { name }),
        );
      },
    }),
    [close, focus, focusZone, props.onOpen, apply, profile, toggleZone],
  );

  const onKey = useCallback(
    (id: string, e: KeyboardEvent<HTMLElement>): void => {
      if (e.key === "Enter" && e.shiftKey && !id.startsWith("zone:")) {
        e.preventDefault();
        props.onOpen(id);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(id);
      } else if (e.key === "Escape") {
        close();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !id.startsWith("zone:")) {
        e.preventDefault();
        panelActions.remove(id);
      }
    },
    [props, select, close, panelActions],
  );

  const actions = useMemo(
    (): CanvasActions => ({ select, open: props.onOpen, toggleZone, focus, key: onKey }),
    [select, props.onOpen, toggleZone, focus, onKey],
  );

  // ── 노드 ──
  const nodes = useMemo((): CanvasNode[] => {
    const out: CanvasNode[] = [];
    const b = layout.bounds;
    out.push({
      id: "scene",
      type: "scene",
      position: { x: b.x, y: b.y },
      data: { layout },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: { width: b.w, height: b.h },
    });
    for (const z of layout.zones) {
      const kinds = [...new Set(z.members.map((m) => CATALOG.get(m)?.kind))].filter(
        (k): k is Kind => k !== undefined,
      );
      out.push({
        id: `zone:${z.id}`,
        type: "zone",
        position: { x: z.x, y: z.y },
        data: {
          zone: z,
          purpose: t(groupExtOf(z.id).purpose),
          version: groupExtOf(z.id).version,
          kinds,
          selected: selected === `zone:${z.id}`,
          pulse: pulse?.id === `zone:${z.id}` ? pulse.n : 0,
        },
        draggable: false,
        ariaLabel: t("desktop.craft.canvas.cvF.zone.label", {
          letter: z.letter,
          name: z.id,
          n: z.members.length,
        }),
        style: { width: z.w, height: z.h },
      });
    }
    for (const c of layout.cards) {
      const spec = CATALOG.get(c.name);
      if (spec === undefined) continue;
      const zone = c.zone === null ? undefined : layout.zones.find((z) => z.id === c.zone);
      const total = c.zone === null ? spotOrder(profile, CATALOG, c.spot).length : 1;
      out.push({
        id: c.name,
        type: "plugin",
        position: zone === undefined ? { x: c.x, y: c.y } : { x: c.x - zone.x, y: c.y - zone.y },
        ...(zone === undefined ? {} : { parentId: `zone:${zone.id}`, extent: "parent" as const }),
        data: {
          spec,
          order: c.order,
          total,
          source: sourceOf(profile, c.name),
          start: profile.startDrive === c.name,
          selected: selected === c.name,
          pulse: pulse?.id === c.name ? pulse.n : 0,
          mark: c.mark,
          side: c.spot.startsWith("feed:") ? "above" : c.spot === "drive" ? "band" : "below",
        },
        draggable: false,
        ariaLabel: t("desktop.craft.canvas.cvF.node.label", {
          name: spec.name,
          kind: t(KIND_WORD[spec.kind]),
          spot: t(SPOT_WORD[c.spot]),
        }),
        style: { width: CARD_W, height: CARD_H },
      });
    }
    for (const m of layout.marks) {
      const id =
        m.item.type === "builtin"
          ? `builtin:${m.item.tool}`
          : m.item.type === "ref"
            ? `ref:${m.item.name}`
            : `mark:${String(m.order)}`;
      out.push({
        id,
        type: "mark",
        position: { x: m.x, y: m.y },
        data: { geo: m, selected: m.item.type === "ref" && selected === m.item.name },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { width: m.w, height: m.h },
      });
    }
    return out;
  }, [layout, profile, selected, pulse]);

  // ── 관계 선 ──
  const edges = useMemo((): RelationEdge[] => {
    if (!relations) return [];
    const closedOf = (name: string): string => {
      const z = layout.zones.find((x) => x.members.includes(name) && x.collapsed);
      return z === undefined ? name : `zone:${z.id}`;
    };
    const rectFor = (id: string): Rect | null => {
      if (id.startsWith("builtin:")) {
        const m = layout.marks.find(
          (x) => x.item.type === "builtin" && `builtin:${x.item.tool}` === id,
        );
        return m === undefined ? null : { x: m.x, y: m.y, w: m.w, h: m.h };
      }
      return rectOf(layout, id);
    };
    const out: RelationEdge[] = [];
    for (const r of relationsOf(profile, CATALOG)) {
      const source = closedOf(r.from);
      const target = r.kind === "replaces" ? `builtin:${r.tool}` : closedOf(r.to);
      if (source === target) continue;
      const a = rectFor(source);
      const b = rectFor(target);
      if (a === null || b === null) continue;
      const sides = sidesOf(a, b);
      // 의존이 위아래로 이어지면 레일과 스타트 Drive 선을 가로지르므로 왼쪽으로 돌아 나간다
      const [sh, th] =
        r.kind === "depends" && (sides[0] === "t" || sides[0] === "b") ? ["l", "l"] : sides;
      const kind: RelationKind = r.kind;
      const label =
        r.kind === "handoff"
          ? t("desktop.craft.canvas.cvF.rel.handoff")
          : r.kind === "depends"
            ? r.capability
            : t("desktop.craft.canvas.cvF.rel.replace");
      const touches =
        selected !== null &&
        (selected === source ||
          selected === target ||
          selected === r.from ||
          (r.kind !== "replaces" && selected === r.to));
      out.push({
        id: `${r.kind}:${r.from}:${r.kind === "replaces" ? r.tool : r.to}`,
        type: "relation",
        source,
        target,
        sourceHandle: sh,
        targetHandle: th,
        data: { kind, label, hot: touches, dim: selected !== null && !touches },
        focusable: false,
        selectable: false,
      });
    }
    return out;
  }, [relations, layout, profile, selected]);

  // 처음 그릴 때 확대 단계를 잡는다
  useLayoutEffect(() => {
    showViewport(rf.getViewport());
  }, [rf, showViewport]);

  const names = namesOf(profile);
  const pendingCount = names.filter((n) => CATALOG.get(n)?.ext.review.state !== "approved").length;
  const panelPlugin = panel !== null && !panel.startsWith("zone:") ? CATALOG.get(panel) : undefined;
  const panelGroup =
    panel !== null && panel.startsWith("zone:")
      ? profile.groups.find((g) => `zone:${g.id}` === panel)
      : undefined;
  const empty = names.length === profile.base.length;

  return (
    <CanvasActionsContext value={actions}>
      <div
        ref={wrap}
        className="cvf-root relative flex min-h-0 flex-1 overflow-hidden"
        data-theme={theme}
        data-lod="mid"
        style={kindVars(theme)}
        onKeyDown={(e) => {
          const node =
            e.target instanceof HTMLElement
              ? e.target.closest<HTMLElement>(".react-flow__node")
              : null;
          const id = node?.dataset["id"];
          if (
            id === undefined ||
            id === "scene" ||
            id.startsWith("builtin:") ||
            id.startsWith("ref:")
          ) {
            if (e.key === "Escape" && panel !== null) close();
            return;
          }
          onKey(id, e);
        }}
      >
        <RelationMarkers />
        <ReactFlow<CanvasNode, RelationEdge>
          className="cvf-flow"
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable
          edgesFocusable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          minZoom={0.25}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          aria-label={t("desktop.craft.canvas.cvF.canvas", {
            profile: choices.find((c) => c.id === scene)?.name ?? "",
          })}
          onPaneClick={close}
          onNodeClick={(_, node) => {
            if (node.type === "plugin") select(node.id);
            else if (node.type === "zone") select(node.id);
          }}
        />

        <Palette
          profile={profile}
          installed={installed}
          choices={choices}
          selected={selected}
          onProfile={(id) => {
            if (!isProfileId(id)) return;
            setScene(id);
            setSelected(null);
            setPanel(null);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                fit(0);
              });
            });
          }}
          onPick={focus}
          onPickGroup={(id) => {
            const g = profile.groups.find((x) => x.id === id);
            if (g !== undefined && groupIn(profile, g)) focusZone(id);
            else {
              setSelected(`zone:${id}`);
              setPanel(`zone:${id}`);
            }
          }}
          onToggle={(name) => {
            if (inProfile(profile, name)) panelActions.remove(name);
            else panelActions.add(name);
          }}
          onToggleGroup={(id) => {
            const g = profile.groups.find((x) => x.id === id);
            if (g === undefined) return;
            if (groupIn(profile, g)) panelActions.removeGroup(id);
            else panelActions.addGroup(id);
          }}
        />

        <Legend />

        {empty ? (
          <div className="cvf-empty-hint" style={{ left: PALETTE_W }}>
            <p>{t("desktop.craft.canvas.cvF.empty.title")}</p>
            <p className="text-text-tertiary">{t("desktop.craft.canvas.cvF.empty.body")}</p>
          </div>
        ) : null}

        <TitleBlock
          profileName={choices.find((c) => c.id === scene)?.name ?? ""}
          count={names.length}
          pending={pendingCount}
          relations={relations}
          onRelations={() => {
            setRelations((v) => !v);
          }}
          onZoomIn={() => {
            detach(rf.zoomIn({ duration: reduced ? 0 : 160 }), rethrow);
          }}
          onZoomOut={() => {
            detach(rf.zoomOut({ duration: reduced ? 0 : 160 }), rethrow);
          }}
          onFit={() => {
            fit(reduced ? 0 : 260);
          }}
        />

        {panelPlugin !== undefined ? (
          <PluginPanel
            key={panelPlugin.name}
            profile={profile}
            catalog={CATALOG}
            plugin={panelPlugin}
            actions={panelActions}
          />
        ) : panelGroup !== undefined ? (
          <ZonePanel
            key={panelGroup.id}
            profile={profile}
            catalog={CATALOG}
            group={panelGroup}
            collapsed={collapsed.has(panelGroup.id)}
            actions={panelActions}
          />
        ) : null}

        <span role="status" aria-live="polite" className="sr-only">
          {say}
        </span>
      </div>
    </CanvasActionsContext>
  );
}

/** 범례: 도면 모서리의 기호 풀이. 종류 넷(색·아이콘·윤곽)과 관계 선 셋 */
function Legend(): ReactNode {
  const kinds: readonly Kind[] = ["inject", "hook", "drive", "tool"];
  return (
    <div
      className="cvf-legend"
      style={{ left: PALETTE_W + 12 }}
      aria-label={t("desktop.craft.canvas.cvF.legend.label")}
      role="group"
    >
      {kinds.map((k) => (
        <span key={k} className="cvf-legend-item">
          <span style={{ color: KIND_COLOR[k] }} className="flex">
            <KindGlyph kind={k} size={12} />
          </span>
          {t(KIND_WORD[k])}
        </span>
      ))}
      <span className="cvf-legend-sep" aria-hidden="true" />
      <LegendLine kind="handoff" word={t("desktop.craft.canvas.cvF.rel.handoff")} />
      <LegendLine kind="depends" word={t("desktop.craft.canvas.cvF.rel.depends")} />
      <LegendLine kind="replaces" word={t("desktop.craft.canvas.cvF.rel.replace")} />
      <span className="cvf-legend-item">
        <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
          <rect x={1.5} y={1.5} width={19} height={9} rx={2.5} className="cvf-sym-zone" />
        </svg>
        {t("desktop.craft.canvas.cvF.zone.word")}
      </span>
      <InfoTip
        text={[
          t("desktop.craft.canvas.cvF.legend.info1"),
          t("desktop.craft.canvas.cvF.legend.info2"),
          t("desktop.craft.canvas.cvF.legend.info3"),
        ]}
      />
    </div>
  );
}

function LegendLine(props: { readonly kind: RelationKind; readonly word: string }): ReactNode {
  return (
    <span className="cvf-legend-item">
      <svg width={28} height={12} viewBox="0 0 28 12" aria-hidden="true">
        {props.kind === "handoff" ? (
          <>
            <path d="M2 6h18" className="cvf-sym-line" />
            <path d="M18 2.5 25 6l-7 3.5Z" className="cvf-sym-fill" />
          </>
        ) : props.kind === "depends" ? (
          <>
            <path d="M2 6h17" className="cvf-sym-line" strokeDasharray="3 2.5" />
            <circle cx={22.5} cy={6} r={3.4} className="cvf-sym-hollow" />
          </>
        ) : (
          <>
            <path d="M2 6h15" className="cvf-sym-line" strokeDasharray="7 2 1.5 2" />
            <path d="M16 6 21 2.6 26 6 21 9.4Z" className="cvf-sym-hollow" />
          </>
        )}
      </svg>
      {props.word}
    </span>
  );
}

/** 표제란: 도면 오른쪽 아래의 칸. 프로필, 플러그인 수, 리뷰 대기(경고), 축척(확대 막대), 관계 선 켜고 끄기 */
function TitleBlock(props: {
  readonly profileName: string;
  readonly count: number;
  readonly pending: number;
  readonly relations: boolean;
  readonly onRelations: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
}): ReactNode {
  return (
    <div className="cvf-title" role="group" aria-label={t("desktop.craft.canvas.cvF.title.label")}>
      <div className="cvf-title-cell">
        <span className="cvf-title-k">{t("desktop.craft.canvas.cvF.profile")}</span>
        <span className="cvf-title-v">{props.profileName}</span>
      </div>
      <div className="cvf-title-cell">
        <span className="cvf-title-k">{t("desktop.craft.canvas.cvF.title.plugins")}</span>
        <span className="cvf-title-v font-mono">{props.count}</span>
      </div>
      {props.pending > 0 ? (
        <div className="cvf-title-cell" data-tone="warning">
          <span className="cvf-title-k">{t("desktop.craft.canvas.cvF.title.pending")}</span>
          <span className="cvf-title-v font-mono">{props.pending}</span>
        </div>
      ) : null}
      <div className="cvf-title-cell">
        <span className="cvf-title-k">{t("desktop.craft.canvas.cvF.title.relations")}</span>
        <button
          type="button"
          className="cvf-title-toggle"
          aria-pressed={props.relations}
          onClick={props.onRelations}
        >
          {t(
            props.relations
              ? "desktop.craft.canvas.cvF.title.on"
              : "desktop.craft.canvas.cvF.title.off",
          )}
        </button>
      </div>
      <div className="cvf-title-cell cvf-title-scale">
        <span className="cvf-title-k">{t("desktop.craft.canvas.cvF.title.scale")}</span>
        <span className="flex items-center gap-0.5">
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.craft.canvas.cvF.zoom.out")}
            onClick={props.onZoomOut}
          >
            <Minus aria-hidden />
          </IconButton>
          <span data-cvf-scale="" className="cvf-title-v w-11 text-center font-mono tabular-nums">
            100%
          </span>
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.craft.canvas.cvF.zoom.in")}
            onClick={props.onZoomIn}
          >
            <Plus aria-hidden />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.craft.canvas.cvF.zoom.fit")}
            onClick={props.onFit}
          >
            <Maximize aria-hidden />
          </IconButton>
        </span>
      </div>
    </div>
  );
}
