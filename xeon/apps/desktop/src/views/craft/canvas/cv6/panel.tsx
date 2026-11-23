// cv6 플로팅 상세: 캔버스 위 맨 위 층에 뜬 판. 면은 받은 요청 카드(approval-card)를 바탕으로 하고 모서리는 rounded-3xl. 캔버스를 밀어내지 않고 머리를 끌어 옮긴다.
// 머리: 고정 줄(타일·이름·종류·자리·버전)과 접히는 줄(칩 줄: 리뷰·넣은 곳·스타트·출처·강제, 최근 사용과 상태). 접히는 줄은 아래로 스크롤하면 숨고 위로 스크롤하면 나온다.
// 본문 순서(사용자 2026-11-20): 1) 설명 2) 작동 방식(cv3의 작동 + 설명과 동작의 네 줄) 3) 비용 4) 구성 요소 5) 권한과 위임 6) 출처와 리뷰.
// 섹션 제목에 아이콘이 없다. 아래 줄: 내부 보기·테스트 런·빼기.
// 값은 계약에 있는 필드만 쓴다(표본 `shared-sample.ts`·`shared-meta.ts` + `sample-ext.ts`의 `description`, 계약의 `HOOKS`·`HOOK_POSITIONS`).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ProfileIssue } from "@fresnel/contracts/wire";
import { badgeVariants, Button, IconButton } from "@caustic/react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { InfoTip } from "../../info-tip.tsx";
import { ProgressOrb } from "../../../effects/progress-orb.tsx";
import type { PointHook } from "./live.ts";
import { agoText } from "../shared-sample.ts";
import { Icon, KIND_COLOR, KindGlyph, KindTile, PartGlyph } from "./glyphs.tsx";
import { FOLD_WORD, foldsOf, pluginFacts, type Fact } from "./facts.ts";
import { cardDescription } from "./layout.ts";
import {
  BUILDER,
  canNudge,
  orderFixed,
  swapPlugins,
  inProfile,
  bundleMetaFor,
  placedOf,
  pluginOf,
  providerOf,
  relationsOf,
  type Anchor,
  type CanvasProfile,
  type Placed,
  type Plugin,
  type RelationKind,
} from "./model.ts";
import { purposeOf, usedByOf } from "../shared-meta.ts";
import {
  anchorWord,
  BLOCK_WORD,
  DECISION_WORD,
  HEALTH_WORD,
  KIND_WORD,
  LANE_WORD,
  ORIGIN_WORD,
  REVIEW_WORD,
  RISK_LEVEL,
  RISK_WORD,
  STEP_WORD,
  tokens,
} from "./words.ts";

export const PANEL_W = 440;
/** 붙은 자리: 오른쪽 위. 아래는 확대·맞춤 도구 막대 자리를 비워 둔다 */
const DOCK = { right: 12, top: 56, foot: 60 } as const;

export interface PanelActions {
  close(): void;
  focus(name: string): void;
  open(name: string): void;
  remove(name: string): void;
  add(name: string): void;
  nudge(name: string, delta: -1 | 1): void;
  /** 블록 상세: 한 Hook의 차례에서 이웃(`other`)과 프로필 자리를 맞바꾼다 */
  swap(name: string, other: string): void;
  setStart(name: string): void;
  toggleBundle(id: string): void;
  removeBundle(id: string): void;
  testRun(name: string): void;
  /** Hook 자리 하나의 블록 상세(그 자리에 붙은 플러그인과 순서, 충돌)를 연다 */
  point(anchor: Anchor): void;
}

/**
 * 떠 있는 판. 면은 받은 요청 카드와 같고(surface.base, border.subtle 1px), 모서리는 rounded-3xl(squircle)로 크게 둔다. 머리를 끌어 옮기고 두 번 누르면 제자리.
 * 머리는 둘로 나뉜다. 고정 줄(타일·이름·종류)은 늘 보이고, 접히는 줄(칩 줄과 최근 사용 줄)은 본문과 함께 스크롤 상자 맨 위에 붙어 있다가
 * 아래로 스크롤하면 위로 밀려 숨고, 위로 스크롤하거나 맨 위로 오면 다시 내려온다. 접히는 줄은 sticky라 자리를 차지한 채 transform·opacity만 바뀐다(본문이 뛰지 않는다).
 */
function FloatingPanel(props: {
  readonly children: ReactNode;
  readonly label: string;
  /** 이것이 바뀌면 스크롤을 맨 위로 되돌린다(다른 플러그인을 열 때) */
  readonly page: string;
  readonly head: ReactNode;
  readonly tuck?: ReactNode;
  readonly foot: ReactNode;
  readonly onClose: () => void;
}): ReactElement {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [edge, setEdge] = useState<"none" | "head" | "tuck">("none");
  const ref = useRef<HTMLElement>(null);
  const startDrag = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || !(e.target instanceof HTMLElement) || e.target.closest("button") !== null)
      return;
    const el = ref.current;
    const parent = el?.parentElement;
    if (el === null || parent === null || parent === undefined) return;
    const pr = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (m: PointerEvent): void => {
      const x = Math.min(Math.max(8, m.clientX - pr.left - dx), pr.width - r.width - 8);
      const y = Math.min(Math.max(8, m.clientY - pr.top - dy), pr.height - 80);
      setPos({ x, y });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <section
      ref={ref}
      aria-label={props.label}
      className="cv6-float absolute z-30 flex flex-col rounded-3xl text-ui text-text-primary"
      style={
        pos === null
          ? {
              right: DOCK.right,
              top: DOCK.top,
              width: PANEL_W,
              maxHeight: `calc(100% - ${String(DOCK.top + DOCK.foot)}px)`,
            }
          : {
              left: pos.x,
              top: pos.y,
              width: PANEL_W,
              maxHeight: `calc(100% - ${String(pos.y + DOCK.foot)}px)`,
            }
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <header
        className="cv6-float-head relative z-20 cursor-grab px-5 pt-5 pb-3 active:cursor-grabbing"
        data-edge={edge === "head" ? "" : undefined}
        onPointerDown={startDrag}
        onDoubleClick={() => {
          setPos(null);
        }}
        title={t("desktop.craft.canvas.cv3.panel.move")}
      >
        {props.head}
        <span className="absolute top-4 right-4">
          <IconButton
            size="xs"
            variant="ghost"
            label={t("desktop.craft.canvas.cv3.panel.close")}
            onClick={props.onClose}
          >
            <Icon name="close" size={14} />
          </IconButton>
        </span>
      </header>
      <Scroller key={props.page} tuck={props.tuck} onEdge={setEdge}>
        {props.children}
      </Scroller>
      {props.foot === null ? null : (
        <footer className="cv6-float-foot flex flex-wrap items-center gap-1.5 px-5 pt-3 pb-4">
          {props.foot}
        </footer>
      )}
    </section>
  );
}

/** 스크롤을 몇 px 넘게 움직여야 접히는 줄이 방향을 바꾼다(손 떨림·관성 끝의 작은 되튐을 거른다) */
const TUCK_SLOP = 3;

/**
 * 본문 스크롤 상자. 맨 위의 접히는 줄은 sticky top 0이다.
 * - 맨 위에서 접히는 줄의 높이만큼은 그대로 붙어 있다(본문이 그 아래로 지나간다).
 * - 그보다 아래에서 아래로 스크롤하면 위로 밀려 숨는다(translateY(-100%), opacity 0).
 * - 위로 스크롤하면 다시 내려온다. 맨 위로 오면 늘 보인다.
 * 상태는 바뀔 때만 set한다. 스크롤하지 않으면 아무 일도 하지 않는다.
 */
function Scroller(props: {
  readonly tuck: ReactNode;
  readonly children: ReactNode;
  readonly onEdge: (edge: "none" | "head" | "tuck") => void;
}): ReactElement {
  const [tucked, setTucked] = useState(false);
  const last = useRef(0);
  const tuckRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<"none" | "head" | "tuck">("none");
  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    const y = e.currentTarget.scrollTop;
    const h = tuckRef.current?.offsetHeight ?? 0;
    const d = y - last.current;
    last.current = y;
    const next = y <= h ? false : d > TUCK_SLOP ? true : d < -TUCK_SLOP ? false : tucked;
    if (next !== tucked) setTucked(next);
    // 머리 아래 선: 본문이 접히는 줄(또는 머리) 밑으로 지나갈 때만
    const nextEdge = y <= 0 ? "none" : props.tuck === undefined || next ? "head" : "tuck";
    if (nextEdge !== edge) {
      setEdge(nextEdge);
      props.onEdge(nextEdge);
    }
  };
  return (
    <div className="cv6-scroll min-h-0 flex-1 overflow-y-auto px-5" onScroll={onScroll}>
      {props.tuck === undefined ? null : (
        <div
          ref={tuckRef}
          className="cv6-tuck sticky top-0 z-10 -mx-5 px-5 pb-4"
          data-tucked={tucked ? "" : undefined}
          data-edge={edge === "tuck" ? "" : undefined}
        >
          {props.tuck}
        </div>
      )}
      {props.children}
    </div>
  );
}

/** 고정 줄: 타일·제목·곁 줄(종류·자리·버전) */
function Head(props: {
  readonly tile: ReactNode;
  readonly title: string;
  readonly aside?: string;
  readonly sub: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-start gap-3 pe-8">
      {props.tile}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 className="m-0 flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] leading-5 font-semibold text-text-primary">
            {props.title}
          </span>
          {props.aside === undefined ? null : (
            <span className="truncate text-ui-sm font-normal text-text-tertiary">
              {props.aside}
            </span>
          )}
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 text-ui-sm text-text-tertiary">
          {props.sub}
        </div>
      </div>
    </div>
  );
}

/** 접히는 줄: 칩 줄, 그 아래 최근 사용 줄 */
function Tuck(props: { readonly chips: ReactNode; readonly line?: ReactNode }): ReactElement {
  return (
    <>
      <div className="flex flex-wrap gap-1">{props.chips}</div>
      {props.line === undefined ? null : (
        <div className="mt-2.5 flex min-w-0 items-center gap-3 text-ui-sm text-text-tertiary">
          {props.line}
        </div>
      )}
    </>
  );
}

/**
 * 본문 섹션: 제목은 15/600 primary, 아이콘 없음. 섹션 사이에 선, 위아래 20px.
 * 본문이 없으면(접힌 비용) 제목 한 줄만 남고 곁 글이 오른쪽에 선다
 */
function Section(props: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  const folded = props.children === undefined;
  return (
    <section
      className={`cv6-sec ${folded ? "py-4" : "py-5"} [.cv6-tuck+&]:pt-2`}
      data-folded={folded ? "" : undefined}
    >
      <h3
        className={`m-0 flex items-center gap-2 text-[15px] leading-5 font-semibold text-text-primary ${folded ? "" : "mb-3"}`}
      >
        <span>{props.title}</span>
        {props.aside === undefined ? null : (
          <span className="ms-auto flex items-center gap-2 text-ui-sm font-normal text-text-secondary">
            {props.aside}
          </span>
        )}
      </h3>
      {props.children}
    </section>
  );
}

function Row(props: { readonly k: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-7 items-baseline gap-3 py-0.5 text-ui">
      <dt className="w-24 shrink-0 text-text-tertiary">{props.k}</dt>
      <dd className="m-0 min-w-0 flex-1 text-text-primary">{props.children}</dd>
    </div>
  );
}

function Pill(props: {
  readonly tone?: "plain" | "warn" | "ok";
  readonly children: ReactNode;
}): ReactElement {
  return <span className={`cv6-pill cv6-pill-${props.tone ?? "plain"}`}>{props.children}</span>;
}

function Chip(props: {
  readonly tone?: "neutral" | "warning" | "success";
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span
      data-slot="badge"
      className={badgeVariants({ size: "sm", radius: "md", tone: props.tone ?? "neutral" })}
    >
      {props.children}
    </span>
  );
}

/**
 * 관계 선 견본(캔버스와 같은 문법): 나가는 점, 1.5px 실선, 들어가는 꺾쇠. 관계 종류는 선이 아니라 이름표가 가르므로
 * 종류마다 같은 그림이다(`kind`는 화면 읽기용 자리에 남긴다)
 */
export function RelationSwatch(props: { readonly kind: RelationKind }): ReactElement {
  return (
    <svg width={28} height={12} aria-hidden="true" className="shrink-0" data-relation={props.kind}>
      <line x1={4} x2={26} y1={6} y2={6} className="cv6-rel cv6-rel-on" />
      <circle cx={4} cy={6} r={3} className="cv6-rel-dot" />
      <path d="M22.5 2.5 26 6l-3.5 3.5" className="cv6-rel-arrow cv6-rel-on-arrow" />
    </svg>
  );
}

// ── 종류마다 작동 그림 ─────────────────────────────────────────────

function HookWorks(props: { readonly p: Plugin }): ReactElement {
  const s = props.p.shared;
  const decision = s.decision;
  const block =
    props.p.anchor.startsWith("before:") || props.p.anchor.startsWith("after:")
      ? props.p.anchor.split(":")[1]
      : null;
  const before = props.p.anchor.startsWith("before:") || props.p.anchor.startsWith("boundary:");
  const color = KIND_COLOR.hook;
  return (
    <div className="cv6-well px-3 py-3">
      <svg viewBox="0 0 400 96" className="w-full" aria-hidden="true">
        <line x1={10} x2={390} y1={30} y2={30} className="cv6-mini-rail" />
        <rect
          x={before ? 214 : 70}
          y={16}
          width={130}
          height={28}
          rx={7}
          className="cv6-mini-block"
        />
        <text x={before ? 279 : 135} y={34} textAnchor="middle" className="cv6-mini-label">
          {block === null
            ? t("desktop.craft.canvas.cv3.boundary.end")
            : t(BLOCK_WORD[block === "model" ? "model" : block === "tools" ? "tools" : "context"])}
        </text>
        <g style={{ color }}>
          <path d={`M${before ? 190 : 224} 18 l9 12 l-9 12 l-9 -12 Z`} className="cv6-mini-gate" />
          <path d={`M${before ? 190 : 224} 44 V62`} className="cv6-mini-branch" />
          <path
            d={`M${before ? 190 : 224} 62 H${before ? 150 : 270}`}
            className="cv6-mini-branch"
          />
          <path
            d={`M${before ? 190 : 224} 62 H${before ? 230 : 330}`}
            className="cv6-mini-branch cv6-mini-branch-pass"
          />
        </g>
        <text
          x={before ? 146 : 274}
          y={82}
          textAnchor={before ? "end" : "start"}
          className="cv6-mini-out"
          style={{ fill: color }}
        >
          {decision === undefined ? "" : t(DECISION_WORD[decision])}
        </text>
        <text x={before ? 234 : 334} y={82} className="cv6-mini-label">
          {t("desktop.craft.canvas.cv3.works.pass")}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Pill>{t(anchorWord(props.p.anchor))}</Pill>
        {decision === undefined ? null : <Pill>{t(DECISION_WORD[decision])}</Pill>}
        <Pill tone={props.p.meta.enforcement === "enforced" ? "ok" : "plain"}>
          {t(
            props.p.meta.enforcement === "enforced"
              ? "desktop.craft.canvas.cv3.works.enforced"
              : "desktop.craft.canvas.cv3.works.advisory",
          )}
        </Pill>
        {s.guard === true ? <Pill>{t("desktop.craft.canvas.cv3.works.guard")}</Pill> : null}
      </div>
    </div>
  );
}

function DriveWorks(props: { readonly p: Plugin; readonly start: boolean }): ReactElement {
  const steps = props.p.shared.steps ?? [];
  const handoff = props.p.shared.handoffTo ?? [];
  return (
    <div className="cv6-well flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="text-text-tertiary">
          {t(
            props.start
              ? "desktop.craft.canvas.cv3.works.startIn"
              : "desktop.craft.canvas.cv3.works.handoffIn",
          )}
        </span>
        {steps.map((st, i) => (
          <span key={st.id} className="flex items-center gap-1.5">
            <span className="text-text-tertiary">→</span>
            <span
              className="cv6-step"
              style={{ borderColor: `color-mix(in oklab, ${KIND_COLOR.drive} 45%, transparent)` }}
            >
              <span className="text-text-tertiary tabular-nums">{String(i + 1)}</span>
              <span>{t(STEP_WORD[st.id])}</span>
              {st.parallel > 1 ? (
                <span className="text-text-tertiary">×{String(st.parallel)}</span>
              ) : null}
            </span>
          </span>
        ))}
        {handoff.map((h) => (
          <span key={h} className="flex items-center gap-1.5">
            <span style={{ color: KIND_COLOR.drive }}>⇢</span>
            <span className="cv6-mono text-text-secondary">{h}</span>
          </span>
        ))}
      </div>
      {steps.some((s) => s.lanes !== undefined) ? (
        <div className="text-[12px] text-text-tertiary">
          {steps
            .filter((s) => s.lanes !== undefined)
            .map((s) =>
              t("desktop.craft.canvas.cv3.works.lanes", {
                step: t(STEP_WORD[s.id]),
                lanes: (s.lanes ?? []).map((l) => t(LANE_WORD[l])).join(", "),
              }),
            )
            .join(" ")}
        </div>
      ) : null}
    </div>
  );
}

function ToolWorks(props: { readonly p: Plugin }): ReactElement {
  const tools = props.p.shared.mcp?.tools ?? [];
  return (
    <div className="cv6-well px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-text-secondary">
        <PartGlyph name="mcp" size={14} />
        <span className="cv6-mono">{props.p.shared.mcp?.server ?? props.p.name}</span>
        <span className="ms-1 flex items-center gap-3 text-text-tertiary">
          <span>{t("desktop.craft.canvas.cv5.cost.tools", { n: tools.length })}</span>
          <span>
            {t("desktop.craft.canvas.cv6.count.writes", {
              n: tools.filter((x) => x.writes).length,
            })}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {tools.map((x) => (
          <span key={x.name} className="cv6-tool-chip" data-writes={x.writes ? "" : undefined}>
            <span className="cv6-mono truncate">{x.name}</span>
            {x.writes ? (
              <span className="text-[10.5px]">{t("desktop.craft.canvas.cv3.works.writes")}</span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function InjectWorks(props: { readonly p: Plugin }): ReactElement {
  const s = props.p.shared;
  const cost = props.p.meta.cost;
  return (
    <div className="cv6-well flex flex-col gap-2 px-3 py-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <Pill>{t("desktop.craft.canvas.cv3.works.always")}</Pill>
        <span className="text-text-secondary">
          {[...s.instructions, ...s.memory].join(", ") ||
            t("desktop.craft.canvas.cv3.works.nothing")}
        </span>
        {cost.always === null ? null : (
          <span className="ms-auto text-text-tertiary tabular-nums">{tokens(cost.always)}</span>
        )}
      </div>
      {s.skills.length > 0 ? (
        <div className="flex items-start gap-2">
          <Pill>{t("desktop.craft.canvas.cv3.works.onDemand")}</Pill>
          <span className="flex flex-wrap gap-1">
            {s.skills.map((k) => (
              <span key={k} className="cv6-chip">
                {k}
              </span>
            ))}
          </span>
          {cost.onDemand === null ? null : (
            <span className="ms-auto shrink-0 text-text-tertiary tabular-nums">
              {tokens(cost.onDemand)}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── 플러그인 상세 ─────────────────────────────────────────────────

function RelationRows(props: {
  readonly p: Plugin;
  readonly profile: CanvasProfile;
  readonly placed: Placed | undefined;
  readonly actions: PanelActions;
  /** 다른 섹션이 보이는 관계(핸드오프는 권한과 위임에) */
  readonly skip?: RelationKind;
}): ReactElement {
  const { p, profile } = props;
  const rels = relationsOf(profile).filter(
    (r) => (r.from === p.name || r.to === p.name) && r.kind !== props.skip,
  );
  const rows: ReactNode[] = [];
  for (const r of rels) {
    const outgoing = r.from === p.name;
    const other = outgoing ? r.to : r.from;
    const otherName =
      other === BUILDER
        ? t("desktop.craft.canvas.cv3.builder.name")
        : other.startsWith("tool:")
          ? t("desktop.craft.canvas.cv3.rel.builtinTool", { tool: r.label })
          : other;
    const verb = t(
      outgoing
        ? (`desktop.craft.canvas.cv3.relOut.${r.kind}` as const)
        : (`desktop.craft.canvas.cv3.relIn.${r.kind}` as const),
    );
    const clickable = pluginOf(other) !== undefined && inProfile(profile, other);
    rows.push(
      <li
        key={`${r.kind}:${r.from}:${r.to}:${r.label}`}
        className="flex items-center gap-2 py-1 text-[13px]"
      >
        <RelationSwatch kind={r.kind} />
        <span className="w-24 shrink-0 text-text-tertiary">{verb}</span>
        {clickable ? (
          <button
            type="button"
            data-slot="cv6-button"
            className="cv6-link"
            onClick={() => props.actions.focus(other)}
          >
            {otherName}
          </button>
        ) : (
          <span className="text-text-primary">{otherName}</span>
        )}
      </li>,
    );
  }
  // 엔진이 주는 기능, 아무도 주지 않는 기능: 기능 id는 내부 이름이라 싣지 않고, (필요·있으면 씀) × (엔진·없음)마다 한 줄에 수만 둔다
  const needs = [
    ...p.meta.requires.map((n) => ({ optional: false, prov: providerOf(profile, n.id).type })),
    ...p.meta.optional.map((n) => ({ optional: true, prov: providerOf(profile, n.id).type })),
  ];
  for (const optional of [false, true])
    for (const prov of ["engine", "none"] as const) {
      const n = needs.filter((x) => x.optional === optional && x.prov === prov).length;
      if (n === 0) continue;
      rows.push(
        <li
          key={`cap:${String(optional)}:${prov}`}
          className="flex items-center gap-2 py-1 text-[13px]"
        >
          <RelationSwatch kind="depends" />
          <span className="w-24 shrink-0 text-text-tertiary">
            {t(
              optional
                ? "desktop.craft.canvas.cv3.relOut.optional"
                : "desktop.craft.canvas.cv3.relOut.depends",
            )}
          </span>
          <span
            className={
              prov === "none" ? "text-[var(--cs-color-warning-text)]" : "text-text-secondary"
            }
          >
            {t(
              prov === "engine"
                ? "desktop.craft.canvas.cv3.rel.engine"
                : "desktop.craft.canvas.cv3.rel.unmet",
            )}
          </span>
          {n > 1 ? (
            <span className="ms-auto text-ui-sm text-text-tertiary tabular-nums">
              {t("desktop.craft.canvas.cv4.rel.capCount", { n })}
            </span>
          ) : null}
        </li>,
      );
    }
  const source = props.placed?.source;
  if (source?.type === "bundle") {
    const meta = bundleMetaFor(source.id);
    rows.unshift(
      <li key="own" className="flex items-center gap-2 py-1 text-[13px]">
        <span className="flex w-7 shrink-0 justify-center text-text-tertiary">
          <PartGlyph name="package" size={13} />
        </span>
        <span className="w-24 shrink-0 text-text-tertiary">
          {t("desktop.craft.canvas.cv3.rel.ownedBy")}
        </span>
        <button
          type="button"
          data-slot="cv6-button"
          className="cv6-link"
          onClick={() => props.actions.focus(`bundle:${source.id}`)}
        >
          {meta.displayName}
        </button>
        <span className="cv6-mono ms-auto truncate text-[11.5px] text-text-tertiary">{`${source.id}/${p.name}`}</span>
      </li>,
    );
  }
  if (rows.length === 0)
    return (
      <p className="m-0 text-ui text-text-tertiary">{t("desktop.craft.canvas.cv3.rel.none")}</p>
    );
  return <ul className="flex flex-col">{rows}</ul>;
}

function RiskMeter(props: { readonly level: number }): ReactElement {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="cv6-risk-seg"
          data-on={i <= props.level ? "" : undefined}
          data-high={props.level >= 3 ? "" : undefined}
        />
      ))}
    </span>
  );
}

/** 작동 방식의 네 줄 하나: 왼쪽 줄 이름(시점·입력·영향·출력) + 값 칩들. 값이 없으면 줄이 없다 */
function FactRow(props: { readonly label: string; readonly facts: readonly Fact[] }): ReactNode {
  if (props.facts.length === 0) return null;
  return (
    <div className="flex items-start gap-3 py-0.75">
      <dt className="w-12 shrink-0 pt-0.75 text-ui-sm leading-4 text-text-tertiary">
        {props.label}
      </dt>
      <dd className="m-0 flex min-w-0 flex-1 flex-wrap gap-1">
        {props.facts.map((f, i) => {
          const value = f.value ?? (f.count > 1 ? String(f.count) : null);
          return (
            <span
              key={`${f.word}:${f.at ?? ""}:${f.value ?? ""}:${String(i)}`}
              className="cv6-fact"
              data-warn={f.warn ? "" : undefined}
            >
              <span>{t(f.at === null ? f.word : anchorWord(f.at))}</span>
              {value === null ? null : <span className="cv6-fact-value">{value}</span>}
            </span>
          );
        })}
      </dd>
    </div>
  );
}

/** 비용 칸. 값이 없는 칸은 보이지 않는다(넷 다 없으면 섹션이 제목 한 줄로 접힌다) */
const COST_KEYS = ["always", "drive", "onDemand", "toolCount"] as const;

export function PluginDetail(props: {
  readonly name: string;
  readonly profile: CanvasProfile;
  readonly placed: Placed | undefined;
  readonly actions: PanelActions;
}): ReactNode {
  const p = pluginOf(props.name);
  if (p === undefined) return null;
  const { meta, shared: s } = p;
  const placed = props.placed;
  const draft = meta.review.state === "draft";
  const inside = placed !== undefined;
  const rels = relationsOf(props.profile);
  const handoffFrom = rels
    .filter((r) => r.kind === "handoff" && r.to === p.name)
    .map((r) => r.from);
  const handoffTo = rels.filter((r) => r.kind === "handoff" && r.from === p.name).map((r) => r.to);
  const facts = pluginFacts(p, { start: placed?.start === true, handoffFrom });
  // 합치는 방식은 같은 자리의 Hook끼리만 뜻이 있다(Drive의 Hook은 다른 자리들에 흩어져 있다)
  const folds = p.kind === "hook" ? foldsOf(p) : [];
  const costs = COST_KEYS.flatMap((k) => {
    const v = meta.cost[k];
    return v === null ? [] : [[k, v] as const];
  });
  const description = cardDescription(p);
  const sourceWord =
    placed === undefined
      ? t("desktop.craft.canvas.cv3.source.out")
      : placed.source.type === "base"
        ? t("desktop.craft.canvas.cv3.base")
        : placed.source.type === "bundle"
          ? t("desktop.craft.canvas.cv3.source.bundle", {
              name: bundleMetaFor(placed.source.id).displayName,
            })
          : t("desktop.craft.canvas.cv3.source.profile");
  const writes = (s.mcp?.tools ?? []).filter((x) => x.writes).length;
  const unmet = meta.requires.filter((n) => providerOf(props.profile, n.id).type === "none");
  const siblings =
    placed === undefined ? [] : placedOf(props.profile).filter((x) => x.plugin.anchor === p.anchor);
  const reviewWord =
    meta.pending !== null && meta.review.state === "approved"
      ? t("desktop.craft.canvas.cv3.review.pendingVersion", { v: meta.pending.version })
      : t(REVIEW_WORD[meta.review.state]);
  const healthBad = meta.health === "error" || meta.health === "integrity";
  const requiredBy = meta.requiredBy ?? [];

  const head = (
    <Head
      tile={<KindTile kind={p.kind} size={32} draft={draft} />}
      title={p.name}
      aside={meta.displayName}
      sub={
        <>
          <span className="font-medium" style={{ color: KIND_COLOR[p.kind] }}>
            {t(KIND_WORD[p.kind])}
          </span>
          <span>{t(anchorWord(p.anchor))}</span>
          <span className="cv6-mono">{`v${draft ? (meta.pending?.version ?? meta.version) : meta.version}`}</span>
        </>
      }
    />
  );
  const tuck = (
    <Tuck
      chips={
        <>
          <Chip
            tone={meta.review.state === "approved" && meta.pending === null ? "success" : "warning"}
          >
            {reviewWord}
          </Chip>
          <Chip>{sourceWord}</Chip>
          {placed?.start === true ? <Chip>{t("desktop.craft.canvas.cv3.startDrive")}</Chip> : null}
          <Chip>{t(ORIGIN_WORD[meta.origin])}</Chip>
          {meta.enforcement === "enforced" ? (
            <Chip>{t("desktop.craft.canvas.cv3.works.enforced")}</Chip>
          ) : null}
          {requiredBy.length > 0 ? <Chip>{t("desktop.craft.canvas.cv9.lock.chip")}</Chip> : null}
        </>
      }
      line={
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <PartGlyph name="clock" size={13} />
            <span>
              {t("desktop.craft.canvas.cv3.meta.lastUsedLine", { ago: agoText(s.lastUsedMin) })}
            </span>
          </span>
          <span className={healthBad ? "text-danger-text" : ""}>{t(HEALTH_WORD[meta.health])}</span>
        </>
      }
    />
  );

  const foot = (
    <>
      <Button size="sm" variant="outline" onClick={() => props.actions.open(p.name)}>
        <Icon name="enter" size={14} />
        {t("desktop.craft.canvas.cv3.act.inside")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => props.actions.testRun(p.name)}>
        <Icon name="play" size={13} />
        {t("desktop.craft.canvas.cv3.act.test")}
      </Button>
      {inside && placed.source.type === "profile" && p.kind === "drive" && !placed.start ? (
        <Button size="sm" variant="ghost" onClick={() => props.actions.setStart(p.name)}>
          {t("desktop.craft.canvas.cv3.act.makeStart")}
        </Button>
      ) : null}
      <span className="ms-auto" />
      {!inside ? (
        <Button size="sm" onClick={() => props.actions.add(p.name)}>
          <Icon name="plus" size={14} />
          {t("desktop.craft.canvas.cv3.act.add")}
        </Button>
      ) : placed.source.type === "base" ? (
        <span className="flex items-center gap-1 text-ui-sm text-text-tertiary">
          <PartGlyph name="lock" size={12} />
          {t("desktop.craft.canvas.cv3.act.baseFixed")}
        </span>
      ) : requiredBy.length > 0 ? (
        <span className="flex items-center gap-1.5 text-ui-sm text-text-tertiary">
          <PartGlyph name="lock" size={12} />
          {t("desktop.craft.canvas.cv9.lock.short")}
          <InfoTip
            text={t("desktop.craft.canvas.cv9.lock.why", { parts: requiredBy.join(", ") })}
          />
        </span>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => props.actions.remove(p.name)}>
          <Icon name="remove" size={14} />
          {placed.source.type === "bundle"
            ? t("desktop.craft.canvas.cv3.act.removeBundle")
            : t("desktop.craft.canvas.cv3.act.remove")}
        </Button>
      )}
    </>
  );

  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cv3.panel.label", { name: p.name })}
      page={p.name}
      head={head}
      tuck={tuck}
      foot={foot}
      onClose={() => props.actions.close()}
    >
      {/* 1) 설명: 한 문장 목적(15.5/600)과 설명 글, 사이를 넓게 */}
      <Section title={t("desktop.craft.canvas.cv4.sec.about")}>
        <p className="m-0 text-[15.5px] leading-[22px] font-semibold text-text-primary">
          {purposeOf(meta)}
        </p>
        {description === null ? null : (
          <p className="m-0 mt-2.5 text-ui-relaxed text-text-secondary">{description}</p>
        )}
      </Section>

      {/* 2) 작동 방식: 앞은 cv3의 "작동"(종류 그림, 같은 자리 순서와 합치는 방식, 관계), 뒤는 cv3 "설명과 동작"의 네 줄 */}
      <Section
        title={t("desktop.craft.canvas.cv4.sec.how")}
        aside={
          placed !== undefined && placed.siblings > 1 ? (
            <span className="tabular-nums">
              {t("desktop.craft.canvas.cv3.order", { n: placed.order, of: placed.siblings })}
            </span>
          ) : undefined
        }
      >
        {p.kind === "hook" ? <HookWorks p={p} /> : null}
        {p.kind === "drive" ? <DriveWorks p={p} start={placed?.start === true} /> : null}
        {p.kind === "tool" ? <ToolWorks p={p} /> : null}
        {p.kind === "inject" ? <InjectWorks p={p} /> : null}
        {siblings.length > 1 ? (
          <div className="mt-3">
            <div className="flex min-h-7 flex-wrap items-center gap-1 text-ui">
              <span className="me-2 text-ui-sm text-text-tertiary">
                {t("desktop.craft.canvas.cv3.works.sameSpot")}
              </span>
              {siblings.map((x, i) => (
                <span key={x.plugin.name} className="flex items-center gap-1">
                  {i > 0 ? <span className="text-text-tertiary">→</span> : null}
                  <span
                    className={
                      x.plugin.name === p.name
                        ? "font-medium text-text-primary"
                        : "text-text-secondary"
                    }
                  >
                    {x.plugin.name}
                  </span>
                </span>
              ))}
              {placed !== undefined && placed.source.type === "profile" ? (
                <span className="ml-auto flex items-center">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    disabled={!canNudge(props.profile, p.name, -1)}
                    label={t("desktop.craft.canvas.cv3.act.earlier")}
                    onClick={() => props.actions.nudge(p.name, -1)}
                  >
                    <Icon name="up" size={14} />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    disabled={!canNudge(props.profile, p.name, 1)}
                    label={t("desktop.craft.canvas.cv3.act.later")}
                    onClick={() => props.actions.nudge(p.name, 1)}
                  >
                    <Icon name="down" size={14} />
                  </IconButton>
                </span>
              ) : null}
            </div>
            {folds.map((f) => (
              <p key={f} className="m-0 text-ui-sm text-text-tertiary">
                {t(FOLD_WORD[f])}
              </p>
            ))}
          </div>
        ) : null}
        {p.kind === "hook" && inside ? (
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={() => props.actions.point(p.anchor)}>
              {t("desktop.craft.canvas.cv9.point.open", { at: t(anchorWord(p.anchor)) })}
            </Button>
          </div>
        ) : null}
        <div className="mt-3">
          <RelationRows
            p={p}
            profile={props.profile}
            placed={placed}
            actions={props.actions}
            skip="handoff"
          />
        </div>
        <dl className="cv6-facts m-0 mt-3 pt-3">
          <FactRow label={t("desktop.craft.canvas.cv4.fact.when")} facts={facts.when} />
          <FactRow label={t("desktop.craft.canvas.cv4.fact.reads")} facts={facts.reads} />
          <FactRow label={t("desktop.craft.canvas.cv4.fact.changes")} facts={facts.changes} />
          <FactRow label={t("desktop.craft.canvas.cv4.fact.gives")} facts={facts.gives} />
        </dl>
      </Section>

      {/* 3) 비용: 값이 있는 칸만. 하나도 없으면 제목 한 줄로 접는다 */}
      {costs.length === 0 ? (
        <Section
          title={t("desktop.craft.canvas.cv3.sec.cost")}
          aside={
            <>
              <span className="text-text-tertiary">{t("desktop.craft.canvas.cv4.cost.none")}</span>
              <InfoTip text={t("desktop.craft.canvas.cv3.cost.hint")} />
            </>
          }
        />
      ) : (
        <Section
          title={t("desktop.craft.canvas.cv3.sec.cost")}
          aside={<InfoTip text={t("desktop.craft.canvas.cv3.cost.hint")} />}
        >
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${String(costs.length)}, minmax(0, 1fr))` }}
          >
            {costs.map(([k, v]) => (
              <div key={k} className="cv6-stat">
                <span className="text-[11px] text-text-tertiary">
                  {t(`desktop.craft.canvas.cv3.cost.${k}` as const)}
                </span>
                <span className="text-[15px] text-text-primary tabular-nums">
                  {k === "toolCount" ? String(v) : tokens(v)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 4) 구성 요소. 카드가 알려 주는 것이 하나도 없으면 그렇다고 한 줄로 말한다(빈 제목만 두지 않는다) */}
      <Section title={t("desktop.craft.canvas.cv3.sec.parts")}>
        {s.instructions.length === 0 &&
        s.skills.length === 0 &&
        s.memory.length === 0 &&
        s.mcp === undefined &&
        meta.hooks.length === 0 &&
        (s.steps ?? []).length === 0 &&
        s.settings.length === 0 &&
        meta.recordKinds.length === 0 ? (
          <p className="m-0 text-ui text-text-secondary">
            {t("desktop.craft.canvas.cv9.partsNone")}
          </p>
        ) : null}
        <dl className="m-0">
          {s.instructions.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.instructions")}>
              <span className="cv6-mono">{s.instructions.join(", ")}</span>
            </Row>
          ) : null}
          {s.skills.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.skills")}>
              <span className="cv6-mono">{s.skills.join(", ")}</span>
            </Row>
          ) : null}
          {s.memory.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.memory")}>
              <span className="cv6-mono">{s.memory.join(", ")}</span>
            </Row>
          ) : null}
          {s.mcp !== undefined ? (
            <Row k={t("desktop.craft.canvas.cv3.part.mcp")}>
              <span className="flex items-center gap-2">
                <span className="cv6-mono">{s.mcp.server}</span>
                <span className="text-text-tertiary">
                  {t("desktop.craft.canvas.cv5.cost.tools", { n: s.mcp.tools.length })}
                </span>
              </span>
            </Row>
          ) : null}
          {meta.hooks.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.hooks")}>
              {t("desktop.craft.canvas.cv4.part.hookCount", { n: meta.hooks.length })}
            </Row>
          ) : null}
          {(s.steps ?? []).length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.steps")}>
              {(s.steps ?? []).map((st) => t(STEP_WORD[st.id])).join(" → ")}
            </Row>
          ) : null}
          {s.settings.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.settings")}>
              <span className="cv6-mono">
                {s.settings.map((x) => `${x.key} = ${x.value}`).join(", ")}
              </span>
            </Row>
          ) : null}
          {meta.recordKinds.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.records")}>
              {t("desktop.craft.canvas.cv4.part.recordCount", { n: meta.recordKinds.length })}
            </Row>
          ) : null}
        </dl>
      </Section>

      {/* 5) 권한과 위임: 위험 등급, 코드가 도는 곳, 쓰는 도구, 대체, 실행 명령, 빠진 기능, 핸드오프(넘겨주기·넘겨받기) */}
      <Section
        title={t("desktop.craft.canvas.cv3.sec.trust")}
        aside={
          <span className="flex items-center gap-2">
            <RiskMeter level={RISK_LEVEL[s.risk]} />
            <span>{t(RISK_WORD[s.risk])}</span>
          </span>
        }
      >
        <dl className="m-0">
          <Row k={t("desktop.craft.canvas.cv3.risk.code")}>
            {s.code
              ? t(
                  meta.isolated === true
                    ? "desktop.craft.canvas.cv3.risk.isolated"
                    : "desktop.craft.canvas.cv3.risk.inProcess",
                )
              : t("desktop.craft.canvas.cv3.risk.noCode")}
          </Row>
          {s.mcp !== undefined ? (
            <Row k={t("desktop.craft.canvas.cv3.risk.writeTools")}>
              <span className={writes > 0 ? "text-warning-text" : ""}>
                {t("desktop.craft.canvas.cv3.risk.writeToolsValue", {
                  n: writes,
                  of: s.mcp.tools.length,
                })}
              </span>
            </Row>
          ) : null}
          {meta.launch !== null ? (
            <Row k={t("desktop.craft.canvas.cv3.risk.launch")}>
              <span className="cv6-mono break-all">
                {[meta.launch.command, ...meta.launch.args].join(" ")}
              </span>
              {meta.launch.envNames.length > 0 ? (
                <span className="block text-ui-sm text-text-tertiary">
                  {t("desktop.craft.canvas.cv3.risk.env", {
                    names: meta.launch.envNames.join(", "),
                  })}
                </span>
              ) : null}
            </Row>
          ) : null}
          {meta.replaces.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.rel.replaces")}>
              <span className="text-warning-text">
                {t("desktop.craft.canvas.cv3.risk.replacesValue", {
                  tools: meta.replaces.join(", "),
                })}
              </span>
            </Row>
          ) : null}
          {unmet.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.risk.unmet")}>
              <span className="cv6-mono text-warning-text">
                {unmet.map((n) => n.id).join(", ")}
              </span>
            </Row>
          ) : null}
          {draft ? (
            <Row k={t("desktop.craft.canvas.cv3.review.draft")}>
              <span className="text-warning-text">
                {t("desktop.craft.canvas.cv3.risk.draftAsk")}
              </span>
            </Row>
          ) : null}
          {p.kind === "drive" ? (
            <Row k={t("desktop.craft.canvas.cv3.trust.handoff")}>
              <span className="flex flex-col gap-1">
                {handoffTo.length === 0 && handoffFrom.length === 0 ? (
                  <span className="text-text-tertiary">
                    {t("desktop.craft.canvas.cv3.trust.handoffNone")}
                  </span>
                ) : null}
                {handoffTo.map((to) => (
                  <span key={`to:${to}`} className="flex items-center gap-2">
                    <RelationSwatch kind="handoff" />
                    <span className="text-text-tertiary">
                      {t("desktop.craft.canvas.cv3.relOut.handoff")}
                    </span>
                    <button
                      type="button"
                      data-slot="cv6-button"
                      className="cv6-link"
                      onClick={() => props.actions.focus(to)}
                    >
                      {to}
                    </button>
                  </span>
                ))}
                {handoffFrom.map((from) => (
                  <span key={`from:${from}`} className="flex items-center gap-2">
                    <RelationSwatch kind="handoff" />
                    <span className="text-text-tertiary">
                      {t("desktop.craft.canvas.cv3.relIn.handoff")}
                    </span>
                    <button
                      type="button"
                      data-slot="cv6-button"
                      className="cv6-link"
                      onClick={() => props.actions.focus(from)}
                    >
                      {from}
                    </button>
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
        </dl>
      </Section>

      {/* 6) 출처와 리뷰 */}
      <Section title={t("desktop.craft.canvas.cv3.sec.origin")}>
        <dl className="m-0">
          <Row k={t("desktop.craft.canvas.cv3.meta.package")}>
            <span className="cv6-mono">
              {meta.pkg === p.name ? p.name : `${meta.pkg}/${p.name}`}
            </span>
          </Row>
          <Row k={t("desktop.craft.canvas.cv3.meta.version")}>
            <span className="cv6-mono">
              {draft ? (meta.pending?.version ?? "–") : meta.version}
            </span>
            <span className="cv6-mono ms-2 text-text-tertiary">
              {`sha256:${draft ? (meta.pending?.contentHash ?? "") : (meta.review.currentHash ?? "")}…`}
            </span>
          </Row>
          <Row k={t("desktop.craft.canvas.cv3.meta.review")}>
            {meta.review.approvedAt === null
              ? t(REVIEW_WORD[meta.review.state])
              : t("desktop.craft.canvas.cv3.meta.approvedAt", { at: meta.review.approvedAt })}
          </Row>
          {meta.pending !== null ? (
            <Row k={t("desktop.craft.canvas.cv3.meta.pending")}>
              <span className="text-warning-text">
                {meta.pending.parentVersion === null
                  ? t("desktop.craft.canvas.cv3.meta.pendingNew", { v: meta.pending.version })
                  : t("desktop.craft.canvas.cv3.meta.pendingUpdate", {
                      v: meta.pending.version,
                      from: meta.pending.parentVersion,
                    })}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 text-ui-sm text-text-tertiary">
                <span>
                  {t(
                    meta.pending.provenance === "assistant"
                      ? "desktop.craft.canvas.cv3.meta.byBuilder"
                      : "desktop.craft.canvas.cv3.meta.byUser",
                  )}
                </span>
                <span>{t(meta.pending.label)}</span>
              </span>
            </Row>
          ) : null}
          {meta.createdIn !== null ? (
            <Row k={t("desktop.craft.canvas.cv3.meta.createdIn")}>
              <span className="cv6-mono">{meta.createdIn}</span>
            </Row>
          ) : null}
          {meta.author === null ? null : (
            <Row k={t("desktop.craft.canvas.cv3.meta.author")}>
              {meta.author}
              {meta.license === null ? null : (
                <span className="ms-2 text-text-tertiary">{meta.license}</span>
              )}
            </Row>
          )}
          <Row k={t("desktop.craft.canvas.cv3.meta.usedBy")}>
            {(meta.usedBy !== undefined
              ? meta.usedBy.map((u) => (u === "common" ? t("desktop.craft.canvas.cv3.base") : u))
              : usedByOf(p.name).map((u) =>
                  t(
                    u === "base"
                      ? "desktop.craft.canvas.cv3.base"
                      : u === "dev"
                        ? "desktop.craft.canvas.cv3.profile.dev"
                        : "desktop.craft.canvas.sample.scale",
                  ),
                )
            ).join(", ") || t("desktop.craft.canvas.cv3.meta.usedByNone")}
          </Row>
        </dl>
      </Section>
    </FloatingPanel>
  );
}

// ── 묶음 상세 ─────────────────────────────────────────────────────

export function BundleDetail(props: {
  readonly id: string;
  readonly members: readonly Placed[];
  readonly collapsed: boolean;
  readonly actions: PanelActions;
}): ReactNode {
  const meta = bundleMetaFor(props.id);
  const kinds = [...new Set(props.members.map((m) => m.plugin.kind))];
  const anchors = new Set(props.members.map((m) => m.plugin.anchor).filter((a) => a !== "drive"));
  const head = (
    <Head
      tile={
        <span className="cv6-bundle-tile rounded-lg">
          <PartGlyph name="package" size={18} />
        </span>
      }
      title={meta.displayName}
      aside={props.id}
      sub={
        <>
          <span>{t("desktop.craft.canvas.cv3.bundle.word")}</span>
          <span>{t("desktop.craft.canvas.cv3.bundle.count", { n: props.members.length })}</span>
          <span className="flex items-center gap-1">
            {kinds.map((k) => (
              <span key={k} style={{ color: KIND_COLOR[k] }} className="flex">
                <KindGlyph kind={k} size={12} />
              </span>
            ))}
          </span>
        </>
      }
    />
  );
  const tuck = (
    <Tuck
      chips={
        <>
          <Chip tone="success">{t("desktop.craft.canvas.cv3.review.approved")}</Chip>
          <Chip>{t(ORIGIN_WORD[meta.origin])}</Chip>
          <Chip>{`v${meta.version}`}</Chip>
        </>
      }
    />
  );
  const foot = (
    <>
      <Button size="sm" variant="outline" onClick={() => props.actions.toggleBundle(props.id)}>
        <Icon name={props.collapsed ? "unfold" : "fold"} size={14} />
        {t(
          props.collapsed
            ? "desktop.craft.canvas.cv3.bundle.unfold"
            : "desktop.craft.canvas.cv3.bundle.fold",
        )}
      </Button>
      <span className="ms-auto" />
      <Button size="sm" variant="ghost" onClick={() => props.actions.removeBundle(props.id)}>
        <Icon name="remove" size={14} />
        {t("desktop.craft.canvas.cv3.act.removeBundle")}
      </Button>
    </>
  );
  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cv3.panel.label", { name: meta.displayName })}
      page={`bundle:${props.id}`}
      head={head}
      tuck={tuck}
      foot={foot}
      onClose={() => props.actions.close()}
    >
      <Section title={t("desktop.craft.canvas.cv4.sec.about")}>
        <p className="m-0 text-[15.5px] leading-[22px] font-semibold text-text-primary">
          {t(meta.purpose)}
        </p>
        <p className="m-0 mt-2.5 text-ui-relaxed text-text-secondary">
          {t("desktop.craft.canvas.cv3.bundle.what")}
        </p>
      </Section>
      <Section
        title={t("desktop.craft.canvas.cv3.bundle.members")}
        aside={
          <InfoTip
            text={[
              t("desktop.craft.canvas.cv3.bundle.orderHint"),
              t("desktop.craft.canvas.cv3.bundle.nestHint"),
            ]}
          />
        }
      >
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
          {props.members.map((m, i) => (
            <li key={m.plugin.name}>
              <button
                type="button"
                data-slot="cv6-button"
                className="cv6-member rounded-lg"
                onClick={() => props.actions.focus(m.plugin.name)}
              >
                <span className="w-4 text-ui-sm text-text-tertiary tabular-nums">
                  {String(i + 1)}
                </span>
                <KindTile kind={m.plugin.kind} size={24} />
                <span className="min-w-0 flex-1 text-start">
                  <span className="block truncate text-ui-md text-text-primary">
                    {m.plugin.name}
                  </span>
                  <span className="block truncate text-ui-sm text-text-tertiary">
                    {purposeOf(m.plugin.meta)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={t("desktop.craft.canvas.cv3.bundle.folding")}>
        <p className="m-0 text-ui-relaxed text-text-secondary">
          {t("desktop.craft.canvas.cv3.bundle.foldingText", { n: anchors.size })}
        </p>
      </Section>
      <Section title={t("desktop.craft.canvas.cv3.sec.origin")}>
        <dl className="m-0">
          <Row k={t("desktop.craft.canvas.cv3.meta.version")}>
            <span className="cv6-mono">{meta.version}</span>
            <span className="cv6-mono ms-2 text-text-tertiary">{`sha256:${meta.hash}…`}</span>
          </Row>
          <Row k={t("desktop.craft.canvas.cv3.meta.author")}>{meta.author}</Row>
          <Row k={t("desktop.craft.canvas.cv3.meta.origin")}>{t(ORIGIN_WORD[meta.origin])}</Row>
        </dl>
      </Section>
    </FloatingPanel>
  );
}

export function BuilderDetail(props: {
  readonly created: readonly string[];
  readonly actions: PanelActions;
}): ReactNode {
  const head = (
    <Head
      tile={
        <span className="cv6-bundle-tile rounded-lg">
          <PartGlyph name="builder" size={18} />
        </span>
      }
      title={t("desktop.craft.canvas.cv3.builder.name")}
      sub={<span>{t("desktop.craft.canvas.cv3.builder.where")}</span>}
    />
  );
  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cv3.builder.name")}
      page="builder"
      head={head}
      foot={null}
      onClose={() => props.actions.close()}
    >
      <Section title={t("desktop.craft.canvas.cv4.sec.about")}>
        <p className="m-0 text-ui-relaxed text-text-primary">
          {t("desktop.craft.canvas.cv3.builder.what")}
        </p>
      </Section>
      <Section title={t("desktop.craft.canvas.cv3.builder.made")}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {props.created.map((n) => (
            <li key={n} className="flex items-center gap-2 text-ui">
              <RelationSwatch kind="creates" />
              <button
                type="button"
                data-slot="cv6-button"
                className="cv6-link"
                onClick={() => props.actions.focus(n)}
              >
                {n}
              </button>
              <span className="ms-auto text-text-tertiary">
                {t("desktop.craft.canvas.cv3.review.draft")}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </FloatingPanel>
  );
}

// ── 블록 상세: Hook 자리 하나 ───────────────────────────────────────

/** 블록 상세가 그릴 순서의 출처: 엔진이 적용한 순서(`blocks.applied`), 읽는 중, 표본(캔버스 순서) */
export type PointOrder =
  | { readonly type: "engine"; readonly hooks: readonly PointHook[] }
  /** 엔진의 적용 블록에 이 자리의 Hook이 없다(대화 경계 같은 블록 밖 자리). 프로필 순서를 보인다 */
  | { readonly type: "unreported" }
  | { readonly type: "loading" }
  | { readonly type: "sample" };

const ISSUE_WORD: Partial<Record<ProfileIssue["code"], MessageId>> = {
  replace_conflict: "desktop.craft.canvas.cv9.issue.replace",
  dependency_missing: "desktop.craft.canvas.cv9.issue.dependency",
  dependency_disabled: "desktop.craft.canvas.cv9.issue.dependency",
  dependency_range: "desktop.craft.canvas.cv9.issue.dependency",
  plugin_not_reviewed: "desktop.craft.canvas.cv9.issue.notReviewed",
};

function issueText(issue: ProfileIssue): string {
  const word = ISSUE_WORD[issue.code] ?? "desktop.craft.canvas.cv9.issue.other";
  return t(word, {
    plugin: issue.plugin ?? "",
    other: issue.other ?? "",
    tool: issue.tool ?? "",
  });
}

/** 순서 한 줄: 번호, 종류 타일, 이름, 넣은 곳, 같은 자리 안에서 앞·뒤로 */
function OrderRow(props: {
  readonly n: number;
  readonly name: string;
  readonly profile: CanvasProfile;
  /** 같은 Hook 차례의 바로 앞, 바로 뒤 이름 */
  readonly prev: string | null;
  readonly next: string | null;
  readonly busy: boolean;
  readonly actions: PanelActions;
}): ReactElement {
  const p = pluginOf(props.name);
  const base = props.profile.base.includes(props.name);
  const fixed = orderFixed(props.name);
  const movable = p !== undefined && !base && !fixed && inProfile(props.profile, props.name);
  const can = (other: string | null): other is string =>
    other !== null && swapPlugins(props.profile, props.name, other) !== props.profile;
  return (
    <li className="flex min-h-9 items-center gap-2.5" data-point-row={props.name}>
      <span className="w-5 shrink-0 text-end text-ui-sm text-text-tertiary tabular-nums">
        {String(props.n)}
      </span>
      <KindTile kind={p?.kind ?? "hook"} size={18} />
      <button
        type="button"
        data-slot="cv6-button"
        className="min-w-0 truncate text-start text-ui text-text-primary"
        disabled={p === undefined}
        onClick={() => props.actions.focus(props.name)}
      >
        {props.name}
      </button>
      {base ? <Chip>{t("desktop.craft.canvas.cv3.base")}</Chip> : null}
      {p === undefined ? <Chip>{t("desktop.craft.canvas.cv9.point.engine")}</Chip> : null}
      {fixed ? <Chip>{t("desktop.craft.canvas.cv9.lock.chip")}</Chip> : null}
      {movable ? (
        <span className="ms-auto flex items-center">
          <IconButton
            size="xs"
            variant="ghost"
            disabled={props.busy || !can(props.prev)}
            label={t("desktop.craft.canvas.cv9.point.earlier", { name: props.name })}
            onClick={() => {
              if (can(props.prev)) props.actions.swap(props.name, props.prev);
            }}
          >
            <Icon name="up" size={14} />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            disabled={props.busy || !can(props.next)}
            label={t("desktop.craft.canvas.cv9.point.later", { name: props.name })}
            onClick={() => {
              if (can(props.next)) props.actions.swap(props.name, props.next);
            }}
          >
            <Icon name="down" size={14} />
          </IconButton>
        </span>
      ) : null}
    </li>
  );
}

/**
 * 블록 상세(C4, craft-flows §6.11): Hook 자리 하나에 붙은 플러그인과 그 순서, 걸린 충돌. 묻는 것은 하나다: "이 자리에서 무엇이 어떤 차례로 도나".
 * 순서는 엔진이 적용한 디스패치 순서(`blocks.applied`)를 그대로 보이고, 앞·뒤 단추는 프로필 순서를 바꿔 저장한다(저장 뒤 다시 읽는다).
 * 공통 묶음과 엔진 부품은 프로필에서 옮길 수 없어 단추가 없다
 */
export function PointDetail(props: {
  readonly anchor: Anchor;
  readonly profile: CanvasProfile;
  readonly order: PointOrder;
  readonly issues: readonly ProfileIssue[];
  readonly saving: boolean;
  readonly actions: PanelActions;
}): ReactNode {
  const placed = placedOf(props.profile).filter((x) => x.plugin.anchor === props.anchor);
  const groups: readonly PointHook[] =
    props.order.type === "engine"
      ? props.order.hooks
      : [
          {
            hook: "",
            // 엔진이 늘 먼저 싣는 것(`orderFixed`)이 앞에 선다. 나머지는 프로필 순서다
            plugins: [
              ...placed.filter((x) => orderFixed(x.plugin.name)),
              ...placed.filter((x) => !orderFixed(x.plugin.name)),
            ].map((x) => x.plugin.name),
          },
        ];
  const count = new Set(groups.flatMap((g) => g.plugins)).size;
  const head = (
    <Head
      tile={<KindTile kind="hook" size={32} />}
      title={t(anchorWord(props.anchor))}
      sub={
        <>
          <span className="font-medium" style={{ color: KIND_COLOR.hook }}>
            {t("desktop.craft.canvas.cv9.point.kind")}
          </span>
          <span className="tabular-nums">
            {t("desktop.craft.canvas.cv9.point.count", { n: count })}
          </span>
        </>
      }
    />
  );
  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cv9.point.label", { at: t(anchorWord(props.anchor)) })}
      page={props.anchor}
      head={head}
      foot={null}
      onClose={() => props.actions.close()}
    >
      <Section
        title={t("desktop.craft.canvas.cv9.point.order")}
        aside={
          props.saving || props.order.type === "loading" ? (
            <>
              <ProgressOrb />
              <span>
                {t(
                  props.saving
                    ? "desktop.craft.canvas.cv9.point.saving"
                    : "desktop.craft.canvas.cv9.point.reading",
                )}
              </span>
            </>
          ) : undefined
        }
      >
        <p className="m-0 mb-3 text-ui-sm text-text-tertiary">
          {t(
            props.order.type === "engine"
              ? "desktop.craft.canvas.cv9.point.fromEngine"
              : props.order.type === "unreported"
                ? "desktop.craft.canvas.cv9.point.unreported"
                : "desktop.craft.canvas.cv9.point.fromProfile",
          )}
        </p>
        {count === 0 ? (
          <p className="m-0 text-ui text-text-secondary">
            {t("desktop.craft.canvas.cv9.point.none")}
          </p>
        ) : (
          <div className="grid gap-3">
            {groups.map((g) => (
              <div key={g.hook} className="grid gap-1">
                {g.hook === "" || groups.length < 2 ? null : (
                  <span className="cv6-mono text-ui-sm text-text-tertiary">{g.hook}</span>
                )}
                <ol className="m-0 grid list-none gap-0.5 p-0">
                  {g.plugins.map((name, i) => (
                    <OrderRow
                      key={name}
                      n={i + 1}
                      name={name}
                      prev={g.plugins[i - 1] ?? null}
                      next={g.plugins[i + 1] ?? null}
                      profile={props.profile}
                      busy={props.saving}
                      actions={props.actions}
                    />
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t("desktop.craft.canvas.cv9.point.conflicts")}>
        {props.issues.length === 0 ? (
          <p className="m-0 flex items-center gap-2 text-ui text-text-secondary">
            <span aria-hidden="true" className="cv6-orb" data-tone="ok" />
            {t("desktop.craft.canvas.cv9.point.noConflict")}
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {props.issues.map((issue) => (
              <li
                key={`${issue.code}:${issue.plugin ?? ""}:${issue.other ?? ""}:${issue.tool ?? ""}`}
                className="flex items-center gap-2 text-ui text-text-primary"
              >
                <span
                  aria-hidden="true"
                  className="cv6-orb"
                  data-tone={issue.severity === "error" ? "danger" : "warn"}
                />
                <span className="min-w-0">{issueText(issue)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </FloatingPanel>
  );
}
