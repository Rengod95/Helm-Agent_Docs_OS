// cv6 캔버스의 React Flow 노드. 층으로 뜻을 말한다:
//   빛 층(고른 판 뒤의 종류 색 번짐) — 맨 아래, 바닥 선보다 밑. 마우스를 올린 판의 옅은 빛은 판 안의 CSS(:hover)다.
//   바닥 층(레일, 소켓·줄기·버스, 프로필 밖의 빌더 윤곽) — 그림자 없음, 평평하다.
//   받침 층(묶음 받침판) — 낮은 그림자. 뜬 층(플러그인 판, 접힌 묶음 더미) — 높은 그림자. 그 위에 같은 층의 관계 직선.
// 판은 참고 그림(`cv6-shots/ref-measure.md`)의 노드 카드 그대로다: 머리(구성 요소 그림 + 이름 + 세로 점 셋) → 설명 두 줄 →
// 한 단 밝은 안쪽 면(꼬리표 + 설명 글) → 알약 칩 하나 → 흐린 푸터. 종류는 왼쪽 위 모서리에서 솟은 책갈피(탭: 종류 그림 + 종류 이름)
// 하나로만 말한다. 선의 문법(참고 그림): 1.5px 무채색 실선, 반경 10의 꺾임, 나가는 쪽은 카드 변 위의 점(지름 8; 같은 자리에
// 여럿이면 점 대신 호출 순서 번호), 들어가는 쪽은 열린 꺾쇠. 확대 단계마다 보이는 칸은 `lod.ts`의 표를 따른다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { useViewportStore, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { GLOW_REACH } from "./floor.ts";
import {
  createContext,
  use,
  type Context,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon, KIND_COLOR, KindGlyph, KindTile, PartGlyph, type PartIcon } from "./glyphs.tsx";
import { lodOf, plateMarks, type Lod, type PlateMark } from "./lod.ts";
import {
  PILE_OFFSET,
  RAIL_HALF,
  type BundleGeo,
  type PlateGeo,
  type ProfileLayout,
} from "./layout.ts";
import { pluginOf, type Kind, type Plugin, type RelationKind } from "./model.ts";
import { bundleMetaOf } from "../shared-meta.ts";
import { agoText } from "../shared-sample.ts";
import { descriptionOf } from "./sample-ext.ts";
import {
  anchorWord,
  BLOCK_WORD,
  BOUNDARY_WORD,
  DECISION_WORD,
  KIND_WORD,
  RELATION_WORD,
  tokens,
} from "./words.ts";

/** 들어가는 꺾쇠의 반 높이와 깊이(참고 그림: 높이 11, 깊이 6) */
const ARROW_HALF = 5.5;
const ARROW_DEPTH = 6;

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

interface GlowData extends Record<string, unknown> {
  /** 빛을 받는 판의 상자(캔버스 좌표). 노드는 그 둘레로 GLOW_REACH만큼 넓다 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly kind: Kind | null;
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
  | Node<GlowData, "glow">
  | Node<FloorData, "floor">
  | Node<LinksData, "links">
  | Node<PlateData, "plate">
  | Node<PedestalData, "pedestal">
  | Node<PedestalData, "pile">
  | Node<BuilderData, "builder">;

// ── 빛 층: 고른 판 뒤의 번짐 ─────────────────────────────────────

/**
 * 고른 판 뒤에 깔리는 종류 색의 빛(참고 그림의 블러). 카드 모양 상자에 위로 밀린 그림자 두 겹을 주고(`cv6.css`의 `.cv6-glow-halo`),
 * 노드 전체를 왼쪽 아래 → 오른쪽 위로 기운 선에서 흐려지게 깎아 위·왼쪽·오른쪽 위에만 번지게 한다. 색은 종류 토큰 그대로다.
 * 바닥 점 위에 반투명으로 덮여 그 자리 점이 종류 색으로 물든다. 고른 판이 바뀔 때만 다시 그린다
 */
function GlowNode(props: NodeProps<Node<GlowData, "glow">>): ReactNode {
  const { w, h, kind } = props.data;
  return (
    <div
      aria-hidden="true"
      className="cv6-glow"
      data-kind={kind ?? undefined}
      style={{ width: w + GLOW_REACH * 2, height: h + GLOW_REACH * 2 }}
    >
      <span
        className="cv6-glow-halo"
        style={{ left: GLOW_REACH, top: GLOW_REACH, width: w, height: h }}
      />
    </div>
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
      className="cv6-floor"
      width={w}
      height={h}
      viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}
    >
      {/* 레일 */}
      <line x1={layout.railX0} x2={layout.railX1} y1={0} y2={0} className="cv6-rail-line" />
      {/* 되돌이 둘. 도구를 부르면 다시 모델로: 두 블록 사이의 빈 틈에서만 레일 아래로 짧게 돈다(소켓의 줄기와 겹치지 않는다).
          턴이 끝나면 다음 입력으로: 레일 끝에서 말아 내려가는 짧은 화살표와 말(판 줄을 가로지르는 긴 선을 긋지 않는다) */}
      {tools !== undefined && model !== undefined ? (
        <g className="cv6-return">
          <path
            d={`M${tools.x0 + 6} ${RAIL_HALF - 6} C${tools.x0 + 6} ${RAIL_HALF + 18} ${model.x1 - 6} ${RAIL_HALF + 18} ${model.x1 - 6} ${RAIL_HALF - 2}`}
            markerEnd="url(#cv6-arrow-floor)"
          />
          <text x={(tools.x0 + model.x1) / 2} y={-RAIL_HALF - 12} textAnchor="middle">
            {t("desktop.craft.canvas.cv4.loop.again")}
          </text>
        </g>
      ) : null}
      {end !== undefined ? (
        <g className="cv6-return">
          <path
            d={`M${end.x + 8} 0 H${layout.railX1 + 4} C${layout.railX1 + 22} 0 ${layout.railX1 + 22} ${RAIL_HALF + 6} ${layout.railX1 + 4} ${RAIL_HALF + 6} H${end.x + 24}`}
            markerEnd="url(#cv6-arrow-floor)"
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
            rx={10}
            className="cv6-station"
          />
          <text x={s.x0 + 14} y={6} className="cv6-station-num">
            {String(i + 1).padStart(2, "0")}
          </text>
          <text x={s.x0 + 40} y={6} className="cv6-station-label">
            {t(BLOCK_WORD[s.id])}
          </text>
        </g>
      ))}
      {/* 경계: 레일을 가로지르는 문 */}
      {layout.boundaries.map((x) => (
        <g key={x.id}>
          <line x1={x.x} x2={x.x} y1={-RAIL_HALF + 4} y2={RAIL_HALF - 4} className="cv6-gate" />
          <circle cx={x.x} cy={0} r={5} className="cv6-gate-dot" />
          <text x={x.x} y={-RAIL_HALF - 12} textAnchor="middle" className="cv6-gate-label">
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
          className="cv6-tick"
        />
      ))}
      {/* 판·묶음에서 소켓까지: 줄기, 버스, 더미를 꿰는 선(층을 넘는 선). 참고 그림의 선(1.5px 무채색)이고,
          고른 판(과 관계된 판)의 선만 같은 무채색으로 조금 밝아진다 */}
      {layout.wires.map((w2) => {
        const on = w2.owners.some((o) => lit.has(o));
        return <path key={w2.id} d={w2.d} className={on ? "cv6-wire cv6-wire-on" : "cv6-wire"} />;
      })}
      {/* 소켓: 선이 루프 블록으로 들어가는 자리의 열린 꺾쇠(참고 그림의 화살촉: 높이 11, 깊이 6, 끝이 블록 변에 닿는다).
          한 자리에 둘 이상이면 줄기 가운데에 수 */}
      {layout.sockets.map((k) => {
        const y = k.side === "top" ? -RAIL_HALF : RAIL_HALF;
        const back = k.side === "top" ? -ARROW_DEPTH : ARROW_DEPTH;
        const on = layout.wires.some(
          (w2) => w2.socket === `${k.anchor}|${k.side}` && w2.owners.some((o) => lit.has(o)),
        );
        return (
          <g key={`${k.anchor}:${k.side}`}>
            <path
              d={`M${String(k.x - ARROW_HALF)} ${String(y + back)} L${String(k.x)} ${String(y)} L${String(k.x + ARROW_HALF)} ${String(y + back)}`}
              className={on ? "cv6-socket cv6-socket-on" : "cv6-socket"}
            />
            {k.count > 1 ? (
              <g>
                <rect
                  x={k.x - 15}
                  y={k.cy - 10}
                  width={30}
                  height={20}
                  rx={10}
                  className="cv6-count"
                />
                <text x={k.x} y={k.cy + 4.5} textAnchor="middle" className="cv6-count-text">
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
            className="cv6-cross"
            opacity={showCross ? 1 : 0.4}
          >
            <path d={r.d} markerEnd="url(#cv6-arrow-cross)" />
            <text x={r.lx} y={r.ly} textAnchor="middle">
              {t("desktop.craft.canvas.cv3.rel.replacesTool", { tool: r.relation.label })}
            </text>
          </g>
        ))}
      {target !== null ? (
        <g data-kind={target.kind}>
          <circle cx={target.x} cy={target.y} r={14} className="cv6-target" />
          <circle cx={target.x} cy={target.y} r={4} className="cv6-rel-dot" />
        </g>
      ) : null}
      <defs>
        <marker
          id="cv6-arrow-cross"
          viewBox="-7 -6.5 8 13"
          refX="0"
          refY="0"
          markerUnits="userSpaceOnUse"
          markerWidth="8"
          markerHeight="13"
          orient="auto"
        >
          <path
            d={`M${String(-ARROW_DEPTH)} ${String(-ARROW_HALF)} 0 0 ${String(-ARROW_DEPTH)} ${String(ARROW_HALF)}`}
            className="cv6-rel-arrow"
            style={{ stroke: "var(--cs-color-warning-text)" }}
          />
        </marker>
        <marker
          id="cv6-arrow-floor"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M1 1 6 4 1 7" className="cv6-arrow-floor" />
        </marker>
      </defs>
    </svg>
  );
}

// ── 같은 층의 관계 선 ─────────────────────────────────────────────

function LinksNode(props: NodeProps<Node<LinksData, "links">>): ReactNode {
  const { layout, visible, lit } = props.data;
  const b = layout.bounds;
  const pad = 80;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  return (
    <svg
      aria-hidden="true"
      className="cv6-links"
      width={w}
      height={h}
      viewBox={`${b.x - pad} ${b.y - pad} ${w} ${h}`}
    >
      <defs>
        {/* 참고 그림의 끝 둘: 나가는 쪽 점(지름 8), 들어가는 쪽 열린 꺾쇠. 쉬는 선과 밝은 선에 한 벌씩 */}
        {(["", "-on"] as const).map((v) => (
          <g key={v}>
            <marker
              id={`cv6-rel-start${v}`}
              viewBox="-5 -5 10 10"
              refX="0"
              refY="0"
              markerUnits="userSpaceOnUse"
              markerWidth="10"
              markerHeight="10"
              orient="auto"
            >
              <circle r="4" className="cv6-rel-dot" />
            </marker>
            <marker
              id={`cv6-rel-end${v}`}
              viewBox="-7 -6.5 8 13"
              refX="0"
              refY="0"
              markerUnits="userSpaceOnUse"
              markerWidth="8"
              markerHeight="13"
              orient="auto"
            >
              <path
                d={`M${String(-ARROW_DEPTH)} ${String(-ARROW_HALF)} 0 0 ${String(-ARROW_DEPTH)} ${String(ARROW_HALF)}`}
                className={v === "" ? "cv6-rel-arrow" : "cv6-rel-arrow cv6-rel-on-arrow"}
              />
            </marker>
          </g>
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
              data-relation={kind}
              className={on ? "cv6-rel cv6-rel-on" : "cv6-rel"}
              markerStart={`url(#cv6-rel-start${on ? "-on" : ""})`}
              markerEnd={`url(#cv6-rel-end${on ? "-on" : ""})`}
            />
            {r.quiet ? null : <RelationLabel x={r.lx} y={r.ly} kind={kind} />}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 선의 이름표: 관계의 이름만 쓴다(의존, 기록 읽기, 만듦). 기능 id·기록 종류 같은 내부 이름은 싣지 않는다.
 * 무엇을 주고받는지는 상세 패널의 작동 방식에 사람이 읽는 말로 있다
 */
function RelationLabel(props: {
  readonly x: number;
  readonly y: number;
  readonly kind: RelationKind;
}): ReactElement {
  const label = t(RELATION_WORD[props.kind]);
  // 글자 폭 어림: 한글은 글자 크기만큼, 라틴·숫자는 그 반쯤
  let w = 16;
  for (let i = 0; i < label.length; i++) w += label.charCodeAt(i) > 0x1100 ? 13 : 7.2;
  return (
    <g>
      <rect
        x={props.x - w / 2}
        y={props.y - 11}
        width={w}
        height={22}
        rx={5}
        className="cv6-rel-pill"
      />
      <text x={props.x} y={props.y + 4.5} textAnchor="middle" className="cv6-rel-text">
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
  error: "cv6-mark-error",
  draft: "cv6-mark-draft",
  pending: "cv6-mark-pending",
  start: "cv6-mark-start",
  base: "",
};

/** 상태 표시: 단계가 멀수록 크게. 베이스는 자물쇠 그림만(이름은 툴팁) */
function Marks(props: { readonly geo: PlateGeo; readonly lod: Lod }): ReactNode {
  const marks = plateMarks(props.geo.placed);
  if (marks.length === 0) return null;
  const size = props.lod === "far" ? "cv6-mark-big" : props.lod === "mid" ? "cv6-mark-mid" : "";
  // 멀리서는 가장 앞선 하나만(경고가 먼저 선다)
  const shown = props.lod === "far" ? marks.slice(0, 1) : marks;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((m) =>
        m === "base" ? (
          <span key={m} className={`cv6-mark ${size}`} title={t(MARK_WORD[m])}>
            <PartGlyph
              name="lock"
              size={props.lod === "far" ? 17 : props.lod === "mid" ? 14 : 11}
            />
          </span>
        ) : (
          <span key={m} className={`cv6-mark ${size} ${MARK_CLASS[m]}`}>
            {t(MARK_WORD[m])}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * 책갈피(탭): 카드 왼쪽 변과 같은 자리에서 윗변 위로 솟는다(가까이 20, 중간 28, 멀리 36). 위 모서리만 둥글고 아래는 카드 뒤로
 * 들어가, 카드의 둥근 왼쪽 위 모서리 사이로 탭 색이 보인다. 진한 종류 색 면 + 밝은 종류 색 글(종류 그림 + 종류 이름).
 * 멀리서는 그림만 크게(색 조각으로 읽힌다)
 */
function KindTab(props: {
  readonly kind: Kind | null;
  readonly lod: Lod;
  /** 종류 이름 대신 쓸 말(묶음) */
  readonly word?: MessageId;
}): ReactElement {
  const glyph = props.lod === "far" ? 24 : props.lod === "mid" ? 16 : 12;
  const word = props.word ?? (props.kind === null ? null : KIND_WORD[props.kind]);
  return (
    <span className="cv6-tab" data-lod={props.lod} aria-hidden="true">
      {props.kind === null ? (
        <PartGlyph name="package" size={glyph} />
      ) : (
        <KindGlyph kind={props.kind} size={glyph} />
      )}
      {props.lod === "far" || word === null ? null : <span>{t(word)}</span>}
    </span>
  );
}

/**
 * 레일 쪽 변의 점: 선이 판에서 나가는 자리. 같은 자리에 둘 이상이면 점 대신 호출 순서 번호를 단 동그라미(단계가 멀수록 크게)
 */
function LipPad(props: { readonly geo: PlateGeo; readonly lod: Lod }): ReactNode {
  const { placed, lip } = props.geo;
  // Drive는 레일에 붙지 않는다(스타트 Drive만 입력 받기로 내려간다). 번호도 달지 않는다
  if (placed.plugin.kind === "drive" && !placed.start) return null;
  const numbered = placed.siblings > 1 && placed.plugin.kind !== "drive";
  return (
    <span
      className="cv6-pad"
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

/** 머리의 그림: 플러그인의 주된 구성 요소(지침·기억·스킬·MCP 서버·Drive 단계·Hook 처리기) */
function headIcon(p: Plugin): PartIcon {
  const s = p.shared;
  if (s.mcp !== undefined) return "mcp";
  if (p.kind === "drive") return "stage";
  if (p.kind === "hook") return "handler";
  if (s.memory.length > 0) return "memory";
  if (s.instructions.length > 0) return "instruction";
  if (s.skills.length > 0) return "skill";
  return "package";
}

/**
 * 알약 칩의 값 하나(참고 그림의 모델 이름 자리): Hook은 하는 결정(막기·바꾸기·묻기), 도구는 MCP 서버 이름,
 * 그 밖에는 싣는 파일·스킬 이름(여럿이면 첫째 + 나머지 수). 표본에 없으면 null(칸은 비우고 줄은 남긴다)
 */
function pillValue(p: Plugin): string | null {
  const s = p.shared;
  if (p.kind === "hook") return s.decision === undefined ? null : t(DECISION_WORD[s.decision]);
  if (s.mcp !== undefined) return s.mcp.server;
  const files = s.instructions.length > 0 ? s.instructions : s.memory;
  const list = files.length > 0 ? files : s.skills;
  const first = list[0];
  if (first === undefined) return null;
  return list.length > 1 ? `${first} +${String(list.length - 1)}` : first;
}

/** 푸터의 흐린 수치(참고 그림의 "382 Tokens · 시계 0.0 sec"): 매니페스트에 적힌 늘 드는 토큰, 시계 + 최근 사용 */
function Foot(props: { readonly p: Plugin }): ReactElement {
  const always = props.p.meta.cost.always;
  return (
    <div className="cv6-foot">
      {always === null ? null : (
        <span>{t("desktop.craft.canvas.cv3.inside.tokens", { n: tokens(always) })}</span>
      )}
      <span className="cv6-foot-item">
        <PartGlyph name="clock" size={12} />
        {agoText(props.p.shared.lastUsedMin)}
      </span>
    </div>
  );
}

/**
 * 카드 몸. 가까이(100%)는 참고 그림의 카드 그대로: 머리(그림 + 이름 + 상태 + 세로 점 셋) → 설명 두 줄 → 안쪽 면(꼬리표: 붙는 자리,
 * 글: 매니페스트의 긴 설명 네 줄까지) → 알약 칩 → 푸터. 중간은 같은 칸을 크게(푸터 없이), 멀리는 이름만 크게(두 줄까지)
 */
function PlateBody(props: { readonly geo: PlateGeo; readonly lod: Lod }): ReactNode {
  const actions = use(CanvasActionsContext);
  const p = props.geo.placed.plugin;
  if (props.lod === "far")
    return (
      <div className="cv6-plate-body" data-lod="far">
        <span className="cv6-name-wrap text-[40px] leading-[48px] font-semibold tracking-[-0.01em] text-text-primary">
          {p.name}
        </span>
      </div>
    );
  const description = descriptionOf(p.name);
  const pill = pillValue(p);
  const icon = props.lod === "mid" ? 20 : 16;
  return (
    <div className="cv6-plate-body" data-lod={props.lod}>
      <div className="cv6-head">
        <PartGlyph name={headIcon(p)} size={icon} />
        <span className="cv6-name">{p.name}</span>
        {props.lod === "near" ? <Marks geo={props.geo} lod={props.lod} /> : null}
        {props.lod === "near" ? (
          <button
            type="button"
            data-slot="cv6-button"
            className="cv6-menu"
            tabIndex={-1}
            aria-label={t("desktop.craft.canvas.cv3.panel.label", { name: p.name })}
            onClick={() => {
              actions.select(p.name);
            }}
          >
            <Icon name="more" size={18} />
          </button>
        ) : null}
      </div>
      <p className="cv6-desc">{t(p.meta.purpose)}</p>
      <div className="cv6-card-well">
        <span className="cv6-tag">{t(anchorWord(p.anchor))}</span>
        {description === null ? null : <p className="cv6-well-text">{t(description)}</p>}
      </div>
      <div className="cv6-pill-row">
        {pill === null ? null : (
          <span className="cv6-chip-pill">
            <PartGlyph name="layers" size={props.lod === "mid" ? 17 : 14} />
            <span>{pill}</span>
          </span>
        )}
      </div>
      {props.lod === "near" ? <Foot p={p} /> : null}
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
      className={`cv6-plate${dim ? " cv6-dim" : ""}`}
      style={{ width: geo.w, height: geo.h, color: KIND_COLOR[p.kind] }}
      onPointerDown={(e) => {
        actions.pointerDown(p.name, e);
      }}
      onDoubleClick={() => {
        actions.open(p.name);
      }}
    >
      <KindTab kind={p.kind} lod={lod} />
      <div className="cv6-card">
        {arrive > 0 ? <span key={arrive} className="cv6-arrive" aria-hidden="true" /> : null}
        <PlateBody geo={geo} lod={lod} />
      </div>
      {/* 중간·멀리: 상태는 카드 위 변 오른쪽에 걸친 표(이름 자리를 줄이지 않는다). 가까이는 이름 줄 끝에 */}
      {lod === "near" ? null : (
        <span className="cv6-edge-marks">
          <Marks geo={geo} lod={lod} />
        </span>
      )}
      <LipPad geo={geo} lod={lod} />
      {geo.handoffOut ? (
        <span className="cv6-pad" data-side="out" data-lod={lod} aria-hidden="true" />
      ) : null}
      <span className="sr-only">
        {t("desktop.craft.canvas.cv3.a11y.plate", {
          name: p.name,
          kind: t(KIND_WORD[p.kind]),
          where: t(anchorWord(p.anchor)),
        })}
      </span>
      <button
        type="button"
        data-slot="cv6-button"
        tabIndex={-1}
        aria-hidden="true"
        className="cv6-plate-hit"
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

const HEAD_SIZE: Readonly<Record<Lod, { name: string; count: string; kind: number }>> = {
  far: { name: "text-[26px]", count: "text-[19px]", kind: 16 },
  mid: { name: "text-[19px]", count: "text-[15px]", kind: 14 },
  near: { name: "text-[14.5px]", count: "text-[12px]", kind: 12 },
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
          data-slot="cv6-button"
          className="cv6-icon-btn ms-1"
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
      className="cv6-pedestal"
      style={{ width: geo.w, height: geo.h }}
      onClick={() => {
        actions.select(`bundle:${geo.id}`);
      }}
    >
      <KindTab kind={null} lod={lod} word="desktop.craft.canvas.cv3.bundle.word" />
      {arrive > 0 ? <span key={arrive} className="cv6-arrive" aria-hidden="true" /> : null}
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
      className="cv6-pile"
      style={{ width: geo.w, height: geo.h }}
      onDoubleClick={() => {
        actions.toggleBundle(geo.id);
      }}
    >
      <span
        className="cv6-pile-sheet"
        style={{ left: PILE_OFFSET * 2, top: 0, width: w, height: h }}
      />
      <span
        className="cv6-pile-sheet"
        style={{ left: PILE_OFFSET, top: PILE_OFFSET, width: w, height: h }}
      />
      <div className="cv6-pile-top" style={{ left: 0, top: PILE_OFFSET * 2, width: w, height: h }}>
        <KindTab kind={null} lod={lod} word="desktop.craft.canvas.cv3.bundle.word" />
        {arrive > 0 ? <span key={arrive} className="cv6-arrive" aria-hidden="true" /> : null}
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
          data-slot="cv6-button"
          tabIndex={-1}
          aria-hidden="true"
          className="cv6-plate-hit"
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
      className="cv6-builder"
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
  glow: GlowNode,
  floor: FloorNode,
  links: LinksNode,
  plate: PlateNode,
  pedestal: PedestalNode,
  pile: PileNode,
  builder: BuilderNode,
};
