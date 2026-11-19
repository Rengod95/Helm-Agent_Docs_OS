// cv4 캔버스의 React Flow 노드. 층으로 뜻을 말한다:
//   바닥 층(레일 밑 빛 웅덩이, 레일, 소켓·줄기·버스, 프로필 밖의 빌더 윤곽) — 그림자 없음, 평평하다.
//   받침 층(묶음 받침판) — 낮은 그림자. 뜬 층(플러그인 판, 접힌 묶음 더미) — 높은 그림자. 그 위에 같은 층의 관계 직선.
// 판은 네 종류가 같은 카드 한 가족이다. 종류는 타일과 "테"(레일 쪽 변에 스민 종류 색과 그 변의 가는 선)로 가르고,
// 선은 그 변 가운데의 패드로 들어온다(같은 자리에 여럿이면 패드에 호출 순서 번호). Drive의 핸드오프는 오른쪽 변 패드에서 나가
// 다음 Drive의 왼쪽 변 패드로 들어간다. 확대 단계마다 보이는 칸은 `lod.ts`의 표를 따른다.
import { t, type MessageId } from "@fresnel/client/i18n";
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
import { Icon, KIND_COLOR, KindGlyph, KindTile, PartGlyph } from "./glyphs.tsx";
import { lodOf, plateMarks, type Lod, type PlateMark } from "./lod.ts";
import {
  PILE_OFFSET,
  POOL_HALF,
  RAIL_HALF,
  RELATION_DASH,
  type BundleGeo,
  type PlateGeo,
  type ProfileLayout,
} from "./layout.ts";
import { pluginOf, type Kind, type RelationKind } from "./model.ts";
import { bundleMetaOf } from "../shared-meta.ts";
import { anchorWord, BLOCK_WORD, BOUNDARY_WORD, KIND_WORD, RELATION_WORD } from "./words.ts";

// ── 확대 단계 ─────────────────────────────────────────────────────

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

interface PoolData extends Record<string, unknown> {
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
  | Node<PoolData, "pool">
  | Node<FloorData, "floor">
  | Node<LinksData, "links">
  | Node<PlateData, "plate">
  | Node<PedestalData, "pedestal">
  | Node<PedestalData, "pile">
  | Node<BuilderData, "builder">;

// ── 바닥: 빛 웅덩이 ───────────────────────────────────────────────

/**
 * 레일 밑에 깔린 밝은 웅덩이. 가장자리도 선도 없이 위·아래와 양 끝으로 흐려져, 루프를 가두지 않고 화면의 중심으로 읽힌다.
 * 캔버스와 함께 움직이는 정지된 면 하나라 쉬는 동안 하는 일이 없다(격자·셰이더·애니메이션 없음)
 */
function PoolNode(props: NodeProps<Node<PoolData, "pool">>): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="cv4-pool"
      style={{ width: props.data.width, height: POOL_HALF * 2 }}
    />
  );
}

// ── 바닥: 레일·소켓·줄기 ──────────────────────────────────────────

function FloorNode(props: NodeProps<Node<FloorData, "floor">>): ReactNode {
  const { layout, lit, target, showCross } = props.data;
  const b = layout.bounds;
  const pad = 80;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  const tools = layout.stations.find((s) => s.id === "tools");
  const model = layout.stations.find((s) => s.id === "model");
  const end = layout.boundaries.find((x) => x.id === "before-turn-end");
  return (
    <svg
      aria-hidden="true"
      className="cv4-floor"
      width={w}
      height={h}
      viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}
    >
      {/* 레일 */}
      <line x1={layout.railX0} x2={layout.railX1} y1={0} y2={0} className="cv4-rail-line" />
      {/* 되돌이 둘. 도구를 부르면 다시 모델로: 두 블록 사이의 빈 틈에서만 레일 아래로 짧게 돈다(소켓의 줄기와 겹치지 않는다).
          턴이 끝나면 다음 입력으로: 레일 끝에서 말아 내려가는 짧은 화살표와 말(판 줄을 가로지르는 긴 선을 긋지 않는다) */}
      {tools !== undefined && model !== undefined ? (
        <g className="cv4-return">
          <path
            d={`M${tools.x0 + 6} ${RAIL_HALF - 6} C${tools.x0 + 6} ${RAIL_HALF + 18} ${model.x1 - 6} ${RAIL_HALF + 18} ${model.x1 - 6} ${RAIL_HALF - 2}`}
            markerEnd="url(#cv4-arrow-floor)"
          />
          <text x={(tools.x0 + model.x1) / 2} y={-RAIL_HALF - 12} textAnchor="middle">
            {t("desktop.craft.canvas.cv4.loop.again")}
          </text>
        </g>
      ) : null}
      {end !== undefined ? (
        <g className="cv4-return">
          <path
            d={`M${end.x + 8} 0 H${layout.railX1 + 4} C${layout.railX1 + 22} 0 ${layout.railX1 + 22} ${RAIL_HALF + 6} ${layout.railX1 + 4} ${RAIL_HALF + 6} H${end.x + 24}`}
            markerEnd="url(#cv4-arrow-floor)"
          />
          <text x={end.x + 26} y={RAIL_HALF + 26}>
            {t("desktop.craft.canvas.cv3.loop.turn")}
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
            rx={11}
            className="cv4-station"
          />
          <text x={s.x0 + 14} y={6} className="cv4-station-num">
            {String(i + 1).padStart(2, "0")}
          </text>
          <text x={s.x0 + 40} y={6} className="cv4-station-label">
            {t(BLOCK_WORD[s.id])}
          </text>
        </g>
      ))}
      {/* 경계: 레일을 가로지르는 문 */}
      {layout.boundaries.map((x) => (
        <g key={x.id}>
          <line x1={x.x} x2={x.x} y1={-RAIL_HALF + 4} y2={RAIL_HALF - 4} className="cv4-gate" />
          <circle cx={x.x} cy={0} r={5} className="cv4-gate-dot" />
          <text x={x.x} y={-RAIL_HALF - 12} textAnchor="middle" className="cv4-gate-label">
            {t(BOUNDARY_WORD[x.id])}
          </text>
        </g>
      ))}
      {/* 쓰이지 않는 자리: 붙을 수 있는 곳의 작은 눈금 */}
      {layout.ticks.map((k) => (
        <circle
          key={`${k.anchor}:${k.side}`}
          cx={k.x}
          cy={k.side === "top" ? -RAIL_HALF : RAIL_HALF}
          r={2}
          className="cv4-tick"
        />
      ))}
      {/* 판·묶음에서 소켓까지: 줄기, 버스, 더미를 꿰는 선(층을 넘는 선, 종류 색 실선) */}
      {layout.wires.map((w2) => {
        const on = w2.owners.some((o) => lit.has(o));
        return (
          <path
            key={w2.id}
            d={w2.d}
            style={{ color: KIND_COLOR[w2.kind] }}
            className={on ? "cv4-wire cv4-wire-on" : "cv4-wire"}
          />
        );
      })}
      {/* 소켓: 블록 변에 박힌 종류 색 패드. 한 자리에 둘 이상이면 줄기 가운데에 수 */}
      {layout.sockets.map((k) => {
        const y = k.side === "top" ? -RAIL_HALF : RAIL_HALF;
        return (
          <g key={`${k.anchor}:${k.side}`} style={{ color: KIND_COLOR[k.kind] }}>
            <rect x={k.x - 9} y={y - 3} width={18} height={6} rx={3} className="cv4-socket" />
            {k.count > 1 ? (
              <g>
                <rect
                  x={k.x - 15}
                  y={k.cy - 10}
                  width={30}
                  height={20}
                  rx={10}
                  className="cv4-count"
                />
                <text x={k.x} y={k.cy + 4.5} textAnchor="middle" className="cv4-count-text">
                  {String(k.count)}
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
            className="cv4-cross"
            opacity={showCross ? 1 : 0.55}
          >
            <path d={r.d} strokeDasharray={RELATION_DASH.replaces} />
            <text x={r.lx} y={r.ly} textAnchor="middle">
              {t("desktop.craft.canvas.cv3.rel.replacesTool", { tool: r.relation.label })}
            </text>
          </g>
        ))}
      {target !== null ? (
        <g style={{ color: KIND_COLOR[target.kind] }}>
          <circle cx={target.x} cy={target.y} r={14} className="cv4-target" />
          <rect
            x={target.x - 9}
            y={target.y - 3}
            width={18}
            height={6}
            rx={3}
            className="cv4-socket"
          />
        </g>
      ) : null}
      <defs>
        <marker
          id="cv4-arrow-floor"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M1 1 6 4 1 7" className="cv4-arrow-floor" />
        </marker>
      </defs>
    </svg>
  );
}

// ── 같은 층의 관계 직선 ───────────────────────────────────────────

function relationClass(kind: RelationKind): string {
  return `cv4-rel cv4-rel-${kind}`;
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
      className="cv4-links"
      width={w}
      height={h}
      viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}
    >
      <defs>
        {(["handoff", "depends", "reads", "creates"] as const).map((k) => (
          <marker
            key={k}
            id={`cv4-arrow-${k}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            {k === "depends" ? (
              <circle cx="5" cy="5" r="3" className={`cv4-rel-mark cv4-rel-mark-${k}`} />
            ) : k === "reads" ? (
              <rect
                x="2.5"
                y="2.5"
                width="5"
                height="5"
                className={`cv4-rel-mark cv4-rel-mark-${k}`}
              />
            ) : (
              <path d="M1.5 1.5 8 5 1.5 8.5" className={`cv4-rel-mark cv4-rel-mark-${k}`} />
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
              className={`${relationClass(kind)}${on ? " cv4-rel-on" : ""}`}
              strokeDasharray={RELATION_DASH[kind] === "" ? undefined : RELATION_DASH[kind]}
              markerEnd={`url(#cv4-arrow-${kind})`}
            />
            {r.quiet ? null : (
              <RelationLabel x={r.lx} y={r.ly} kind={kind} text={r.relation.label} />
            )}
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
  // 글자 폭 어림: 한글은 글자 크기만큼, 라틴·숫자는 그 반쯤
  let w = 20;
  for (let i = 0; i < label.length; i++) w += label.charCodeAt(i) > 0x1100 ? 15 : 8.2;
  return (
    <g>
      <rect
        x={props.x - w / 2}
        y={props.y - 14}
        width={w}
        height={27}
        rx={8}
        className="cv4-rel-pill"
      />
      <text
        x={props.x}
        y={props.y + 5}
        textAnchor="middle"
        className={`cv4-rel-text cv4-rel-text-${props.kind}`}
      >
        {label}
      </text>
    </g>
  );
}

// ── 뜬 층: 플러그인 판 ────────────────────────────────────────────

const MARK_WORD: Readonly<Record<PlateMark, MessageId>> = {
  error: "desktop.craft.canvas.cv3.mark.error",
  draft: "desktop.craft.canvas.cv3.review.draft",
  pending: "desktop.craft.canvas.cv3.review.pendingShort",
  start: "desktop.craft.canvas.cv3.startShort",
  base: "desktop.craft.canvas.cv3.base",
};

const MARK_CLASS: Readonly<Record<PlateMark, string>> = {
  error: "cv4-mark-error",
  draft: "cv4-mark-draft",
  pending: "cv4-mark-pending",
  start: "cv4-mark-start",
  base: "",
};

/** 상태 표시: 단계가 멀수록 크게. 베이스는 자물쇠 그림만(이름은 툴팁) */
function Marks(props: { readonly geo: PlateGeo; readonly lod: Lod }): ReactNode {
  const marks = plateMarks(props.geo.placed);
  if (marks.length === 0) return null;
  const size = props.lod === "far" ? "cv4-mark-big" : props.lod === "mid" ? "cv4-mark-mid" : "";
  // 멀리서는 가장 앞선 하나만(경고가 먼저 선다)
  const shown = props.lod === "far" ? marks.slice(0, 1) : marks;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((m) =>
        m === "base" ? (
          <span key={m} className={`cv4-mark ${size}`} title={t(MARK_WORD[m])}>
            <PartGlyph
              name="lock"
              size={props.lod === "far" ? 17 : props.lod === "mid" ? 14 : 11}
            />
          </span>
        ) : (
          <span key={m} className={`cv4-mark ${size} ${MARK_CLASS[m]}`}>
            {t(MARK_WORD[m])}
          </span>
        ),
      )}
    </span>
  );
}

/** 레일 쪽 변의 패드: 선이 판으로 들어오는 자리. 같은 자리에 둘 이상이면 호출 순서 번호를 단다(단계가 멀수록 크게) */
function LipPad(props: { readonly geo: PlateGeo; readonly lod: Lod }): ReactNode {
  const { placed, lip } = props.geo;
  // Drive는 레일에 붙지 않는다(스타트 Drive만 입력 받기로 내려간다). 번호도 달지 않는다
  if (placed.plugin.kind === "drive" && !placed.start) return null;
  const numbered = placed.siblings > 1 && placed.plugin.kind !== "drive";
  return (
    <span
      className="cv4-pad"
      data-lip={lip}
      data-lod={props.lod}
      data-numbered={numbered ? "" : undefined}
      title={
        numbered
          ? t("desktop.craft.canvas.cv3.order", { n: placed.order, of: placed.siblings })
          : undefined
      }
    >
      {numbered ? String(placed.order) : null}
    </span>
  );
}

/** 판 몸: 단계마다 칸과 글자 크기가 다르다(높이는 같고, 위·왼쪽·오른쪽 10, 아래 8의 여백 안을 꼭 채운다) */
function PlateBody(props: { readonly geo: PlateGeo; readonly lod: Lod }): ReactNode {
  const p = props.geo.placed.plugin;
  const draft = p.meta.review.state === "draft";
  if (props.lod === "far")
    return (
      <div className="cv4-plate-body justify-center">
        <div className="flex items-center gap-3">
          <KindTile kind={p.kind} size={40} draft={draft} />
          <span className="cv4-name-wrap min-w-0 flex-1 text-[24px] leading-[28px] font-semibold tracking-[-0.01em] text-text-primary">
            {p.name}
          </span>
        </div>
      </div>
    );
  if (props.lod === "mid")
    return (
      <div className="cv4-plate-body gap-1.5">
        <div className="flex h-[30px] min-w-0 items-center gap-2.5">
          <KindTile kind={p.kind} size={30} draft={draft} />
          <span className="min-w-0 flex-1 truncate text-[19px] leading-6 font-semibold tracking-[-0.01em] text-text-primary">
            {p.name}
          </span>
        </div>
        <p className="m-0 line-clamp-2 text-[15px] leading-[18px] text-text-secondary">
          {t(p.meta.purpose)}
        </p>
      </div>
    );
  return (
    <div className="cv4-plate-body gap-1.5">
      <div className="flex h-8 min-w-0 items-center gap-2.5">
        <KindTile kind={p.kind} size={28} draft={draft} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-[18px] font-semibold text-text-primary">
            {p.name}
          </div>
          <div
            className="truncate text-[11px] leading-[14px] font-medium"
            style={{ color: KIND_COLOR[p.kind] }}
          >
            {t(KIND_WORD[p.kind])}
          </div>
        </div>
        <Marks geo={props.geo} lod={props.lod} />
      </div>
      <p className="m-0 line-clamp-2 text-[12.5px] leading-[17px] text-text-secondary">
        {t(p.meta.purpose)}
      </p>
    </div>
  );
}

function PlateNode(props: NodeProps<Node<PlateData, "plate">>): ReactNode {
  const { geo, mark, arrive, dim } = props.data;
  const actions = use(CanvasActionsContext);
  const lod = useLod();
  const p = geo.placed.plugin;
  const draft = p.meta.review.state === "draft";
  return (
    <div
      data-plugin={p.name}
      data-kind={p.kind}
      data-mark={mark}
      data-draft={draft}
      data-lod={lod}
      data-lip={geo.lip}
      className={`cv4-plate${dim ? " cv4-dim" : ""}`}
      style={{ width: geo.w, height: geo.h, color: KIND_COLOR[p.kind] }}
      onPointerDown={(e) => {
        actions.pointerDown(p.name, e);
      }}
      onDoubleClick={() => {
        actions.open(p.name);
      }}
    >
      {arrive > 0 ? <span key={arrive} className="cv4-arrive" aria-hidden="true" /> : null}
      {/* 중간·멀리: 상태는 카드 위 변에 걸친 표(이름 자리를 줄이지 않는다). 가까이는 이름 줄 끝에 */}
      {lod === "near" ? null : (
        <span className="cv4-edge-marks">
          <Marks geo={geo} lod={lod} />
        </span>
      )}
      <PlateBody geo={geo} lod={lod} />
      <LipPad geo={geo} lod={lod} />
      {geo.handoffOut ? <span className="cv4-hpad" data-side="out" aria-hidden="true" /> : null}
      {geo.handoffIn === null ? null : (
        <span
          className="cv4-hpad"
          data-side={geo.handoffIn === "left" ? "in" : "in-bottom"}
          aria-hidden="true"
        />
      )}
      <span className="sr-only">
        {t("desktop.craft.canvas.cv3.a11y.plate", {
          name: p.name,
          kind: t(KIND_WORD[p.kind]),
          where: t(anchorWord(p.anchor)),
        })}
      </span>
      <button
        type="button"
        data-slot="cv4-button"
        tabIndex={-1}
        aria-hidden="true"
        className="cv4-plate-hit"
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

const HEAD_SIZE: Readonly<
  Record<Lod, { icon: number; name: string; count: string; kind: number }>
> = {
  far: { icon: 26, name: "text-[26px]", count: "text-[19px]", kind: 16 },
  mid: { icon: 20, name: "text-[19px]", count: "text-[15px]", kind: 14 },
  near: { icon: 16, name: "text-[14.5px]", count: "text-[12px]", kind: 12 },
};

function BundleHead(props: {
  readonly geo: BundleGeo;
  readonly lod: Lod;
  /** 종류 표시(접힌 더미는 줄마다 타일이 있어 뺀다) */
  readonly kinds?: boolean;
}): ReactNode {
  const actions = use(CanvasActionsContext);
  const meta = bundleMetaOf(props.geo.id);
  const size = HEAD_SIZE[props.lod];
  const fold = props.geo.collapsed
    ? "desktop.craft.canvas.cv3.bundle.unfold"
    : "desktop.craft.canvas.cv3.bundle.fold";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-text-secondary">
        <PartGlyph name="package" size={size.icon} />
      </span>
      <span className={`truncate font-semibold text-text-primary ${size.name}`}>
        {meta.displayName}
      </span>
      <span className={`shrink-0 text-text-tertiary ${size.count}`}>
        {t("desktop.craft.canvas.cv3.bundle.count", { n: props.geo.members.length })}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-1">
        {(props.kinds === false ? [] : props.geo.kinds).map((k) => (
          <span key={k} style={{ color: KIND_COLOR[k] }} className="flex">
            <KindGlyph kind={k} size={size.kind} />
          </span>
        ))}
        <button
          type="button"
          data-slot="cv4-button"
          className="cv4-icon-btn ms-1"
          aria-label={t(fold)}
          title={t(fold)}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleBundle(props.geo.id);
          }}
        >
          <Icon name={props.geo.collapsed ? "unfold" : "fold"} size={size.kind + 2} />
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
      className="cv4-pedestal rounded-2xl"
      style={{ width: geo.w, height: geo.h }}
      onClick={() => {
        actions.select(`bundle:${geo.id}`);
      }}
    >
      {arrive > 0 ? <span key={arrive} className="cv4-arrive" aria-hidden="true" /> : null}
      <div className="px-3 pt-2">
        <BundleHead geo={geo} lod={lod} />
      </div>
    </div>
  );
}

const PILE_ROW: Readonly<Record<Lod, { tile: number; text: string; max: number }>> = {
  far: { tile: 28, text: "text-[21px]", max: 3 },
  mid: { tile: 22, text: "text-[16px]", max: 4 },
  near: { tile: 18, text: "text-[13px]", max: 4 },
};

/** 접힌 묶음: 판 더미(뒤 판 두 장이 비켜 선다). 구성원 이름과 종류가 한 판에(순서는 매니페스트 `group.members`) */
function PileNode(props: NodeProps<Node<PedestalData, "pile">>): ReactNode {
  const { geo, mark, arrive } = props.data;
  const actions = use(CanvasActionsContext);
  const lod = useLod();
  const w = geo.w - PILE_OFFSET * 2;
  const h = geo.h - PILE_OFFSET * 2;
  const row = PILE_ROW[lod];
  return (
    <div
      data-bundle={geo.id}
      data-mark={mark}
      className="cv4-pile"
      style={{ width: geo.w, height: geo.h }}
      onDoubleClick={() => {
        actions.toggleBundle(geo.id);
      }}
    >
      <span
        className="cv4-pile-sheet rounded-xl"
        style={{ left: PILE_OFFSET * 2, top: 0, width: w, height: h }}
      />
      <span
        className="cv4-pile-sheet rounded-xl"
        style={{ left: PILE_OFFSET, top: PILE_OFFSET, width: w, height: h }}
      />
      <div
        className="cv4-pile-top rounded-xl"
        style={{ left: 0, top: PILE_OFFSET * 2, width: w, height: h }}
      >
        {arrive > 0 ? <span key={arrive} className="cv4-arrive" aria-hidden="true" /> : null}
        <div className="flex h-full flex-col justify-center gap-2 px-3">
          <BundleHead geo={geo} lod={lod} kinds={false} />
          <ol className="flex flex-col gap-1">
            {geo.members.slice(0, row.max).map((m) => {
              const kind = pluginOf(m)?.kind;
              return (
                <li key={m} className="flex min-w-0 items-center gap-2">
                  {kind === undefined ? null : <KindTile kind={kind} size={row.tile} />}
                  <span className={`truncate text-text-secondary ${row.text}`}>{m}</span>
                </li>
              );
            })}
            {geo.members.length > row.max ? (
              <li className={`text-text-tertiary ${row.text}`}>
                {t("desktop.craft.canvas.cv3.bundle.more", { n: geo.members.length - row.max })}
              </li>
            ) : null}
          </ol>
        </div>
        <button
          type="button"
          data-slot="cv4-button"
          tabIndex={-1}
          aria-hidden="true"
          className="cv4-plate-hit"
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
      className="cv4-builder"
      onClick={() => {
        actions.select("@builder");
      }}
    >
      <PartGlyph name="builder" size={26} />
      <div className="min-w-0">
        <div className="truncate text-[19px] font-semibold text-text-primary">
          {t("desktop.craft.canvas.cv3.builder.name")}
        </div>
        <div className="line-clamp-2 text-[14px] leading-[18px] text-text-tertiary">
          {t("desktop.craft.canvas.cv3.builder.where")}
        </div>
      </div>
    </div>
  );
}

export const NODE_TYPES: NodeTypes = {
  pool: PoolNode,
  floor: FloorNode,
  links: LinksNode,
  plate: PlateNode,
  pedestal: PedestalNode,
  pile: PileNode,
  builder: BuilderNode,
};
