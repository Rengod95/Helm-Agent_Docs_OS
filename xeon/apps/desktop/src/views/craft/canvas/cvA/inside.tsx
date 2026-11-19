// cvA 플러그인 내부: 노드를 열면(더블클릭·Enter) 들어오는 화면. 위 왼쪽 경로(프로필 / 플러그인)로 돌아간다(Esc도 된다).
// 구성 요소 노드: 재료(지침·스킬·도구·MCP 서버·메모리), Drive 단계(육각 판, 나란히 도는 갈래), Hook 핸들러(붙는 곳과 결정 셋),
// 핸드오프 상대(점선 판), 설정 판, 권한 판(위험 등급 세 칸 눈금). 가운데 가로줄은 프로필 캔버스의 레일과 같은 문법이다.
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { ReactFlow, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useId, useMemo, type ReactNode } from "react";
import { useCraftTheme } from "../../orbit.tsx";
import { Backdrop } from "./backdrop.tsx";
import { KIND_INK, KindGlyph, StepGlyph, UnitGlyph } from "./glyphs.tsx";
import {
  HANDLER_H,
  HANDLER_W,
  layoutInside,
  type InsideLayout,
  type InsideNode,
} from "./inside-layout.ts";
import { TAG_H, TAG_W } from "./layout.ts";
import { DECISIONS, RISKS, type Catalog, type PluginSpec, type Risk } from "./model.ts";
import { Plate } from "./plate.tsx";
import {
  DECISION_KEY,
  GRANT_KEY,
  KIND_KEY,
  RISK_KEY,
  STEP_KEY,
  UNIT_KEY,
  portName,
  stationName,
} from "./words.ts";

interface ItemData extends Record<string, unknown> {
  readonly node: InsideNode;
  readonly catalog: Catalog;
}
interface SceneData extends Record<string, unknown> {
  readonly layout: InsideLayout;
}
type ItemFlowNode = Node<ItemData, "item">;
type SceneFlowNode = Node<SceneData, "iscene">;

function Head(props: { readonly title: string; readonly sub?: string }): ReactNode {
  return (
    <div className="flex h-9 items-center justify-between border-b border-[var(--cva-line-soft)] px-3">
      <span className="text-[12px] font-medium text-text-secondary">{props.title}</span>
      {props.sub === undefined ? null : (
        <span className="cva-mono text-[11px] text-text-tertiary">{props.sub}</span>
      )}
    </div>
  );
}

/** 위험 등급 눈금: 읽기 1칸, 쓰기 2칸, 실행 3칸 */
function RiskGauge(props: { readonly risk: Risk }): ReactNode {
  const level = RISKS.indexOf(props.risk) + 1;
  return (
    <span className="flex items-center gap-2">
      <span className="cva-mono w-8 text-end text-[11px] text-text-secondary">
        {t(RISK_KEY[props.risk])}
      </span>
      <span aria-hidden className="flex gap-[3px]">
        {RISKS.map((r, i) => (
          <span
            key={r}
            className="h-2.5 w-3"
            style={{
              background:
                i < level
                  ? i === 2
                    ? "var(--cs-color-danger-graphic)"
                    : "var(--cva-line-hot)"
                  : "transparent",
              boxShadow: "inset 0 0 0 1px var(--cva-line)",
            }}
          />
        ))}
      </span>
    </span>
  );
}

function ItemNode(props: NodeProps<ItemFlowNode>): ReactNode {
  const { node, catalog } = props.data;
  const { item, w, h } = node;
  switch (item.type) {
    case "part":
      return (
        <div className="cva-node relative" data-kind="group" style={{ width: w, height: h }}>
          <Plate shape="group" w={w} h={h} />
          <div className="relative flex h-full items-center gap-2 px-2.5">
            <span className="flex text-text-secondary">
              <UnitGlyph unit={item.part.unit} size={15} />
            </span>
            <span className="cva-mono min-w-0 flex-1 truncate text-[12px] text-text-primary">
              {item.part.label}
            </span>
            <span className="text-[11px] text-text-tertiary">{t(UNIT_KEY[item.part.unit])}</span>
          </div>
        </div>
      );
    case "step":
      return (
        <div className="cva-node relative" data-kind="drive" style={{ width: w, height: h }}>
          <svg aria-hidden className="cva-plate-svg" width={w} height={h}>
            <path className="cva-plate-fill" d={hexPath(w, h)} />
            <path className="cva-plate-line" d={hexPath(w, h)} />
            <path
              className="cva-plate-touch"
              d={`M14 0L0 ${h / 2}L14 ${h}M${w - 14} 0L${w} ${h / 2}L${w - 14} ${h}`}
            />
          </svg>
          <div className="relative flex h-full items-center justify-center gap-2 px-5">
            <span className="flex" style={{ color: "var(--cva-drive)" }}>
              <StepGlyph size={13} />
            </span>
            <span className="text-[13px] font-medium text-text-primary">
              {t(STEP_KEY[item.step.step])}
            </span>
            {item.lane > 0 ? (
              <span className="cva-mono text-[11px] text-text-tertiary">{String(item.lane)}</span>
            ) : null}
          </div>
        </div>
      );
    case "handler":
      return (
        <div
          className="cva-node relative"
          data-kind="hook"
          style={{ width: HANDLER_W, height: HANDLER_H }}
        >
          <Plate shape="hook" w={HANDLER_W} h={HANDLER_H} />
          <div className="relative flex h-full flex-col gap-2 px-3.5 pt-3">
            <div className="flex items-center gap-2">
              <span className="flex" style={{ color: "var(--cva-hook)" }}>
                <KindGlyph kind="hook" size={15} />
              </span>
              <span className="text-[13px] font-medium text-text-primary">
                {t("desktop.craft.canvas.cvA.inside.handler")}
              </span>
              {item.guard ? (
                <span className="cva-mono ms-auto text-[11px] text-text-tertiary">
                  {t("desktop.craft.canvas.cvA.mark.guard")}
                </span>
              ) : null}
            </div>
            <div className="cva-mono text-[11px] text-text-secondary">{portName(item.port)}</div>
            <div
              className="flex gap-1"
              role="list"
              aria-label={t("desktop.craft.canvas.cvA.readout.decision")}
            >
              {DECISIONS.map((d) => (
                <span
                  key={d}
                  role="listitem"
                  aria-current={d === item.decision}
                  className={`flex h-6 flex-1 items-center justify-center text-[12px] ${d === item.decision ? "text-text-primary" : "text-text-tertiary"}`}
                  style={{
                    boxShadow:
                      d === item.decision
                        ? "inset 0 0 0 1px var(--cva-hook)"
                        : "inset 0 0 0 1px var(--cva-line-soft)",
                    background:
                      d === item.decision
                        ? "color-mix(in oklab, var(--cva-hook) 14%, transparent)"
                        : undefined,
                  }}
                >
                  {t(DECISION_KEY[d])}
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    case "ghost": {
      const spec = catalog.get(item.name);
      const kind = spec?.kind ?? "drive";
      return (
        <div
          className="cva-node relative opacity-80"
          data-kind={kind}
          data-draft="true"
          style={{ width: w, height: h }}
        >
          <Plate shape={kind} w={w} h={h} />
          <div className="relative flex h-full items-center gap-2 px-3">
            <span className="flex" style={{ color: KIND_INK[kind] }}>
              <KindGlyph kind={kind} size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
              {item.name}
            </span>
            <span className="cva-mono text-[11px] text-text-tertiary">{t(KIND_KEY[kind])}</span>
          </div>
        </div>
      );
    }
    case "settings":
      return (
        <div className="cva-panel relative" style={{ width: w, height: h }}>
          <Head title={t("desktop.craft.canvas.cvA.inside.settings")} />
          <dl className="m-0 px-3 py-1">
            {item.rows.map((s) => (
              <div key={s.key} className="flex h-[26px] items-center justify-between gap-3">
                <dt className="cva-mono shrink-0 text-[11px] text-text-tertiary">{s.key}</dt>
                <dd
                  title={s.value}
                  className="cva-mono m-0 min-w-0 truncate text-[11px] text-text-primary"
                >
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "grants":
      return (
        <div className="cva-panel relative" style={{ width: w, height: h }}>
          <Head title={t("desktop.craft.canvas.cvA.inside.grants")} />
          <ul className="m-0 list-none px-3 py-1">
            {item.rows.length === 0 ? (
              <li className="flex h-[26px] items-center text-[12px] text-text-tertiary">
                {t("desktop.craft.canvas.cvA.inside.noGrants")}
              </li>
            ) : (
              item.rows.map((g) => (
                <li key={g.id} className="flex h-[26px] items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[12px] text-text-primary">
                    {t(GRANT_KEY[g.id])}
                  </span>
                  <RiskGauge risk={g.risk} />
                </li>
              ))
            )}
          </ul>
          {item.code ? (
            <div className="mx-3 border-t border-[var(--cva-line-soft)] py-2 text-[11px] leading-4 text-text-secondary">
              {t("desktop.craft.canvas.cvA.inside.codeNote")}
            </div>
          ) : null}
        </div>
      );
    default:
      return assertNever(item, "InsideItem");
  }
}

function hexPath(w: number, h: number): string {
  return `M14 0H${w - 14}L${w} ${h / 2}L${w - 14} ${h}H14L0 ${h / 2}Z`;
}

function InsideScene(props: NodeProps<SceneFlowNode>): ReactNode {
  const { layout } = props.data;
  const { bounds } = layout;
  const uid = useId().replace(/:/g, "");
  const arrow = `cva-in-arrow-${uid}`;
  return (
    <svg
      aria-hidden
      className="cva-scene overflow-visible"
      width={bounds.w}
      height={bounds.h}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
    >
      <defs>
        <marker
          id={arrow}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M1 1.5 8 5 1 8.5" fill="none" stroke="var(--cva-drive)" strokeWidth="1.4" />
        </marker>
      </defs>
      {layout.line === null ? null : (
        <line
          x1={layout.line.x1}
          x2={layout.line.x2}
          y1={0}
          y2={0}
          stroke="var(--cva-line-soft)"
          strokeDasharray="2 4"
        />
      )}
      {layout.spans.map((s) => (
        <path
          key={`${s.x1}:${s.y}`}
          d={`M${s.x1} ${s.y + s.tick}V${s.y}H${s.x2}V${s.y + s.tick}`}
          fill="none"
          stroke="var(--cva-line-hot)"
        />
      ))}
      {layout.links.map((l) =>
        l.type === "handoff" ? (
          <g key={l.id}>
            <path
              d={l.d}
              fill="none"
              stroke="color-mix(in oklab, var(--cva-drive) 22%, transparent)"
              strokeWidth={6}
              strokeLinecap="round"
            />
            <path
              d={l.d}
              fill="none"
              stroke="var(--cva-drive)"
              strokeWidth={1.25}
              strokeDasharray="5 4"
              markerEnd={`url(#${arrow})`}
            />
          </g>
        ) : (
          <path
            key={l.id}
            d={l.d}
            fill="none"
            stroke={l.type === "flow" ? "var(--cva-line-hot)" : "var(--cva-line)"}
            strokeWidth={l.type === "flow" ? 1.25 : 1}
          />
        ),
      )}
      {layout.marks.map((m) => {
        const key = `${m.kind}:${m.x}`;
        if (m.kind === "station" && m.station !== undefined) {
          const w = TAG_W / 2;
          const h = TAG_H / 2;
          return (
            <g key={key}>
              <path
                d={`M${m.x - w + 5} ${-h}H${m.x + w}V${h - 5}L${m.x + w - 5} ${h}H${m.x - w}V${-h + 5}Z`}
                fill="var(--cva-panel)"
                stroke="var(--cva-line)"
              />
              <text x={m.x} y={4.5} textAnchor="middle" className="cva-station-name">
                {stationName(m.station)}
              </text>
            </g>
          );
        }
        if (m.kind === "boundary" && m.station !== undefined)
          return (
            <g key={key}>
              <line x1={m.x} y1={-15} x2={m.x} y2={15} stroke="var(--cva-line-hot)" />
              <text x={m.x + 7} y={-21} className="cva-tertiary">
                {stationName(m.station)}
              </text>
            </g>
          );
        if (m.kind === "port")
          return (
            <path
              key={key}
              d={`M${m.x - 5} -5V2a5 5 0 0 0 10 0V-5`}
              fill="none"
              stroke="var(--cva-hook)"
              strokeWidth={1.5}
            />
          );
        if (m.kind === "entry")
          return (
            <g key={key}>
              <circle
                cx={m.x}
                cy={0}
                r={6}
                fill="var(--cs-color-bg-canvas)"
                stroke="var(--cva-drive)"
              />
              <text x={m.x} y={-14} textAnchor="middle" className="cva-tertiary">
                {t("desktop.craft.canvas.cvA.inside.entry")}
              </text>
            </g>
          );
        if (m.kind === "exit")
          return (
            <g key={key}>
              <path
                d={`M${m.x - 6} -6 ${m.x + 2} 0 ${m.x - 6} 6`}
                fill="none"
                stroke="var(--cva-drive)"
                strokeWidth={1.5}
              />
              <text x={m.x} y={22} textAnchor="middle" className="cva-tertiary">
                {t("desktop.craft.canvas.cvA.readout.handoff")}
              </text>
            </g>
          );
        return (
          <rect key={key} x={m.x - 4} y={-4} width={8} height={8} fill="var(--cva-line-hot)" />
        );
      })}
    </svg>
  );
}

const INSIDE_TYPES = { item: ItemNode, iscene: InsideScene };

function ariaOf(node: InsideNode): string {
  const item = node.item;
  switch (item.type) {
    case "part":
      return `${t(UNIT_KEY[item.part.unit])} ${item.part.label}`;
    case "step":
      return t(STEP_KEY[item.step.step]);
    case "handler":
      return `${t("desktop.craft.canvas.cvA.inside.handler")}, ${portName(item.port)}, ${t(DECISION_KEY[item.decision])}`;
    case "ghost":
      return item.name;
    case "settings":
      return t("desktop.craft.canvas.cvA.inside.settings");
    case "grants":
      return t("desktop.craft.canvas.cvA.inside.grants");
    default:
      return assertNever(item, "InsideItem");
  }
}

export interface InsideBoardProps {
  readonly spec: PluginSpec;
  readonly catalog: Catalog;
  readonly profileTitle: string;
  readonly start: boolean;
  readonly receivesFrom: string | null;
  readonly onBack: () => void;
}

export function InsideBoard(props: InsideBoardProps): ReactNode {
  const { spec, catalog } = props;
  const rf = useReactFlow();
  const theme = useCraftTheme();
  const layout = useMemo(
    () => layoutInside(spec, props.start, props.receivesFrom),
    [spec, props.start, props.receivesFrom],
  );
  const nodes = useMemo((): (ItemFlowNode | SceneFlowNode)[] => {
    const list: (ItemFlowNode | SceneFlowNode)[] = [
      {
        id: "iscene",
        type: "iscene",
        position: { x: layout.bounds.x, y: layout.bounds.y },
        width: layout.bounds.w,
        height: layout.bounds.h,
        data: { layout },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: -1,
      },
    ];
    for (const n of layout.nodes) {
      list.push({
        id: n.id,
        type: "item",
        position: { x: n.x, y: n.y },
        width: n.w,
        height: n.h,
        data: { node: n, catalog },
        ariaLabel: ariaOf(n),
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 1,
      });
    }
    return list;
  }, [layout, catalog]);

  useEffect(() => {
    detach(
      rf.fitView({
        padding: { top: "84px", left: "48px", right: "48px", bottom: "56px" },
        maxZoom: 1.2,
        duration: 0,
      }),
      rethrow,
    );
  }, [rf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [props]);

  return (
    <div className="cva-root relative min-h-0 flex-1 overflow-hidden">
      <ReactFlow
        className="cva-flow"
        nodes={nodes}
        edges={[]}
        nodeTypes={INSIDE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable
        disableKeyboardA11y
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.35}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        aria-label={t("desktop.craft.canvas.cvA.inside.canvas", { name: spec.name })}
        onNodeClick={() => undefined}
      >
        <Backdrop theme={theme} />
      </ReactFlow>
      <nav
        aria-label={t("desktop.craft.canvas.cvA.inside.path")}
        className="cva-panel absolute top-3 left-3 z-10 flex h-10 items-center gap-1 ps-1.5 pe-3"
      >
        <button
          type="button"
          onClick={props.onBack}
          aria-label={t("desktop.craft.canvas.cvA.inside.back")}
          className="cva-row flex h-7 items-center gap-1.5 px-2 text-[12px] text-text-secondary"
        >
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
            <path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          {props.profileTitle}
        </button>
        <span aria-hidden className="cva-mono text-[12px] text-text-tertiary">
          /
        </span>
        <span className="flex items-center gap-2 ps-1" aria-current="page">
          <span className="flex" style={{ color: KIND_INK[spec.kind] }}>
            <KindGlyph kind={spec.kind} size={15} />
          </span>
          <span className="text-[13px] font-medium text-text-primary">{spec.name}</span>
          <span className="cva-mono text-[11px] text-text-tertiary">{t(KIND_KEY[spec.kind])}</span>
          {spec.draft === true ? (
            <span className="cva-mono text-[11px] text-text-tertiary">
              · {t("desktop.craft.canvas.cvA.mark.draft")}
            </span>
          ) : null}
        </span>
      </nav>
    </div>
  );
}
