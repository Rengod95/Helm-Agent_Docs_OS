// cvB 캔버스의 노드 부품(React Flow 사용자 노드). 노드 문법:
// - 블록 틀: 무채색 프리즘 틀(모서리 꺾쇠 + 위아래 머리카락 선). 궤도가 틀을 꿰뚫는다.
// - 경계: 궤도 위 작은 마름모와 이름.
// - 플러그인 결정: 종류별로 깎인 유리 판(glass.tsx) + 결정 문양 + 이름 + 한 줄. 베이스는 바닥 받침, 드래프트는 점선 테두리.
// - 묶음: 결정 무리 그릇. 펼치면 안에 결정이 들고, 접으면 한 덩이(구성원 문양 셋)가 된다.
// - Drive 자리: 궤도 안쪽의 점선 틀. 턴을 쥐는 Drive가 여기 선다.
// 선(궤도·기둥·빛줄기)은 노드 하나(`LinesNode`)가 SVG 한 장으로 그린다(노드 밑에 깔린다).
import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { Node, NodeProps } from "@xyflow/react";
import { ChevronDown } from "@caustic/react/icons";
import { createContext, use, useId, type Context, type DragEvent, type ReactNode } from "react";
import { GlassPlate, Gem, shapePath } from "./glass.tsx";
import { blockName, boundaryName, crystalAria, metaTag, metaText, titleText } from "./labels.ts";
import type { Layout, LayoutNode, Line } from "./layout.ts";

export type ItemNode = Node<{ readonly item: LayoutNode }>;
/** 선 층: under = 궤도·기둥·소켓(모든 노드 밑), beams = 핸드오프 빛줄기(묶음 판 위, 결정 밑) */
export type LinesLayer = "under" | "beams";
export type LinesFlowNode = Node<{ readonly layout: Layout; readonly layer: LinesLayer }>;

/** 노드가 화면 상태에 닿는 길(고른 것, 끌어 놓기, 묶음 접기) */
export interface CanvasActions {
  readonly selected: string | null;
  readonly dragging: string | null;
  readonly over: boolean;
  readonly setOver: (over: boolean) => void;
  readonly drop: () => void;
  readonly toggleGroup: (group: string) => void;
}

const NONE: CanvasActions = {
  selected: null,
  dragging: null,
  over: false,
  setOver: () => undefined,
  drop: () => undefined,
  toggleGroup: () => undefined,
};

export const CanvasActionsContext: Context<CanvasActions> = createContext<CanvasActions>(NONE);

/** 놓을 수 있는 자리의 끌기 처리기. 자리가 아니면 아무것도 하지 않는다(브라우저가 놓기를 거절한다) */
function dropHandlers(actions: CanvasActions, target: boolean) {
  if (!target || actions.dragging === null) return {};
  return {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!actions.over) actions.setOver(true);
    },
    onDragLeave: () => {
      actions.setOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      actions.drop();
    },
  };
}

export function StationNode(props: NodeProps<ItemNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const item = props.data.item;
  if (item.type !== "station") return null;
  const { w, h } = item.box;
  const k = 9;
  return (
    <div
      className="cvb-station"
      style={{ width: w, height: h }}
      data-target={item.target ? "" : undefined}
      data-filled={item.count > 0 ? "" : undefined}
      {...dropHandlers(actions, item.target)}
    >
      <svg className="cvb-station-frame" width={w} height={h} aria-hidden="true">
        <rect className="cvb-station-fill" x={0} y={0} width={w} height={h} rx={3} />
        <path
          className="cvb-station-hair"
          d={`M${k + 4} 3.5 H${w - k - 4} M${k + 4} ${h - 3.5} H${w - k - 4}`}
        />
        <path
          className="cvb-station-bracket"
          d={`M0 ${k} V0 H${k} M${w - k} 0 H${w} V${k} M${w} ${h - k} V${h} H${w - k} M${k} ${h} H0 V${h - k}`}
        />
      </svg>
      <span className="cvb-station-label">{blockName(item.block)}</span>
    </div>
  );
}

export function GateNode(props: NodeProps<ItemNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const item = props.data.item;
  if (item.type !== "gate") return null;
  return (
    <div
      className="cvb-gate"
      data-target={item.target ? "" : undefined}
      data-outside={item.outside ? "" : undefined}
      {...dropHandlers(actions, item.target)}
    >
      <svg
        width={18}
        height={18}
        viewBox="0 0 18 18"
        aria-hidden="true"
        style={{ overflow: "visible" }}
      >
        <path className="cvb-gate-mark" d="M9 1 L17 9 L9 17 L1 9 Z" />
      </svg>
      <span className="cvb-gate-label">{boundaryName(item.boundary)}</span>
    </div>
  );
}

export function CrystalNode(props: NodeProps<ItemNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const item = props.data.item;
  if (item.type !== "crystal") return null;
  const { plugin } = item;
  const tag = metaTag({ base: item.base, draft: plugin.draft === true, start: item.start });
  const selected = !item.ghost && actions.selected === plugin.id;
  return (
    <div
      className="cvb-crystal"
      data-kind={plugin.kind}
      data-ghost={item.ghost ? "" : undefined}
      data-over={item.ghost && actions.over ? "" : undefined}
      data-selected={selected ? "" : undefined}
      style={{ width: item.box.w, height: item.box.h }}
      {...dropHandlers(actions, item.ghost)}
    >
      <GlassPlate
        shape={plugin.kind}
        w={item.box.w}
        h={item.box.h}
        dashed={plugin.draft === true}
        pedestal={item.base}
      />
      <Gem kind={plugin.kind} size={plugin.kind === "drive" ? 22 : 20} />
      <span className="cvb-crystal-text">
        <span className="cvb-name">{plugin.id}</span>
        <span className="cvb-meta">{metaText(plugin)}</span>
      </span>
      {tag !== null && (
        <span
          className="cvb-tag"
          data-tag={plugin.draft === true ? "draft" : item.start ? "start" : "base"}
        >
          {tag}
        </span>
      )}
      {item.rank !== null && <span className="cvb-rank">{item.rank}</span>}
    </div>
  );
}

export function GroupNode(props: NodeProps<ItemNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const item = props.data.item;
  if (item.type !== "group") return null;
  const { w, h } = item.box;
  const selected = actions.selected === item.id;
  return (
    <div
      className="cvb-group"
      data-kind="group"
      data-closed={item.open ? undefined : ""}
      data-selected={selected ? "" : undefined}
    >
      <GlassPlate shape="group" w={w} h={h} />
      {item.open && (
        <svg className="cvb-plate" width={w} height={h} aria-hidden="true">
          <path
            className="cvb-group-inner"
            d={shapePath("group", w - 8, h - 8)}
            transform="translate(4 4)"
          />
        </svg>
      )}
      <div
        className="cvb-group-head"
        onClick={(e) => {
          e.stopPropagation();
          actions.toggleGroup(item.group.id);
        }}
      >
        <Gem kind="group" size={18} />
        <span>{titleText(item.group.title)}</span>
        <span className="cvb-group-count">{item.group.members.length}</span>
        {!item.open && (
          <span className="cvb-group-mini" aria-hidden="true">
            {item.kinds.map((kind, i) => (
              <Gem key={`${kind}-${String(i)}`} kind={kind} size={14} />
            ))}
          </span>
        )}
        <ChevronDown
          size={14}
          className="cvb-group-chev"
          aria-hidden="true"
          style={item.open ? { marginInlineStart: "auto" } : undefined}
        />
      </div>
    </div>
  );
}

export function ZoneNode(props: NodeProps<ItemNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const item = props.data.item;
  if (item.type !== "zone") return null;
  const { w, h } = item.box;
  const k = 14;
  return (
    <div
      className="cvb-zone"
      data-target={item.target ? "" : undefined}
      {...dropHandlers(actions, item.target)}
    >
      <svg className="cvb-zone-frame" width={w} height={h} aria-hidden="true">
        <rect className="cvb-zone-edge" x={0.5} y={0.5} width={w - 1} height={h - 1} rx={18} />
        <path
          className="cvb-zone-tick"
          d={`M0 ${k + 6} V6 Q0 0 6 0 H${k + 6} M${w - k - 6} 0 H${w - 6} Q${w} 0 ${w} 6 V${k + 6} M${w} ${h - k - 6} V${h - 6} Q${w} ${h} ${w - 6} ${h} H${w - k - 6} M${k + 6} ${h} H6 Q0 ${h} 0 ${h - 6} V${h - k - 6}`}
        />
      </svg>
      <span className="cvb-zone-label">{t("desktop.craft.canvas.cvB.zone.label")}</span>
      {item.empty && (
        <span className="cvb-zone-empty">{t("desktop.craft.canvas.cvB.zone.empty")}</span>
      )}
    </div>
  );
}

/** 선 한 장. 노드 밑(zIndex -1)에 깔리고 누르기를 받지 않는다 */
export function LinesNode(props: NodeProps<LinesFlowNode>): ReactNode {
  const { layout, layer } = props.data;
  const { bounds } = layout;
  const gid = useId();
  const lines = layout.lines.filter((line) => (line.kind === "beam") === (layer === "beams"));
  return (
    <div style={{ width: bounds.w, height: bounds.h, position: "relative" }}>
      <svg className="cvb-lines" width={bounds.w} height={bounds.h} aria-hidden="true">
        <defs>
          {lines.map((line) =>
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
          {lines.map((line) => (
            <LineShape key={line.id} line={line} gradient={`${gid}-${line.id}`} />
          ))}
          {layer === "under" &&
            layout.chevrons.map((c, i) => (
              <path
                key={`chev-${String(i)}`}
                className="cvb-chevron"
                d="M-3 -4 L2 0 L-3 4"
                transform={`translate(${c.at.x} ${c.at.y}) rotate(${c.angle})`}
              />
            ))}
          {layer === "under" &&
            layout.sockets.map((s) => (
              <path
                key={s.id}
                className="cvb-socket"
                data-lit={s.lit ? "" : undefined}
                d="M0 -4 L4 0 L0 4 L-4 0 Z"
                transform={`translate(${s.at.x} ${s.at.y})`}
              />
            ))}
        </g>
      </svg>
      {lines.map((line) =>
        line.kind === "beam" ? (
          <span
            key={`label-${line.id}`}
            className="cvb-beam-label"
            style={{ left: line.mid.x - bounds.x, top: line.mid.y - bounds.y }}
          >
            {t("desktop.craft.canvas.cvB.handoff")}
          </span>
        ) : null,
      )}
    </div>
  );
}

function LineShape(props: { readonly line: Line; readonly gradient: string }): ReactNode {
  const { line } = props;
  switch (line.kind) {
    case "track":
      return (
        <g>
          <path className="cvb-track-halo" d={line.d} />
          <path className="cvb-track" d={line.d} />
        </g>
      );
    case "entry":
      return <path className="cvb-entry" d={line.d} />;
    case "rod":
      return (
        <path
          className="cvb-rod"
          d={line.d}
          data-ghost={line.ghost ? "" : undefined}
          data-lit={line.lit ? "" : undefined}
        />
      );
    case "beam":
      return (
        <g className="cvb-beam" data-lit={line.lit ? "" : undefined}>
          <path className="cvb-beam-halo" d={line.d} stroke={`url(#${props.gradient})`} />
          <path className="cvb-beam-core" d={line.d} stroke={`url(#${props.gradient})`} />
          <path
            className="cvb-beam-head"
            d="M-9 -5 L1 0 L-9 5 L-6.5 0 Z"
            transform={`translate(${line.end.x} ${line.end.y}) rotate(${line.endAngle})`}
          />
          {line.back && (
            <path
              className="cvb-beam-tail"
              d="M-6 -4 L0 0 L-6 4"
              transform={`translate(${line.start.x} ${line.start.y}) rotate(${line.startAngle}) translate(-2 0)`}
            />
          )}
        </g>
      );
    default:
      return assertNever(line, "cvB.LineShape");
  }
}

/** 화면 읽기 이름(노드마다) */
export function ariaOf(item: LayoutNode): string | undefined {
  switch (item.type) {
    case "crystal":
      return crystalAria(
        item.plugin,
        metaTag({ base: item.base, draft: item.plugin.draft === true, start: item.start }),
        item.rank,
      );
    case "station":
      return t("desktop.craft.canvas.cvB.aria.station", {
        name: blockName(item.block),
        n: item.count,
      });
    case "gate":
      return t("desktop.craft.canvas.cvB.aria.station", {
        name: boundaryName(item.boundary),
        n: item.count,
      });
    case "group":
      return t(
        item.open
          ? "desktop.craft.canvas.cvB.aria.groupOpen"
          : "desktop.craft.canvas.cvB.aria.groupClosed",
        {
          name: titleText(item.group.title),
          n: item.group.members.length,
        },
      );
    case "zone":
      return undefined;
    default:
      return assertNever(item, "cvB.ariaOf");
  }
}
