// cvF 캔버스의 React Flow 노드: 플러그인 카드(종류마다 윤곽이 다르다), 묶음 구역(펼침)과 겹친 카드(접힘),
// 쌓인 줄의 참조 표·내장 도구 표, 장면(기준선·레일·정거장·붙는 선).
// 카드는 확대 단계마다 보여 주는 양이 다르다(뿌리의 `data-lod`를 CSS가 읽는다): 가까이 = 목적·구성 요소까지, 중간 = 이름·자리·구성 수, 멀리 = 큰 이름.
// 노드는 끌지 않는다(자리가 뜻이다). 누르면 고르고, 두 번 누르거나 Enter면 안으로 들어간다.
import { t } from "@fresnel/client/i18n";
import { Handle, Position, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import {
  createContext,
  use,
  type Context,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { agoText } from "../shared-sample.ts";
import { DecisionGlyph, KIND_COLOR, KindGlyph, KindTile, earPath, outlinePath } from "./glyphs.tsx";
import {
  BLOCK_H,
  BLOCK_W,
  CARD_H,
  CARD_W,
  RETURN_Y,
  STACK_OFFSET,
  ZONE_HEAD,
  type ItemGeo,
  type Layout,
  type ZoneGeo,
} from "./layout.ts";
import type { Kind, Plugin, Source } from "./model.ts";
import { DECISION_WORD, KIND_WORD, SPOT_WORD, STOP_WORD, metaLine, partsLine } from "./words.ts";

/** 노드가 캔버스에 알리는 일 */
export interface CanvasActions {
  select(id: string): void;
  open(name: string): void;
  toggleZone(id: string): void;
  focus(name: string): void;
  key(id: string, e: KeyboardEvent<HTMLElement>): void;
}

const NOOP: CanvasActions = {
  select: () => undefined,
  open: () => undefined,
  toggleZone: () => undefined,
  focus: () => undefined,
  key: () => undefined,
};

export const CanvasActionsContext: Context<CanvasActions> = createContext<CanvasActions>(NOOP);

interface PluginNodeData extends Record<string, unknown> {
  readonly spec: Plugin;
  readonly order: number;
  /** 같은 자리의 개수(2 이상이면 순서 풍선을 단다) */
  readonly total: number;
  readonly source: Source;
  readonly start: boolean;
  readonly selected: boolean;
  /** 패널에서 눌러 포커스가 왔다(한 번 빛난다). 값이 바뀌면 다시 빛난다 */
  readonly pulse: number;
  /** 묶음 구역 안이면 부품 번호(A1…) */
  readonly mark: string | null;
  /** 레일 위(재료)면 풍선이 아래에, 아래(Hook)면 위에 */
  readonly side: "above" | "below" | "band";
}

interface ZoneNodeData extends Record<string, unknown> {
  readonly zone: ZoneGeo;
  readonly purpose: string;
  readonly version: string;
  readonly kinds: readonly Kind[];
  readonly selected: boolean;
  readonly pulse: number;
}

interface MarkNodeData extends Record<string, unknown> {
  readonly geo: ItemGeo;
  readonly selected: boolean;
}

interface SceneNodeData extends Record<string, unknown> {
  readonly layout: Layout;
}

type PluginFlowNode = Node<PluginNodeData, "plugin">;
type ZoneFlowNode = Node<ZoneNodeData, "zone">;
type MarkFlowNode = Node<MarkNodeData, "mark">;
type SceneFlowNode = Node<SceneNodeData, "scene">;
export type CanvasNode = PluginFlowNode | ZoneFlowNode | MarkFlowNode | SceneFlowNode;

/** 관계 선이 닿는 네 곳. 연결은 하지 않는다(그리기만) */
function Handles(): ReactElement {
  return (
    <>
      <Handle
        type="source"
        id="t"
        position={Position.Top}
        isConnectable={false}
        className="cvf-handle"
      />
      <Handle
        type="source"
        id="b"
        position={Position.Bottom}
        isConnectable={false}
        className="cvf-handle"
      />
      <Handle
        type="source"
        id="l"
        position={Position.Left}
        isConnectable={false}
        className="cvf-handle"
      />
      <Handle
        type="source"
        id="r"
        position={Position.Right}
        isConnectable={false}
        className="cvf-handle"
      />
    </>
  );
}

/** 고른 노드의 표식: 도면의 맞춤 표처럼 네 귀퉁이에 짧은 꺾쇠 */
function Corners(props: { readonly w: number; readonly h: number }): ReactElement {
  const { w, h } = props;
  const o = 7;
  const l = 10;
  return (
    <svg className="cvf-corners" width={w + o * 2} height={h + o * 2} aria-hidden="true">
      <g transform={`translate(${String(o)} ${String(o)})`}>
        <path
          d={`M${-o} ${-o + l}V${-o}H${-o + l}M${w + o - l} ${-o}H${w + o}V${-o + l}M${w + o} ${h + o - l}V${h + o}H${w + o - l}M${-o + l} ${h + o}H${-o}V${h + o - l}`}
        />
      </g>
    </svg>
  );
}

function StatusChips(props: {
  readonly spec: Plugin;
  readonly source: Source;
  readonly start: boolean;
}): ReactNode {
  const { spec, source, start } = props;
  const chips: ReactElement[] = [];
  if (spec.ext.review.state === "pending" || spec.ext.review.state === "draft")
    chips.push(
      <span key="review" className="cvf-chip" data-tone="warning">
        {t(
          spec.ext.review.state === "pending"
            ? "desktop.craft.canvas.cvF.review.pending"
            : "desktop.craft.canvas.cvF.review.draft",
        )}
      </span>,
    );
  if (spec.ext.health === "stopped" || spec.ext.health === "error")
    chips.push(
      <span key="health" className="cvf-chip" data-tone="danger">
        {t(
          spec.ext.health === "stopped"
            ? "desktop.craft.canvas.cvF.health.stopped"
            : "desktop.craft.canvas.cvF.health.error",
        )}
      </span>,
    );
  if (start)
    chips.push(
      <span key="start" className="cvf-chip" data-tone="kind">
        {t("desktop.craft.canvas.cvF.startDrive")}
      </span>,
    );
  if (spec.guard === true)
    chips.push(
      <span key="guard" className="cvf-chip" data-tone="kind">
        {t("desktop.craft.canvas.cvF.guard")}
      </span>,
    );
  if (source.kind === "base")
    chips.push(
      <span key="base" className="cvf-chip cvf-hatch">
        {t("desktop.craft.canvas.cvF.base")}
      </span>,
    );
  if (chips.length === 0) return null;
  return <span className="cvf-chips">{chips}</span>;
}

function PluginNode(props: NodeProps<PluginFlowNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const { spec, order, total, source, start, selected, pulse, mark, side } = props.data;
  const draft = spec.ext.review.state !== "approved";
  const label = t("desktop.craft.canvas.cvF.node.label", {
    name: spec.name,
    kind: t(KIND_WORD[spec.kind]),
    spot: t(SPOT_WORD[spec.spot]),
  });
  return (
    <div
      className="cvf-card"
      data-kind={spec.kind}
      data-plugin={spec.name}
      data-selected={selected}
      data-draft={draft}
      data-pulse={pulse % 2 === 0 ? "a" : "b"}
      data-pulsing={pulse > 0}
      style={{ width: CARD_W, height: CARD_H, color: KIND_COLOR[spec.kind] }}
      aria-label={label}
      onDoubleClick={() => {
        actions.open(spec.name);
      }}
    >
      <svg className="cvf-outline" width={CARD_W} height={CARD_H} aria-hidden="true">
        <path className="cvf-outline-fill" d={outlinePath(spec.kind, CARD_W, CARD_H)} />
        {spec.kind === "inject" ? <path className="cvf-outline-ear" d={earPath(CARD_W)} /> : null}
        <rect className="cvf-kind-rule" x={0.5} y={10} width={2} height={CARD_H - 20} rx={1} />
      </svg>
      {selected ? <Corners w={CARD_W} h={CARD_H} /> : null}
      <div className="cvf-near">
        <div className="cvf-row">
          <KindTile kind={spec.kind} size={20} draft={draft} />
          <span className="cvf-name">{spec.name}</span>
          {mark !== null ? <span className="cvf-mark">{mark}</span> : null}
        </div>
        <div className="cvf-meta">
          {spec.decision !== undefined ? (
            <span className="cvf-decision" title={t(DECISION_WORD[spec.decision])}>
              <DecisionGlyph decision={spec.decision} />
            </span>
          ) : null}
          <span className="truncate">{metaLine(spec)}</span>
        </div>
        <p className="cvf-purpose">{t(spec.ext.purpose)}</p>
        <div className="cvf-foot">
          <span className="cvf-parts truncate">{partsLine(spec)}</span>
          <StatusChips spec={spec} source={source} start={start} />
          <span className="cvf-ago">{agoText(spec.lastUsedMin)}</span>
        </div>
      </div>
      <div className="cvf-far" aria-hidden="true">
        <KindGlyph kind={spec.kind} size={30} />
        <span className="cvf-far-name">{spec.name}</span>
        <StatusChips spec={spec} source={source} start={start} />
      </div>
      {total > 1 && side !== "band" ? (
        <span className="cvf-balloon" data-side={side} aria-hidden="true">
          {order}
        </span>
      ) : null}
      <Handles />
    </div>
  );
}

function ZoneNode(props: NodeProps<ZoneFlowNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const { zone, purpose, version, kinds, selected, pulse } = props.data;
  const toggle = (
    <button
      type="button"
      className="cvf-zone-toggle nodrag"
      aria-expanded={!zone.collapsed}
      aria-label={t(
        zone.collapsed
          ? "desktop.craft.canvas.cvF.zone.expand"
          : "desktop.craft.canvas.cvF.zone.collapse",
        { name: zone.id },
      )}
      onClick={(e) => {
        e.stopPropagation();
        actions.toggleZone(zone.id);
      }}
    >
      <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
        <path
          d={zone.collapsed ? "M4.5 3 7.5 6 4.5 9" : "M3 4.5 6 7.5 9 4.5"}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
  const head = (
    <div className="cvf-zone-head">
      <span className="cvf-zone-letter">{zone.letter}</span>
      <span className="cvf-zone-name">{zone.id}</span>
      <span className="cvf-zone-meta">
        {t("desktop.craft.canvas.cvF.zone.meta", { n: zone.members.length, version })}
      </span>
      {toggle}
    </div>
  );
  if (!zone.collapsed) {
    return (
      <div
        className="cvf-zone"
        data-zone={zone.id}
        data-selected={selected}
        data-pulse={pulse % 2 === 0 ? "a" : "b"}
        data-pulsing={pulse > 0}
        style={{ width: zone.w, height: zone.h }}
      >
        <svg className="cvf-zone-line" width={zone.w} height={zone.h} aria-hidden="true">
          <rect x={0.5} y={0.5} width={zone.w - 1} height={zone.h - 1} rx={10} />
        </svg>
        {head}
        <Handles />
      </div>
    );
  }
  const w = CARD_W;
  const h = CARD_H;
  return (
    <div
      className="cvf-zone cvf-zone-closed"
      data-zone={zone.id}
      data-selected={selected}
      data-pulse={pulse % 2 === 0 ? "a" : "b"}
      data-pulsing={pulse > 0}
      style={{ width: zone.w, height: zone.h }}
      onDoubleClick={() => {
        actions.toggleZone(zone.id);
      }}
    >
      {head}
      <div
        className="cvf-stack"
        style={{ top: ZONE_HEAD, width: w + STACK_OFFSET * 2, height: h + STACK_OFFSET * 2 }}
      >
        <span
          className="cvf-stack-sheet"
          style={{ left: STACK_OFFSET * 2, top: STACK_OFFSET * 2, width: w, height: h }}
        />
        <span
          className="cvf-stack-sheet"
          style={{ left: STACK_OFFSET, top: STACK_OFFSET, width: w, height: h }}
        />
        <div className="cvf-stack-front" style={{ width: w, height: h }}>
          {selected ? <Corners w={w} h={h} /> : null}
          <div className="cvf-near">
            <div className="cvf-row">
              <span className="cvf-kinds">
                {kinds.map((k) => (
                  <KindTile key={k} kind={k} size={18} />
                ))}
              </span>
              <span className="cvf-name">{zone.id}</span>
            </div>
            <div className="cvf-meta">
              <span className="truncate">
                {t("desktop.craft.canvas.cvF.zone.closedMeta", { n: zone.members.length })}
              </span>
            </div>
            <p className="cvf-purpose">{purpose}</p>
            <div className="cvf-foot">
              <span className="cvf-parts truncate">{zone.members.join(" · ")}</span>
            </div>
          </div>
          <div className="cvf-far" aria-hidden="true">
            <span className="cvf-zone-letter cvf-zone-letter-far">{zone.letter}</span>
            <span className="cvf-far-name">{zone.id}</span>
          </div>
        </div>
      </div>
      <Handles />
    </div>
  );
}

/** 쌓인 줄 안의 표: 묶음 구역에 있는 구성원의 참조(누르면 그리로 간다), 또는 바뀐 내장 도구 */
function MarkNode(props: NodeProps<MarkFlowNode>): ReactNode {
  const actions = use(CanvasActionsContext);
  const { geo, selected } = props.data;
  const item = geo.item;
  if (item.type === "builtin") {
    return (
      <div
        className="cvf-ref cvf-builtin"
        style={{ width: geo.w, height: geo.h }}
        data-builtin={item.tool}
      >
        <span className="cvf-ref-name cvf-struck">{item.tool}</span>
        <span className="cvf-ref-note">
          {t("desktop.craft.canvas.cvF.builtin", { by: item.by })}
        </span>
        <Handles />
      </div>
    );
  }
  if (item.type === "card") return null;
  return (
    <button
      type="button"
      className="cvf-ref nodrag"
      data-selected={selected}
      data-ref={item.name}
      style={{ width: geo.w, height: geo.h }}
      aria-label={t("desktop.craft.canvas.cvF.ref.label", {
        mark: item.mark,
        name: item.name,
        zone: item.zone,
      })}
      onClick={(e) => {
        e.stopPropagation();
        actions.focus(item.name);
      }}
    >
      <span className="cvf-balloon cvf-balloon-inline" aria-hidden="true">
        {geo.order}
      </span>
      <span className="cvf-ref-mark">{item.mark}</span>
      <span className="cvf-ref-name">{item.name}</span>
      <span className="cvf-ref-note">
        {t("desktop.craft.canvas.cvF.ref.inZone", { zone: item.zone })}
      </span>
      <Handles />
    </button>
  );
}

/** 장면: 기준선 셋(A 재료, B Hook, C Drive), 구간 번호, 레일과 정거장, Hook 자리 마름모, 붙는 선, 다음 입력으로 돌아가는 선 */
function SceneNode(props: NodeProps<SceneFlowNode>): ReactNode {
  const { layout } = props.data;
  const { bounds, datums, stops, points } = layout;
  const left = bounds.x;
  const right = bounds.x + bounds.w;
  const far = 4000;
  const first = stops[0]?.x ?? 0;
  const last = stops.at(-1)?.x ?? 0;
  const input = stops.find((s) => s.id === "input-received")?.x ?? 0;
  const end = stops.find((s) => s.id === "before-turn-end")?.x ?? 0;
  const datumRows: readonly (readonly [string, number, string])[] = [
    ["A", datums.feed, t("desktop.craft.canvas.cvF.datum.feed")],
    ["B", datums.hook, t("desktop.craft.canvas.cvF.datum.hook")],
    ["C", datums.drive, t("desktop.craft.canvas.cvF.datum.drive")],
  ];
  return (
    <svg
      className="cvf-scene"
      width={bounds.w}
      height={bounds.h}
      viewBox={`${String(bounds.x)} ${String(bounds.y)} ${String(bounds.w)} ${String(bounds.h)}`}
      aria-hidden="true"
    >
      {/* 기준선: 끝없이 가로로 흐르는 가는 사슬선과 왼쪽 이름표 */}
      {datumRows.map(([letter, y, word]) => (
        <g key={letter} className="cvf-datum">
          <path d={`M${String(left - far)} ${String(y)}H${String(right + far)}`} />
          <g transform={`translate(${String(left + 12)} ${String(y)})`}>
            <circle r={8} cx={8} cy={0} />
            <text x={8} y={3.5} textAnchor="middle" className="cvf-datum-letter">
              {letter}
            </text>
            <text x={22} y={-6} className="cvf-datum-word">
              {word}
            </text>
          </g>
          {stops.map((s) => (
            <path
              key={s.id}
              className="cvf-tick"
              d={`M${String(s.x)} ${String(y - 4)}V${String(y + 4)}`}
            />
          ))}
        </g>
      ))}
      {/* 구간 번호: 도면 테두리의 칸 번호처럼 맨 위에 */}
      {stops.map((s) =>
        s.n === null ? null : (
          <g key={s.id} className="cvf-colref">
            <path d={`M${String(s.x)} ${String(bounds.y + 22)}V${String(bounds.y + 30)}`} />
            <text x={s.x} y={bounds.y + 16} textAnchor="middle">
              {String(s.n).padStart(2, "0")}
            </text>
          </g>
        ),
      )}
      {/* 레일 */}
      <path
        className="cvf-rail"
        d={`M${String(first - 28)} 0H${String(last + BLOCK_W / 2 + 28)}`}
      />
      <path
        className="cvf-rail-arrow"
        d={`M${String(last + BLOCK_W / 2 + 22)} -4 ${String(last + BLOCK_W / 2 + 30)} 0 ${String(last + BLOCK_W / 2 + 22)} 4`}
      />
      {/* 다음 입력으로 */}
      <path
        className="cvf-return"
        d={`M${String(end)} 7V${String(RETURN_Y)}H${String(input)}V9`}
        markerEnd="url(#cvf-m-arrow)"
      />
      <text className="cvf-return-word" x={(input + end) / 2} y={RETURN_Y - 5} textAnchor="middle">
        {t("desktop.craft.canvas.cvF.nextInput")}
      </text>
      {/* 붙는 선 */}
      {layout.wires.map((d) => (
        <path key={d} className="cvf-wire" d={d} />
      ))}
      {layout.startWire !== null ? (
        <path
          className="cvf-wire cvf-wire-start"
          d={layout.startWire}
          markerEnd="url(#cvf-m-arrow)"
        />
      ) : null}
      {/* 정거장 */}
      {stops.map((s) =>
        s.type === "block" ? (
          <g
            key={s.id}
            className="cvf-block"
            transform={`translate(${String(s.x - BLOCK_W / 2)} ${String(-BLOCK_H / 2)})`}
          >
            <rect width={BLOCK_W} height={BLOCK_H} rx={6} />
            <text x={10} y={BLOCK_H / 2 + 4} className="cvf-block-n">
              {String(s.n ?? 0).padStart(2, "0")}
            </text>
            <text x={30} y={BLOCK_H / 2 + 4.5} className="cvf-block-name">
              {t(STOP_WORD[s.id])}
            </text>
          </g>
        ) : (
          <g key={s.id} className="cvf-boundary" transform={`translate(${String(s.x)} 0)`}>
            <circle r={6} />
            <text y={-14} textAnchor="middle">
              {t(STOP_WORD[s.id])}
            </text>
          </g>
        ),
      )}
      {/* Hook 자리: 쓰인 자리는 찬 마름모, 빈 자리는 빈 마름모 */}
      {points.map((p) => (
        <path
          key={p.spot}
          className="cvf-point"
          data-filled={p.filled}
          d={`M${String(p.x)} -6 ${String(p.x + 6)} 0 ${String(p.x)} 6 ${String(p.x - 6)} 0Z`}
        />
      ))}
    </svg>
  );
}

export const NODE_TYPES: NodeTypes = {
  plugin: PluginNode,
  zone: ZoneNode,
  mark: MarkNode,
  scene: SceneNode,
};
