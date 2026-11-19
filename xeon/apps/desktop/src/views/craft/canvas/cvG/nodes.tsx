// cvG 캔버스의 React Flow 노드. 층으로 뜻을 말한다:
//   바닥 층(무대 띠, 레일, 레일로 내려가는 곡선, 프로필 밖의 빌더 윤곽) — 그림자 없음, 평평하다.
//   받침 층(묶음 받침판) — 낮은 그림자. 뜬 층(플러그인 판, 접힌 묶음 더미) — 높은 그림자. 그 위에 같은 층의 관계 직선.
// 판은 확대 단계마다 보여 주는 양을 바꾼다(가까이 = 구성 요소까지, 보통 = 하는 일 한 줄, 멀리 = 이름과 자리만 크게).
import { t } from "@fresnel/client/i18n";
import { useViewportStore, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import {
  createContext,
  use,
  type Context,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { agoText } from "../shared-sample.ts";
import { Icon, KIND_COLOR, KindGlyph, KindTile, PartGlyph, silhouette } from "./glyphs.tsx";
import {
  BAND_HALF,
  PILE_OFFSET,
  RAIL_HALF,
  RELATION_DASH,
  type BundleGeo,
  type PlateGeo,
  type ProfileLayout,
} from "./layout.ts";
import type { Kind, Plugin, RelationKind } from "./model.ts";
import { bundleMetaOf } from "./sample-ext.ts";
import {
  anchorWord,
  BLOCK_WORD,
  BOUNDARY_WORD,
  DECISION_WORD,
  KIND_WORD,
  RELATION_WORD,
  STEP_WORD,
} from "./words.ts";

// ── 확대 단계 ─────────────────────────────────────────────────────

type Lod = "far" | "mid" | "near";

function lodOf(zoom: number): Lod {
  if (zoom < 0.62) return "far";
  if (zoom < 1.05) return "mid";
  return "near";
}

/** 확대 값이 단계 경계를 넘을 때만 다시 그린다 */
function useLod(): Lod {
  return useViewportStore((s) => lodOf(s.transform[2]));
}

// ── 캔버스가 노드에 주는 일 ───────────────────────────────────────

export interface CanvasActions {
  select(id: string): void;
  open(name: string): void;
  toggleBundle(id: string): void;
  pointerDown(name: string, e: PointerEvent<HTMLElement>): void;
  key(id: string, e: KeyboardEvent<HTMLElement>): void;
}

const NOOP: CanvasActions = {
  select: () => undefined,
  open: () => undefined,
  toggleBundle: () => undefined,
  pointerDown: () => undefined,
  key: () => undefined,
};

export const CanvasActionsContext: Context<CanvasActions> = createContext<CanvasActions>(NOOP);

// ── 노드 데이터 ───────────────────────────────────────────────────

export type Mark = "none" | "selected" | "related";

interface BandData extends Record<string, unknown> {
  readonly width: number;
}

interface FloorData extends Record<string, unknown> {
  readonly layout: ProfileLayout;
  readonly lit: ReadonlySet<string>;
  /** 끄는 동안 내려앉을 자리(레일 위 점) */
  readonly target: { readonly x: number; readonly y: number; readonly kind: Kind } | null;
  readonly showCross: boolean;
}

interface LinksData extends Record<string, unknown> {
  readonly layout: ProfileLayout;
  readonly visible: ReadonlySet<number>;
  readonly lit: ReadonlySet<number>;
}

interface PlateData extends Record<string, unknown> {
  readonly geo: PlateGeo;
  readonly mark: Mark;
  readonly arrive: number;
  readonly dim: boolean;
}

interface PedestalData extends Record<string, unknown> {
  readonly geo: BundleGeo;
  readonly mark: Mark;
  readonly arrive: number;
}

interface BuilderData extends Record<string, unknown> {
  readonly mark: Mark;
}

export type CanvasNode =
  | Node<BandData, "band">
  | Node<FloorData, "floor">
  | Node<LinksData, "links">
  | Node<PlateData, "plate">
  | Node<PedestalData, "pedestal">
  | Node<PedestalData, "pile">
  | Node<BuilderData, "builder">;

// ── 바닥: 무대 띠 ─────────────────────────────────────────────────

/** 레일이 놓인 띠만 한 단계 밝다(위아래는 캔버스 바탕 그대로 한 단계 어둡다). 격자·셰이더 없음 */
function BandNode(props: NodeProps<Node<BandData, "band">>): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="cvg-band"
      style={{ width: props.data.width, height: BAND_HALF * 2 }}
    />
  );
}

// ── 바닥: 레일·선 ─────────────────────────────────────────────────

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

function FloorNode(props: NodeProps<Node<FloorData, "floor">>): ReactNode {
  const { layout, lit, target, showCross } = props.data;
  const b = layout.bounds;
  const pad = 80;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  const tools = layout.stations.find((s) => s.id === "tools");
  const model = layout.stations.find((s) => s.id === "model");
  const input = layout.boundaries.find((x) => x.id === "input-received");
  const end = layout.boundaries.find((x) => x.id === "before-turn-end");
  return (
    <svg
      aria-hidden="true"
      className="cvg-floor"
      width={w}
      height={h}
      viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}
    >
      {/* 레일 */}
      <line x1={layout.railX0} x2={layout.railX1} y1={0} y2={0} className="cvg-rail-line" />
      {/* 되돌이: 도구를 부르면 다시 모델로, 턴이 끝나면 다음 입력으로 */}
      {tools !== undefined && model !== undefined ? (
        <g className="cvg-return">
          <path
            d={`M${tools.x1 - 30} ${RAIL_HALF + 2} C${tools.x1 - 30} ${RAIL_HALF + 34} ${model.x0 + 30} ${RAIL_HALF + 34} ${model.x0 + 30} ${RAIL_HALF + 4}`}
            markerEnd="url(#cvg-arrow-floor)"
          />
          <text x={(tools.x1 + model.x0) / 2} y={RAIL_HALF + 44} textAnchor="middle">
            {t("desktop.craft.canvas.cvG.loop.step")}
          </text>
        </g>
      ) : null}
      {input !== undefined && end !== undefined ? (
        <g className="cvg-return">
          <path
            d={`M${end.x} ${RAIL_HALF - 10} V${BAND_HALF - 34} H${input.x} V${RAIL_HALF - 6}`}
            markerEnd="url(#cvg-arrow-floor)"
          />
          <text x={(input.x + end.x) / 2} y={BAND_HALF - 42} textAnchor="middle">
            {t("desktop.craft.canvas.cvG.loop.turn")}
          </text>
        </g>
      ) : null}
      {/* 블록: 바닥에 그린 칸(그림자 없음) */}
      {layout.stations.map((s, i) => (
        <g key={s.id}>
          <rect
            x={s.x0}
            y={-RAIL_HALF}
            width={s.x1 - s.x0}
            height={RAIL_HALF * 2}
            rx={9}
            className="cvg-station"
          />
          <text x={s.x0 + 14} y={5} className="cvg-station-num">
            {String(i + 1).padStart(2, "0")}
          </text>
          <text x={s.x0 + 36} y={5} className="cvg-station-label">
            {t(BLOCK_WORD[s.id])}
          </text>
        </g>
      ))}
      {/* 경계: 레일을 가로지르는 문 */}
      {layout.boundaries.map((x) => (
        <g key={x.id}>
          <line x1={x.x} x2={x.x} y1={-RAIL_HALF + 4} y2={RAIL_HALF - 4} className="cvg-gate" />
          <circle cx={x.x} cy={0} r={5} className="cvg-gate-dot" />
          <text x={x.x} y={-RAIL_HALF - 10} textAnchor="middle" className="cvg-gate-label">
            {t(BOUNDARY_WORD[x.id])}
          </text>
        </g>
      ))}
      {/* 붙는 자리 눈금 */}
      {layout.ticks.map((k) => (
        <circle
          key={k.anchor}
          cx={k.x}
          cy={k.side === "top" ? -RAIL_HALF : RAIL_HALF}
          r={k.used ? 3 : 2}
          className={k.used ? "cvg-tick cvg-tick-used" : "cvg-tick"}
        />
      ))}
      {/* 판에서 레일로 내려가는 곡선(층을 넘는 선) */}
      {layout.wires.map((w2) => {
        const on = w2.owners.some((o) => lit.has(o));
        return (
          <g key={w2.id} style={{ color: KIND_COLOR[w2.kind] }}>
            <path
              d={wirePath(w2.x1, w2.y1, w2.x2, w2.y2)}
              className={on ? "cvg-wire cvg-wire-on" : "cvg-wire"}
            />
            <circle cx={w2.x2} cy={w2.y2} r={4} className="cvg-wire-end" />
            {w2.count > 1 ? (
              <g>
                <rect
                  x={(w2.x1 + w2.x2) / 2 - 13}
                  y={(w2.y1 + w2.y2) / 2 - 10}
                  width={26}
                  height={20}
                  rx={10}
                  className="cvg-count"
                />
                <text
                  x={(w2.x1 + w2.x2) / 2}
                  y={(w2.y1 + w2.y2) / 2 + 4.5}
                  textAnchor="middle"
                  className="cvg-count-text"
                >
                  {String(w2.count)}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
      {/* 대체: 플러그인 판에서 내장 도구(도구 실행 블록)로 내려가는 곡선 */}
      {layout.relations
        .filter((r) => r.cross)
        .map((r) => (
          <g
            key={`${r.relation.from}:${r.relation.to}`}
            className="cvg-cross"
            opacity={showCross ? 1 : 0.55}
          >
            <path d={r.d} strokeDasharray={RELATION_DASH.replaces} />
            <text x={r.lx} y={r.ly} textAnchor="middle">
              {t("desktop.craft.canvas.cvG.rel.replacesTool", { tool: r.relation.label })}
            </text>
          </g>
        ))}
      {target !== null ? (
        <g style={{ color: KIND_COLOR[target.kind] }}>
          <circle cx={target.x} cy={target.y} r={14} className="cvg-target" />
          <circle cx={target.x} cy={target.y} r={5} className="cvg-wire-end" />
        </g>
      ) : null}
      <defs>
        <marker
          id="cvg-arrow-floor"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M1 1 6 4 1 7" className="cvg-arrow-floor" />
        </marker>
      </defs>
    </svg>
  );
}

// ── 같은 층의 관계 직선 ───────────────────────────────────────────

function relationClass(kind: RelationKind): string {
  return `cvg-rel cvg-rel-${kind}`;
}

function LinksNode(props: NodeProps<Node<LinksData, "links">>): ReactNode {
  const { layout, visible, lit } = props.data;
  const b = layout.bounds;
  const pad = 80;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  return (
    <svg
      aria-hidden="true"
      className="cvg-links"
      width={w}
      height={h}
      viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}
    >
      <defs>
        {(["handoff", "depends", "reads", "creates"] as const).map((k) => (
          <marker
            key={k}
            id={`cvg-arrow-${k}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            {k === "depends" ? (
              <circle cx="5" cy="5" r="3" className={`cvg-rel-mark cvg-rel-mark-${k}`} />
            ) : k === "reads" ? (
              <rect
                x="2.5"
                y="2.5"
                width="5"
                height="5"
                className={`cvg-rel-mark cvg-rel-mark-${k}`}
              />
            ) : (
              <path d="M1.5 1.5 8 5 1.5 8.5" className={`cvg-rel-mark cvg-rel-mark-${k}`} />
            )}
          </marker>
        ))}
      </defs>
      {layout.relations.map((r, i) => {
        if (r.cross || !visible.has(i)) return null;
        const kind = r.relation.kind;
        const on = lit.has(i);
        return (
          <g key={`${r.relation.kind}:${r.relation.from}:${r.relation.to}:${String(i)}`}>
            <path
              d={r.d}
              className={`${relationClass(kind)}${on ? " cvg-rel-on" : ""}`}
              strokeDasharray={RELATION_DASH[kind] === "" ? undefined : RELATION_DASH[kind]}
              markerEnd={`url(#cvg-arrow-${kind})`}
            />
            <RelationLabel x={r.lx} y={r.ly} kind={kind} text={r.relation.label} />
          </g>
        );
      })}
    </svg>
  );
}

function RelationLabel(props: {
  readonly x: number;
  readonly y: number;
  readonly kind: RelationKind;
  readonly text: string;
}): ReactElement {
  const word = t(RELATION_WORD[props.kind]);
  const label = props.text === "" ? word : `${word} · ${props.text}`;
  const w = label.length * 6.6 + 16;
  return (
    <g>
      <rect
        x={props.x - w / 2}
        y={props.y - 11}
        width={w}
        height={20}
        rx={6}
        className="cvg-rel-pill"
      />
      <text
        x={props.x}
        y={props.y + 3.5}
        textAnchor="middle"
        className={`cvg-rel-text cvg-rel-text-${props.kind}`}
      >
        {label}
      </text>
    </g>
  );
}

// ── 뜬 층: 플러그인 판 ────────────────────────────────────────────

/** 판 아래 한 줄: 종류마다 핵심 구성 요소 */
function summaryOf(p: Plugin): string {
  const s = p.shared;
  if (p.kind === "drive") {
    const steps = (s.steps ?? [])
      .map((st) =>
        st.parallel > 1 ? `${t(STEP_WORD[st.id])} ×${String(st.parallel)}` : t(STEP_WORD[st.id]),
      )
      .join(" → ");
    return steps === "" ? t("desktop.craft.canvas.cvG.summary.noSteps") : steps;
  }
  if (p.kind === "tool") {
    const tools = s.mcp?.tools ?? [];
    return t("desktop.craft.canvas.cvG.summary.tool", {
      server: s.mcp?.server ?? p.name,
      n: tools.length,
      w: tools.filter((x) => x.writes).length,
    });
  }
  if (p.kind === "hook") {
    const decision = s.decision === undefined ? "" : t(DECISION_WORD[s.decision]);
    const first = s.settings[0];
    return first === undefined ? decision : `${decision} · ${first.key} ${first.value}`;
  }
  const parts: string[] = [];
  if (s.instructions.length > 0)
    parts.push(t("desktop.craft.canvas.cvG.summary.instructions", { n: s.instructions.length }));
  if (s.skills.length > 0)
    parts.push(t("desktop.craft.canvas.cvG.summary.skills", { n: s.skills.length }));
  if (s.memory.length > 0)
    parts.push(t("desktop.craft.canvas.cvG.summary.memory", { n: s.memory.length }));
  return parts.join(" · ");
}

/** 가까이에서 보이는 구성 요소 이름 몇 개 */
function partNames(p: Plugin): readonly string[] {
  const s = p.shared;
  if (p.kind === "drive") return [...s.instructions, ...(s.handoffTo ?? []).map((x) => `→ ${x}`)];
  if (p.kind === "tool") return (s.mcp?.tools ?? []).map((x) => x.name);
  if (p.kind === "hook") return s.settings.map((x) => `${x.key}=${x.value}`);
  return [...s.instructions, ...s.skills, ...s.memory];
}

function Marks(props: { readonly geo: PlateGeo; readonly big: boolean }): ReactNode {
  const { placed } = props.geo;
  const meta = placed.plugin.meta;
  const cls = props.big ? "cvg-mark cvg-mark-big" : "cvg-mark";
  return (
    <span className="flex shrink-0 items-center gap-1">
      {placed.start ? (
        <span className={`${cls} cvg-mark-start`}>{t("desktop.craft.canvas.cvG.startShort")}</span>
      ) : null}
      {placed.source.type === "base" ? (
        <span className={cls} title={t("desktop.craft.canvas.cvG.base")}>
          <PartGlyph name="lock" size={props.big ? 15 : 11} />
          {props.big ? null : t("desktop.craft.canvas.cvG.base")}
        </span>
      ) : null}
      {meta.review.state === "draft" ? (
        <span className={`${cls} cvg-mark-draft`}>
          {t("desktop.craft.canvas.cvG.review.draft")}
        </span>
      ) : meta.pending !== null ? (
        <span className={`${cls} cvg-mark-pending`}>
          {t("desktop.craft.canvas.cvG.review.pendingShort")}
        </span>
      ) : null}
    </span>
  );
}

function PlateNode(props: NodeProps<Node<PlateData, "plate">>): ReactNode {
  const { geo, mark, arrive, dim } = props.data;
  const actions = use(CanvasActionsContext);
  const lod = useLod();
  const p = geo.placed.plugin;
  const facing = geo.lane === "hook" ? "up" : "down";
  const draft = p.meta.review.state === "draft";
  const where = t(anchorWord(p.anchor));
  const order =
    geo.placed.siblings > 1 && geo.inBundle === null
      ? t("desktop.craft.canvas.cvG.order", { n: geo.placed.order, of: geo.placed.siblings })
      : null;
  return (
    <div
      data-plugin={p.name}
      data-kind={p.kind}
      data-mark={mark}
      className={`cvg-plate${dim ? " cvg-dim" : ""}`}
      style={{ width: geo.w, height: geo.h, color: KIND_COLOR[p.kind] }}
      onPointerDown={(e) => {
        actions.pointerDown(p.name, e);
      }}
      onDoubleClick={() => {
        actions.open(p.name);
      }}
    >
      <svg className="cvg-plate-shape" width={geo.w} height={geo.h} aria-hidden="true">
        <path
          d={silhouette(p.kind, geo.w, geo.h, facing)}
          className={draft ? "cvg-shape cvg-shape-draft" : "cvg-shape"}
        />
      </svg>
      {arrive > 0 ? <span key={arrive} className="cvg-arrive" aria-hidden="true" /> : null}
      {lod === "far" ? (
        <div className="cvg-plate-body justify-center gap-2 px-5">
          <div className="flex items-center gap-3">
            <KindTile kind={p.kind} size={46} draft={draft} />
            <span className="min-w-0 flex-1 truncate text-[25px] font-semibold text-text-primary">
              {p.name}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[17px] text-text-secondary">{where}</span>
            <Marks geo={geo} big />
          </div>
        </div>
      ) : (
        <div className="cvg-plate-body gap-1.5 px-4 pt-3.5 pb-3">
          <div className="flex items-center gap-2.5">
            <KindTile kind={p.kind} size={lod === "near" ? 30 : 34} draft={draft} />
            <div className="min-w-0 flex-1">
              <div
                className={`truncate font-semibold text-text-primary ${lod === "near" ? "text-[15px]" : "text-[17px]"}`}
              >
                {p.name}
              </div>
            </div>
            <Marks geo={geo} big={false} />
          </div>
          <div
            className={`flex min-w-0 items-center gap-1.5 ${lod === "near" ? "text-[12px]" : "text-[13.5px]"}`}
          >
            <span className="shrink-0 font-medium" style={{ color: KIND_COLOR[p.kind] }}>
              {t(KIND_WORD[p.kind])}
            </span>
            <span className="text-text-tertiary">·</span>
            <span className="truncate text-text-secondary">{where}</span>
            {order !== null ? (
              <span className="ms-auto shrink-0 text-text-tertiary tabular-nums">{order}</span>
            ) : null}
          </div>
          <p
            className={`text-text-secondary ${lod === "near" ? "line-clamp-1 text-[12.5px]" : "line-clamp-2 text-[14px] leading-[19px]"}`}
          >
            {t(p.meta.purpose)}
          </p>
          {lod === "near" ? (
            <>
              <div
                className="mt-auto flex min-w-0 flex-wrap gap-1 overflow-hidden"
                style={{ maxHeight: 22 }}
              >
                {partNames(p)
                  .slice(0, 4)
                  .map((x) => (
                    <span key={x} className="cvg-chip">
                      {x}
                    </span>
                  ))}
              </div>
              <div className="flex items-center justify-between text-[11.5px] text-text-tertiary">
                <span className="cvg-mono truncate">{summaryOf(p)}</span>
                <span className="shrink-0 ps-2">{agoText(p.shared.lastUsedMin)}</span>
              </div>
            </>
          ) : (
            <div className="mt-auto flex items-center justify-between gap-2 text-[12.5px] text-text-tertiary">
              <span className="cvg-mono truncate">{summaryOf(p)}</span>
              <span className="shrink-0">{agoText(p.shared.lastUsedMin)}</span>
            </div>
          )}
        </div>
      )}
      <span className="sr-only">
        {t("desktop.craft.canvas.cvG.a11y.plate", {
          name: p.name,
          kind: t(KIND_WORD[p.kind]),
          where,
        })}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="cvg-plate-hit"
        onClick={() => {
          actions.select(p.name);
        }}
        onKeyDown={(e) => {
          actions.key(p.name, e);
        }}
      />
    </div>
  );
}

// ── 받침 층: 묶음 ─────────────────────────────────────────────────

function BundleHead(props: { readonly geo: BundleGeo; readonly big: boolean }): ReactNode {
  const actions = use(CanvasActionsContext);
  const meta = bundleMetaOf(props.geo.id);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-text-secondary">
        <PartGlyph name="package" size={props.big ? 22 : 16} />
      </span>
      <span
        className={`truncate font-semibold text-text-primary ${props.big ? "text-[22px]" : "text-[14px]"}`}
      >
        {meta.displayName}
      </span>
      <span className={`shrink-0 text-text-tertiary ${props.big ? "text-[16px]" : "text-[12px]"}`}>
        {t("desktop.craft.canvas.cvG.bundle.count", { n: props.geo.members.length })}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-1">
        {props.geo.kinds.map((k) => (
          <span key={k} style={{ color: KIND_COLOR[k] }} className="flex">
            <KindGlyph kind={k} size={props.big ? 16 : 12} />
          </span>
        ))}
        <button
          type="button"
          className="cvg-icon-btn ms-1"
          aria-label={t(
            props.geo.collapsed
              ? "desktop.craft.canvas.cvG.bundle.unfold"
              : "desktop.craft.canvas.cvG.bundle.fold",
          )}
          title={t(
            props.geo.collapsed
              ? "desktop.craft.canvas.cvG.bundle.unfold"
              : "desktop.craft.canvas.cvG.bundle.fold",
          )}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleBundle(props.geo.id);
          }}
        >
          <Icon name={props.geo.collapsed ? "unfold" : "fold"} size={props.big ? 18 : 14} />
        </button>
      </span>
    </div>
  );
}

function PedestalNode(props: NodeProps<Node<PedestalData, "pedestal">>): ReactNode {
  const { geo, mark, arrive } = props.data;
  const actions = use(CanvasActionsContext);
  const lod = useLod();
  return (
    <div
      data-bundle={geo.id}
      data-mark={mark}
      className="cvg-pedestal"
      style={{ width: geo.w, height: geo.h }}
      onClick={() => {
        actions.select(`bundle:${geo.id}`);
      }}
    >
      {arrive > 0 ? <span key={arrive} className="cvg-arrive" aria-hidden="true" /> : null}
      <div className="px-3.5 pt-2.5">
        <BundleHead geo={geo} big={lod === "far"} />
      </div>
    </div>
  );
}

/** 접힌 묶음: 판 더미(뒤 판 두 장이 비켜 선다). 구성원 이름과 종류가 한 판에 */
function PileNode(props: NodeProps<Node<PedestalData, "pile">>): ReactNode {
  const { geo, mark, arrive } = props.data;
  const actions = use(CanvasActionsContext);
  const lod = useLod();
  const meta = bundleMetaOf(geo.id);
  const w = geo.w - PILE_OFFSET * 2;
  const h = geo.h - PILE_OFFSET * 2;
  return (
    <div
      data-bundle={geo.id}
      data-mark={mark}
      className="cvg-pile"
      style={{ width: geo.w, height: geo.h }}
      onDoubleClick={() => {
        actions.toggleBundle(geo.id);
      }}
    >
      <span
        className="cvg-pile-sheet"
        style={{ left: PILE_OFFSET * 2, top: 0, width: w, height: h }}
      />
      <span
        className="cvg-pile-sheet"
        style={{ left: PILE_OFFSET, top: PILE_OFFSET, width: w, height: h }}
      />
      <div className="cvg-pile-top" style={{ left: 0, top: PILE_OFFSET * 2, width: w, height: h }}>
        {arrive > 0 ? <span key={arrive} className="cvg-arrive" aria-hidden="true" /> : null}
        <div className="flex h-full flex-col gap-2 px-4 py-3.5">
          <BundleHead geo={geo} big={lod === "far"} />
          {lod === "far" ? null : (
            <>
              <p className="line-clamp-2 text-[13.5px] leading-[18px] text-text-secondary">
                {t(meta.purpose)}
              </p>
              <ol className="mt-auto flex flex-col gap-0.5">
                {geo.members.map((m, i) => (
                  <li
                    key={m}
                    className="flex items-center gap-1.5 text-[12.5px] text-text-secondary"
                  >
                    <span className="w-3 text-text-tertiary tabular-nums">{String(i + 1)}</span>
                    <span className="truncate">{m}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="cvg-plate-hit"
          onClick={() => {
            actions.select(`bundle:${geo.id}`);
          }}
        />
      </div>
    </div>
  );
}

// ── 바닥: 프로필 밖의 빌더 ────────────────────────────────────────

function BuilderNode(props: NodeProps<Node<BuilderData, "builder">>): ReactNode {
  const actions = use(CanvasActionsContext);
  return (
    <div
      data-builder=""
      data-mark={props.data.mark}
      className="cvg-builder"
      onClick={() => {
        actions.select("@builder");
      }}
    >
      <PartGlyph name="builder" size={16} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-text-primary">
          {t("desktop.craft.canvas.cvG.builder.name")}
        </div>
        <div className="truncate text-[11.5px] text-text-tertiary">
          {t("desktop.craft.canvas.cvG.builder.where")}
        </div>
      </div>
    </div>
  );
}

export const NODE_TYPES: NodeTypes = {
  band: BandNode,
  floor: FloorNode,
  links: LinksNode,
  plate: PlateNode,
  pedestal: PedestalNode,
  pile: PileNode,
  builder: BuilderNode,
};
