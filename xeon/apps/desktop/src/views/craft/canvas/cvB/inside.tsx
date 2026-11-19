// 플러그인 내부(더블클릭·Enter로 들어온다. 위쪽 경로나 Esc로 돌아간다).
// 구성 요소 노드: 지침, 스킬, 메모리, MCP 서버(도구 칩), Hook 핸들러(어느 자리·무슨 결정), Drive 단계(고리)와 핸드오프 문, 설정, 권한(위험 등급).
// 테두리 밖에는 붙는 곳(블록 틀의 흐린 사본)과 핸드오프 상대(흐린 결정)를 둔다. 상대 결정을 누르면 그 내부로 간다.
import { IconButton } from "@caustic/react";
import { ChevronLeft, ChevronRight } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useId, useMemo, type ReactNode } from "react";
import { Backdrop } from "./backdrop.tsx";
import { useDark } from "./env.ts";
import { Gem, GlassDefs, GlassPlate, PartGlyph } from "./glass.tsx";
import { layoutInside, type InsideLayout, type InsideNode } from "./inside-layout.ts";
import {
  anchorName,
  blockName,
  boundaryName,
  kindName,
  metaText,
  riskName,
  titleText,
  verbName,
} from "./labels.ts";
import { memory } from "./memory.ts";
import type { Kind, Part, Risk } from "./model.ts";
import { Dock, FIT } from "./profile-canvas.tsx";
import { SAMPLE_CATALOG } from "./sample.ts";

export interface PluginInsideProps {
  readonly pluginId: string;
  readonly onBack: () => void;
  /** 핸드오프 상대 결정을 눌러 그 내부로 간다 */
  readonly onOpen: (pluginId: string) => void;
}

type InsideFlowNode = Node<{ readonly item: InsideNode; readonly kind: Kind }>;
type InsideLinesNode = Node<{ readonly layout: InsideLayout }>;

const NODE_TYPES: NodeTypes = {
  frame: FrameNode,
  part: PartNode,
  step: StepNode,
  port: PortNode,
  ghostStation: GhostStationNode,
  ghostPlugin: GhostPluginNode,
  lines: InsideLines,
};

export function PluginInside(props: PluginInsideProps): ReactNode {
  return (
    <ReactFlowProvider>
      <InsideScreen {...props} />
    </ReactFlowProvider>
  );
}

function InsideScreen(props: PluginInsideProps): ReactNode {
  const dark = useDark();
  const plugin = SAMPLE_CATALOG.get(props.pluginId);
  const layout = useMemo(
    () => (plugin === undefined ? null : layoutInside(plugin, memory.state, SAMPLE_CATALOG)),
    [plugin],
  );
  const nodes = useMemo<Node[]>(() => {
    if (layout === null || plugin === undefined) return [];
    const lines: InsideLinesNode = {
      id: "lines",
      type: "lines",
      position: { x: layout.bounds.x, y: layout.bounds.y },
      width: layout.bounds.w,
      height: layout.bounds.h,
      data: { layout },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
      // React Flow는 누르기 처리기가 있으면 노드마다 pointer-events: all을 인라인으로 단다. style이 그 뒤에 펼쳐지므로 여기서 끈다
      style: { pointerEvents: "none" },
    };
    const items: InsideFlowNode[] = layout.nodes.map((item) => ({
      id: item.id,
      type: item.type,
      position: { x: item.box.x, y: item.box.y },
      width: item.box.w,
      height: item.box.h,
      data: { item, kind: plugin.kind },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: item.type !== "frame",
      zIndex: item.type === "frame" ? -1 : 1,
      ariaLabel: insideAria(item),
    }));
    return [lines, ...items];
  }, [layout, plugin]);

  if (plugin === undefined) return null;
  return (
    <div
      className="cvb-root"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onBack();
      }}
    >
      <GlassDefs />
      <header className="cvb-head">
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvB.inside.back")}
          onClick={props.onBack}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <nav className="cvb-crumb" aria-label={t("desktop.craft.canvas.cvB.inside.path")}>
          <button type="button" onClick={props.onBack}>
            {titleText(memory.state.title)}
          </button>
          <ChevronRight size={12} aria-hidden="true" />
          <span className="cvb-crumb-now" aria-current="page">
            {plugin.id}
          </span>
        </nav>
      </header>
      <div className="cvb-body">
        <div
          className="cvb-stage"
          role="region"
          aria-label={t("desktop.craft.canvas.cvB.inside.aria", { name: plugin.id })}
        >
          <Backdrop dark={dark} />
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            fitView
            fitViewOptions={FIT}
            minZoom={0.4}
            maxZoom={1.8}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => {
              if (node.id.startsWith("ghost:") && node.id !== "ghost:station") {
                props.onOpen(node.id.slice("ghost:".length));
              }
            }}
          />
          <Dock />
        </div>
      </div>
    </div>
  );
}

function insideAria(item: InsideNode): string {
  switch (item.type) {
    case "frame":
      return item.plugin.id;
    case "part":
      return `${partTitle(item.part)}, ${partSub(item.part)}`;
    case "step":
      return t("desktop.craft.canvas.cvB.aria.step", {
        n: item.index + 1,
        name: t(item.part.title),
      });
    case "port":
      return `${portLabel(item.dir, item.back)}, ${item.other}`;
    case "ghostStation":
      return anchorName(item.anchor);
    case "ghostPlugin":
      return `${item.plugin.id}, ${kindName(item.plugin.kind)}`;
    default:
      return assertNever(item, "cvB.insideAria");
  }
}

function portLabel(dir: "out" | "in", back: boolean): string {
  if (dir === "in") return t("desktop.craft.canvas.cvB.inside.receive");
  return back ? t("desktop.craft.canvas.cvB.handoff") : t("desktop.craft.canvas.cvB.inside.return");
}

function partTitle(part: Part): string {
  switch (part.kind) {
    case "rule":
      return t("desktop.craft.canvas.cvB.part.rule");
    case "skill":
      return part.name;
    case "memory":
      return t("desktop.craft.canvas.cvB.part.memory");
    case "mcp":
      return t("desktop.craft.canvas.cvB.part.mcp", { name: part.server });
    case "handler":
      return t("desktop.craft.canvas.cvB.part.handler");
    case "step":
      return t(part.title);
    case "handoff":
      return t("desktop.craft.canvas.cvB.handoff");
    case "setting":
      return t("desktop.craft.canvas.cvB.part.setting");
    case "permission":
      return t("desktop.craft.canvas.cvB.part.permission", { risk: riskName(part.risk) });
    default:
      return assertNever(part, "cvB.partTitle");
  }
}

function partSub(part: Part): string {
  switch (part.kind) {
    case "rule":
      return part.file;
    case "skill":
      return t("desktop.craft.canvas.cvB.part.skillSub");
    case "memory":
      return t("desktop.craft.canvas.cvB.part.memorySub", { n: part.entries });
    case "mcp":
      return part.command;
    case "handler": {
      const where =
        part.anchor.at === "boundary"
          ? boundaryName(part.anchor.boundary)
          : anchorName(part.anchor);
      return `${where} · ${verbName(part.verb)}`;
    }
    case "step":
      return part.parallel === undefined
        ? ""
        : t("desktop.craft.canvas.cvB.part.parallel", { n: part.parallel });
    case "handoff":
      return part.to;
    case "setting":
      return `${part.key} = ${part.value}`;
    case "permission":
      return part.scopes.length === 0
        ? t("desktop.craft.canvas.cvB.part.noScope")
        : part.scopes.map((s) => t(s)).join(" · ");
    default:
      return assertNever(part, "cvB.partSub");
  }
}

const RISK_LEVEL: Readonly<Record<Risk, number>> = { none: 0, read: 1, write: 2, exec: 3 };

function FrameNode(props: NodeProps<InsideFlowNode>): ReactNode {
  const item = props.data.item;
  if (item.type !== "frame") return null;
  const { plugin } = item;
  return (
    <div className="cvb-frame" data-kind={plugin.kind}>
      <GlassPlate shape="frame" w={item.box.w} h={item.box.h} dashed={plugin.draft === true} />
      <div className="cvb-frame-title">
        <Gem kind={plugin.kind} size={24} />
        <span>{plugin.id}</span>
        <span className="cvb-frame-sub">
          {kindName(plugin.kind)} · {metaText(plugin)}
        </span>
        {plugin.draft === true && (
          <span className="cvb-warn">{t("desktop.craft.canvas.cvB.origin.draft")}</span>
        )}
        {!plugin.runsCode && (
          <span className="cvb-frame-sub">· {t("desktop.craft.canvas.cvB.inside.noCode")}</span>
        )}
      </div>
    </div>
  );
}

function PartNode(props: NodeProps<InsideFlowNode>): ReactNode {
  const item = props.data.item;
  if (item.type !== "part") return null;
  const { part } = item;
  const tall = part.kind === "mcp";
  return (
    <div
      className="cvb-part"
      data-kind={props.data.kind}
      data-tall={tall ? "" : undefined}
      style={{ width: item.box.w, height: item.box.h }}
    >
      <GlassPlate shape="part" w={item.box.w} h={item.box.h} />
      <PartGlyph kind={part.kind} />
      <span className="cvb-part-text">
        <span className="cvb-part-title">{partTitle(part)}</span>
        {part.kind !== "skill" && (
          <span
            className={
              part.kind === "rule" || part.kind === "mcp" || part.kind === "setting"
                ? "cvb-part-sub cvb-part-mono"
                : "cvb-part-sub"
            }
          >
            {partSub(part)}
          </span>
        )}
        {part.kind === "handler" && <span className="cvb-part-sub">{t(part.when)}</span>}
        {part.kind === "mcp" && (
          <span className="cvb-chips">
            {part.tools.map((tool) => (
              <span key={tool} className="cvb-chip">
                {tool}
              </span>
            ))}
          </span>
        )}
      </span>
      {part.kind === "permission" && (
        <span className="cvb-risk" data-risk={part.risk} aria-hidden="true">
          {[1, 2, 3].map((level) => (
            <i key={level} data-on={RISK_LEVEL[part.risk] >= level ? "" : undefined} />
          ))}
        </span>
      )}
    </div>
  );
}

function StepNode(props: NodeProps<InsideFlowNode>): ReactNode {
  const item = props.data.item;
  if (item.type !== "step") return null;
  const { part } = item;
  const { w, h } = item.box;
  const stacked = part.parallel !== undefined;
  return (
    <div className="cvb-part" data-kind={props.data.kind} style={{ width: w, height: h }}>
      {stacked && (
        <>
          <span
            style={{
              position: "absolute",
              inset: 0,
              transform: "translate(12px, -10px)",
              opacity: 0.5,
            }}
          >
            <GlassPlate shape="drive" w={w} h={h - 10} />
          </span>
          <span
            style={{
              position: "absolute",
              inset: 0,
              transform: "translate(6px, -5px)",
              opacity: 0.75,
            }}
          >
            <GlassPlate shape="drive" w={w} h={h - 10} />
          </span>
        </>
      )}
      <span style={{ position: "absolute", left: 0, top: stacked ? 10 : 0 }}>
        <GlassPlate shape="drive" w={w} h={stacked ? h - 10 : h} />
      </span>
      <span className="cvb-rank" style={{ marginInlineStart: 8, marginTop: stacked ? 10 : 0 }}>
        {item.index + 1}
      </span>
      <span className="cvb-part-text" style={{ marginTop: stacked ? 10 : 0 }}>
        <span className="cvb-part-title">{t(part.title)}</span>
        {stacked && <span className="cvb-part-sub">{partSub(part)}</span>}
      </span>
    </div>
  );
}

function PortNode(props: NodeProps<InsideFlowNode>): ReactNode {
  const item = props.data.item;
  if (item.type !== "port") return null;
  return (
    <div className="cvb-port">
      <svg
        width={30}
        height={30}
        viewBox="0 0 30 30"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0 }}
      >
        <path className="cvb-port-mark" d="M15 2 L28 15 L15 28 L2 15 Z" />
        <path className="cvb-port-mark" d="M15 9 L21 15 L15 21 L9 15 Z" />
      </svg>
      <span className="cvb-port-label">{portLabel(item.dir, item.back)}</span>
    </div>
  );
}

function GhostStationNode(props: NodeProps<InsideFlowNode>): ReactNode {
  const item = props.data.item;
  if (item.type !== "ghostStation") return null;
  const { w, h } = item.box;
  const k = 9;
  const name =
    item.anchor.at === "block"
      ? blockName(item.anchor.block)
      : item.anchor.at === "boundary"
        ? boundaryName(item.anchor.boundary)
        : "";
  return (
    <div className="cvb-station cvb-ghost-station" data-filled="" style={{ width: w, height: h }}>
      <svg className="cvb-station-frame" width={w} height={h} aria-hidden="true">
        <rect className="cvb-station-fill" x={0} y={0} width={w} height={h} rx={3} />
        <path
          className="cvb-station-bracket"
          d={`M0 ${k} V0 H${k} M${w - k} 0 H${w} V${k} M${w} ${h - k} V${h} H${w - k} M${k} ${h} H0 V${h - k}`}
        />
      </svg>
      <span className="cvb-station-label">{name}</span>
      <span className="cvb-port-label">{anchorName(item.anchor)}</span>
    </div>
  );
}

function GhostPluginNode(props: NodeProps<InsideFlowNode>): ReactNode {
  const item = props.data.item;
  if (item.type !== "ghostPlugin") return null;
  const { plugin } = item;
  return (
    <div
      className="cvb-crystal cvb-faint"
      data-kind={plugin.kind}
      style={{ width: item.box.w, height: item.box.h }}
    >
      <GlassPlate shape={plugin.kind} w={item.box.w} h={item.box.h} />
      <Gem kind={plugin.kind} size={20} />
      <span className="cvb-crystal-text">
        <span className="cvb-name">{plugin.id}</span>
        <span className="cvb-meta">{metaText(plugin)}</span>
      </span>
    </div>
  );
}

function InsideLines(props: NodeProps<InsideLinesNode>): ReactNode {
  const { layout } = props.data;
  const { bounds } = layout;
  const gid = useId();
  return (
    <div style={{ width: bounds.w, height: bounds.h, position: "relative" }} data-kind="drive">
      <svg className="cvb-lines" width={bounds.w} height={bounds.h} aria-hidden="true">
        <defs>
          {layout.lines.map((line) =>
            line.kind === "beam" ? (
              <linearGradient
                key={line.id}
                id={`${gid}-${line.id}`}
                className="cvb-beam-defs"
                gradientUnits="userSpaceOnUse"
                x1={line.start.x}
                y1={line.start.y}
                x2={line.end.x}
                y2={line.end.y}
              >
                <stop offset="0" data-s="a" />
                <stop offset="0.5" data-s="b" />
                <stop offset="1" data-s="c" />
              </linearGradient>
            ) : null,
          )}
        </defs>
        <g transform={`translate(${-bounds.x} ${-bounds.y})`}>
          {layout.lines.map((line) => {
            switch (line.kind) {
              case "ring":
                return (
                  <g key={line.id}>
                    <path className="cvb-step-ring-halo" d={line.d} />
                    <path className="cvb-step-ring" d={line.d} />
                  </g>
                );
              case "arrow":
                return (
                  <path
                    key={line.id}
                    className="cvb-step-arrow"
                    d="M-5 -4 L4 0 L-5 4 L-3 0 Z"
                    transform={`translate(${line.at.x} ${line.at.y}) rotate(${line.angle})`}
                  />
                );
              case "fan":
              case "track":
              case "entry":
                return <path key={line.id} className="cvb-step-fan" d={line.d} />;
              case "rod":
                return <path key={line.id} className="cvb-rod" d={line.d} />;
              case "beam":
                return (
                  <g key={line.id} className="cvb-beam" data-lit="">
                    <path className="cvb-beam-halo" d={line.d} stroke={`url(#${gid}-${line.id})`} />
                    <path className="cvb-beam-core" d={line.d} stroke={`url(#${gid}-${line.id})`} />
                    <path
                      className="cvb-beam-head"
                      d="M-9 -5 L1 0 L-9 5 L-6.5 0 Z"
                      transform={`translate(${line.end.x} ${line.end.y}) rotate(${line.endAngle})`}
                    />
                  </g>
                );
              default:
                return assertNever(line, "cvB.InsideLines");
            }
          })}
        </g>
      </svg>
    </div>
  );
}
