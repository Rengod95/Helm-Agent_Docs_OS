// cvB 프로필 캔버스. 한 화면이 답하는 질문은 하나다: "이 프로필에서 무엇이 턴의 어디에 어떻게 붙어 있나".
// 머리(지금 보는 프로필) · 왼쪽 플러그인 목록 · 가운데 캔버스(배경, 궤도, 결정) · 고르면 오른쪽 위 상세 · 아래 떠 있는 도구 막대.
// 바꾸기(넣기·빼기·순서·묶음 접기)는 이 화면의 상태만 바꾼다(시안: 저장하지 않는다).
import { IconButton, Select, SelectOption, Tooltip } from "@caustic/react";
import { Info, Maximize, Minus, Plus } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Backdrop } from "./backdrop.tsx";
import { GroupDetail, PluginDetail } from "./detail.tsx";
import { fromReal, useDark, useRealProfiles, useReducedMotion } from "./env.ts";
import { Gem, GlassDefs } from "./glass.tsx";
import { anchorName, kindName, titleText } from "./labels.ts";
import { layoutProfile, type Box, type LayoutNode } from "./layout.ts";
import {
  addPlugin,
  dropTarget,
  hasPlugin,
  movePlugin,
  removePlugin,
  type ProfileState,
} from "./model.ts";
import {
  ariaOf,
  CanvasActionsContext,
  CrystalNode,
  GateNode,
  GroupNode,
  LinesNode,
  StationNode,
  ZoneNode,
  type CanvasActions,
  type ItemNode,
  type LinesFlowNode,
  type LinesLayer,
} from "./nodes.tsx";
import { EMPTY_PROFILE, SAMPLE_CATALOG, SAMPLE_PLUGINS, SAMPLE_PROFILE } from "./sample.ts";
import { Shelf } from "./shelf.tsx";
import { memory, type Source } from "./memory.ts";

const NODE_TYPES: NodeTypes = {
  station: StationNode,
  gate: GateNode,
  crystal: CrystalNode,
  group: GroupNode,
  zone: ZoneNode,
  lines: LinesNode,
};

/** 화면에 맞추기(글이 너무 커지지 않게 1.05배까지만) */
/** 화면 맞춤. 오른쪽은 앱의 떠 있는 도구 막대, 아래는 도구 막대(dock)가 덮는 만큼 더 비운다 */
export const FIT = {
  padding: { top: "28px", right: "64px", bottom: "68px", left: "28px" },
  // 좁은 창(1100×720)에서 글이 8px 밑으로 줄지 않게 한다. 넘치는 만큼은 끌어 옮긴다
  minZoom: 0.72,
  maxZoom: 1.05,
} as const;

/** 오른쪽 상세 판이 가리는 폭(판 272 + 여백) */
const DETAIL_REACH = 300;
/** 화면 가장자리에서 띄울 여백 */
const EDGE = 24;

export interface ProfileCanvasProps {
  readonly onOpen: (pluginId: string) => void;
}

export function ProfileCanvas(props: ProfileCanvasProps): ReactNode {
  return (
    <ReactFlowProvider>
      <CanvasScreen onOpen={props.onOpen} />
    </ReactFlowProvider>
  );
}

function zIndexOf(item: LayoutNode): number {
  switch (item.type) {
    case "zone":
      return -2;
    case "group":
      return 0;
    case "crystal":
      return item.group === null ? 2 : 3;
    case "station":
    case "gate":
      return 2;
    default:
      return assertNever(item, "cvB.zIndexOf");
  }
}

function toFlow(items: readonly LayoutNode[]): ItemNode[] {
  return items.map((item) => {
    const focusable = item.type !== "zone" && !(item.type === "crystal" && item.ghost);
    const aria = ariaOf(item);
    return {
      id: item.id,
      type: item.type,
      position: { x: item.box.x, y: item.box.y },
      width: item.box.w,
      height: item.box.h,
      data: { item },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable,
      zIndex: zIndexOf(item),
      ...(aria === undefined ? {} : { ariaLabel: aria }),
      ariaRole: item.type === "crystal" || item.type === "group" ? "button" : "group",
    };
  });
}

function CanvasScreen(props: ProfileCanvasProps): ReactNode {
  const flow = useReactFlow();
  const dark = useDark();
  const reduced = useReducedMotion();
  const real = useRealProfiles();
  const [source, setSource] = useState<Source>(memory.source);
  const [state, setState] = useState<ProfileState>(memory.state);
  const [open, setOpen] = useState<ReadonlySet<string>>(memory.open);
  const [selected, setSelected] = useState<string | null>(memory.selected);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [live, setLive] = useState("");
  const [unknown, setUnknown] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // 화면을 떠났다 돌아와도(내부 보기) 같은 상태로 그린다
  useEffect(() => {
    memory.source = source;
    memory.state = state;
    memory.open = open;
    memory.selected = selected;
  }, [source, state, open, selected]);

  // 좁은 창(1100 폭 등)에서는 목록을 문양만 남기고 접는다
  useEffect(() => {
    const el = stageRef.current?.parentElement;
    if (el === undefined || el === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setCollapsed(entry.contentRect.width < 900);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const layout = useMemo(
    () => layoutProfile({ state, catalog: SAMPLE_CATALOG, open, ghost: dragging, selected }),
    [state, open, dragging, selected],
  );
  const nodes = useMemo<Node[]>(() => {
    const linesNode = (layer: LinesLayer): LinesFlowNode => ({
      id: `lines:${layer}`,
      type: "lines",
      position: { x: layout.bounds.x, y: layout.bounds.y },
      width: layout.bounds.w,
      height: layout.bounds.h,
      data: { layout, layer },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: layer === "under" ? -1 : 1,
      // React Flow는 누르기 처리기가 있으면 노드마다 pointer-events: all을 인라인으로 단다. style이 그 뒤에 펼쳐지므로 여기서 끈다
      style: { pointerEvents: "none" },
    });
    return [linesNode("under"), linesNode("beams"), ...toFlow(layout.nodes)];
  }, [layout]);

  // 프로필을 바꾸면 다음 그림 뒤에 화면에 맞춘다(고르기·접기로는 보기를 움직이지 않는다)
  /** 맞춤이 최소 배율에 걸리면(좁은 창) 여백 비대칭 탓에 한쪽이 잘린다: 가로로 가운데 둔다 */
  const centerIfClamped = (): void => {
    const stage = stageRef.current;
    if (stage === null) return;
    const vp = flow.getViewport();
    if (vp.zoom > FIT.minZoom + 0.001) return;
    const b = flow.getNodesBounds(flow.getNodes());
    const x = (stage.clientWidth - b.width * vp.zoom) / 2 - b.x * vp.zoom;
    detach(flow.setViewport({ x, y: vp.y, zoom: vp.zoom }), rethrow);
  };

  const refit = (): void => {
    requestAnimationFrame(() => {
      detach(
        (async () => {
          await flow.fitView(FIT);
          centerIfClamped();
        })(),
        rethrow,
      );
    });
  };

  const announce = (text: string): void => {
    setLive(text);
  };

  /** 상자가 보이는 폭 안에 들도록 옆으로만 옮긴다. reach는 오른쪽에서 가려지는 폭(상세 판) */
  const reveal = (box: Box, reach: number): void => {
    const stage = stageRef.current;
    if (stage === null) return;
    const vp = flow.getViewport();
    const left = vp.x + box.x * vp.zoom;
    const right = vp.x + (box.x + box.w) * vp.zoom;
    const limit = stage.clientWidth - reach;
    const shift = right > limit ? limit - right : left < EDGE ? EDGE - left : 0;
    if (shift === 0) return;
    detach(
      flow.setViewport(
        { x: vp.x + shift, y: vp.y, zoom: vp.zoom },
        { duration: reduced ? 0 : 200 },
      ),
      rethrow,
    );
  };

  /** 끌어 놓기·자리 고르기를 시작한다. 빈 자리가 화면 밖이면 보이게 옮긴다 */
  const beginPlacing = (plugin: string): void => {
    setDragging(plugin);
    const ghost = layoutProfile({
      state,
      catalog: SAMPLE_CATALOG,
      open,
      ghost: plugin,
      selected,
    }).nodes.find((n) => n.id === `ghost:${plugin}`);
    if (ghost !== undefined) reveal(ghost.box, EDGE);
  };

  const select = (id: string | null): void => {
    setSelected(id);
    if (id === null) return;
    const node = layout.nodes.find((n) => n.id === id || n.id === `group:${id}`);
    if (node !== undefined) reveal(node.box, DETAIL_REACH);
  };

  const place = (plugin: string): void => {
    const change = addPlugin(state, SAMPLE_CATALOG, plugin);
    setDragging(null);
    setOver(false);
    if (!change.ok) return;
    setState(change.state);
    setSelected(plugin);
    const found = SAMPLE_CATALOG.get(plugin);
    if (found !== undefined) {
      announce(
        t("desktop.craft.canvas.cvB.place.done", { name: plugin, where: anchorName(found.anchor) }),
      );
    }
  };

  const startPlacing = (plugin: string): void => {
    if (dragging === plugin) {
      place(plugin);
      return;
    }
    const target = dropTarget(state, SAMPLE_CATALOG, plugin);
    const found = SAMPLE_CATALOG.get(plugin);
    if (target === null || found === undefined) return;
    beginPlacing(plugin);
    announce(
      t("desktop.craft.canvas.cvB.place.live", { name: plugin, where: anchorName(found.anchor) }),
    );
  };

  const remove = (plugin: string): void => {
    const change = removePlugin(state, plugin);
    if (!change.ok) {
      if (change.reason === "base") announce(t("desktop.craft.canvas.cvB.detail.removeBase"));
      return;
    }
    setState(change.state);
    setSelected(null);
    announce(t("desktop.craft.canvas.cvB.removed", { name: plugin }));
  };

  const move = (plugin: string, dir: -1 | 1): void => {
    const change = movePlugin(state, SAMPLE_CATALOG, plugin, dir);
    if (change.ok) setState(change.state);
    else if (change.reason === "tier") announce(t("desktop.craft.canvas.cvB.detail.tierLock"));
  };

  const toggleGroup = (group: string): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const actions: CanvasActions = {
    selected,
    dragging,
    over,
    setOver,
    drop: () => {
      if (dragging !== null) place(dragging);
    },
    toggleGroup,
  };

  const pickSource = (value: string): void => {
    let next: ProfileState = SAMPLE_PROFILE;
    let missing = 0;
    if (value === "empty") next = EMPTY_PROFILE;
    else if (value.startsWith("real:")) {
      const profile = real.value.find((p) => `real:${p.id}` === value);
      if (profile !== undefined) {
        const mapped = fromReal(profile, SAMPLE_CATALOG);
        next = mapped.state;
        missing = mapped.unknown;
      }
    }
    setSource(value);
    setState(next);
    setUnknown(missing);
    setSelected(null);
    setDragging(null);
    refit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.closest(".react-flow__node")?.getAttribute("data-id") ?? null;
    if (e.key === "Escape") {
      if (dragging !== null) {
        setDragging(null);
        setOver(false);
      } else setSelected(null);
      return;
    }
    if (id === null) return;
    const item = layout.nodes.find((n) => n.id === id);
    if (item === undefined) return;
    if (item.type === "group") {
      if (e.key === "Enter") toggleGroup(item.group.id);
      if (e.key === " ") {
        e.preventDefault();
        select(item.id);
      }
      return;
    }
    if (item.type !== "crystal" || item.ghost) return;
    const plugin = item.plugin.id;
    if (e.key === "Enter") props.onOpen(plugin);
    else if (e.key === " ") {
      e.preventDefault();
      select(plugin);
    } else if (e.key === "Delete" || e.key === "Backspace") remove(plugin);
    else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
      e.preventDefault();
      move(plugin, -1);
    } else if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
      e.preventDefault();
      move(plugin, 1);
    }
  };

  const selectedPlugin = selected === null ? undefined : SAMPLE_CATALOG.get(selected);
  const selectedGroup =
    selected !== null && selected.startsWith("group:")
      ? state.groups.find((g) => `group:${g.id}` === selected)
      : undefined;

  return (
    <div className="cvb-root" onKeyDown={onKeyDown}>
      <GlassDefs />
      <header className="cvb-head">
        <span className="cvb-crumb" aria-hidden="true">
          {t("desktop.craft.canvas.cvB.profile.label")}
        </span>
        <Select
          size="sm"
          aria-label={t("desktop.craft.canvas.cvB.profile.label")}
          value={source}
          onValueChange={pickSource}
          className="w-44"
        >
          <SelectOption value="sample">
            {t("desktop.craft.canvas.cvB.profile.sample", {
              name: titleText(SAMPLE_PROFILE.title),
            })}
          </SelectOption>
          <SelectOption value="empty">{t("desktop.craft.canvas.cvB.profile.empty")}</SelectOption>
          {real.value.map((p) => (
            <SelectOption key={p.id} value={`real:${p.id}`}>
              {p.title}
            </SelectOption>
          ))}
        </Select>
      </header>
      <div className="cvb-body">
        <Shelf
          plugins={SAMPLE_PLUGINS}
          state={state}
          placing={dragging}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          onPick={(plugin) => {
            select(plugin);
          }}
          onPlace={startPlacing}
          onCancel={() => {
            setDragging(null);
            setOver(false);
          }}
          onDragStart={(plugin) => {
            if (!hasPlugin(state, plugin)) beginPlacing(plugin);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(false);
          }}
        />
        <div
          className="cvb-stage"
          ref={stageRef}
          aria-label={t("desktop.craft.canvas.cvB.aria.canvas", { name: titleText(state.title) })}
          role="region"
        >
          <Backdrop dark={dark} />
          <CanvasActionsContext value={actions}>
            <ReactFlow
              nodes={nodes}
              edges={[]}
              nodeTypes={NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              selectionKeyCode={null}
              multiSelectionKeyCode={null}
              zoomOnDoubleClick={false}
              fitView
              fitViewOptions={FIT}
              minZoom={0.4}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
              onInit={() => {
                requestAnimationFrame(centerIfClamped);
              }}
              onNodeClick={(_, node) => {
                if (
                  node.id.startsWith("lines:") ||
                  node.id === "zone" ||
                  node.id.startsWith("ghost:")
                )
                  return;
                if (node.id.startsWith("station:") || node.id.startsWith("gate:")) return;
                select(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                if (SAMPLE_CATALOG.has(node.id)) props.onOpen(node.id);
              }}
              onPaneClick={() => {
                setSelected(null);
              }}
            />
          </CanvasActionsContext>
          {unknown > 0 && (
            <div className="cvb-notice" role="status">
              {t("desktop.craft.canvas.cvB.real.unknown", { n: unknown })}
            </div>
          )}
          {selectedPlugin !== undefined && hasPlugin(state, selectedPlugin.id) && (
            <PluginDetail
              plugin={selectedPlugin}
              state={state}
              catalog={SAMPLE_CATALOG}
              onOpen={() => {
                props.onOpen(selectedPlugin.id);
              }}
              onMove={(dir) => {
                move(selectedPlugin.id, dir);
              }}
              onRemove={() => {
                remove(selectedPlugin.id);
              }}
              onClose={() => {
                setSelected(null);
              }}
            />
          )}
          {selectedGroup !== undefined && (
            <GroupDetail
              group={selectedGroup}
              catalog={SAMPLE_CATALOG}
              open={open.has(selectedGroup.id)}
              onToggle={() => {
                toggleGroup(selectedGroup.id);
              }}
              onPick={(plugin) => {
                select(plugin);
              }}
              onClose={() => {
                setSelected(null);
              }}
            />
          )}
          <Dock />
          <div className="cvb-live" aria-live="polite">
            {live}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 아래 떠 있는 도구 막대: 축소·확대·맞추기와 보는 법(정보 아이콘 뒤) */
export function Dock(): ReactNode {
  const flow = useReactFlow();
  return (
    <div className="cvb-dock" role="toolbar" aria-label={t("desktop.craft.canvas.cvB.dock.label")}>
      <IconButton
        size="sm"
        variant="ghost"
        label={t("desktop.craft.canvas.cvB.dock.zoomOut")}
        onClick={() => {
          detach(flow.zoomOut(), rethrow);
        }}
      >
        <Minus size={16} />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        label={t("desktop.craft.canvas.cvB.dock.zoomIn")}
        onClick={() => {
          detach(flow.zoomIn(), rethrow);
        }}
      >
        <Plus size={16} />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        label={t("desktop.craft.canvas.cvB.dock.fit")}
        onClick={() => {
          detach(flow.fitView({ ...FIT, duration: 200 }), rethrow);
        }}
      >
        <Maximize size={16} />
      </IconButton>
      <span className="cvb-dock-sep" aria-hidden="true" />
      <Tooltip content={<Legend />} side="top">
        <IconButton size="sm" variant="ghost" label={t("desktop.craft.canvas.cvB.dock.legend")}>
          <Info size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function Legend(): ReactNode {
  return (
    <div className="cvb-legend">
      <Gem kind="inject" size={16} />
      <span>{t("desktop.craft.canvas.cvB.legend.inject", { kind: kindName("inject") })}</span>
      <Gem kind="hook" size={16} />
      <span>{t("desktop.craft.canvas.cvB.legend.hook", { kind: kindName("hook") })}</span>
      <Gem kind="drive" size={16} />
      <span>{t("desktop.craft.canvas.cvB.legend.drive", { kind: kindName("drive") })}</span>
      <Gem kind="tool" size={16} />
      <span>{t("desktop.craft.canvas.cvB.legend.tool", { kind: kindName("tool") })}</span>
      <svg width={20} height={10} aria-hidden="true">
        <path d="M0 5 H20" stroke="currentColor" strokeWidth={1} opacity={0.6} />
      </svg>
      <span>{t("desktop.craft.canvas.cvB.legend.rod")}</span>
      <svg width={20} height={10} aria-hidden="true">
        <path d="M0 8 C6 0 14 0 20 5" fill="none" stroke="currentColor" strokeWidth={2} />
      </svg>
      <span>{t("desktop.craft.canvas.cvB.legend.beam")}</span>
      <svg width={20} height={10} aria-hidden="true">
        <rect
          x={1}
          y={1}
          width={18}
          height={8}
          rx={2}
          fill="none"
          stroke="currentColor"
          strokeDasharray="3 2"
        />
      </svg>
      <span>{t("desktop.craft.canvas.cvB.legend.draft")}</span>
      <svg width={20} height={10} aria-hidden="true">
        <rect
          x={1}
          y={1}
          width={18}
          height={8}
          rx={2}
          fill="none"
          stroke="currentColor"
          opacity={0.5}
        />
        <rect x={1} y={7} width={18} height={2} fill="currentColor" />
      </svg>
      <span>{t("desktop.craft.canvas.cvB.legend.base")}</span>
    </div>
  );
}
