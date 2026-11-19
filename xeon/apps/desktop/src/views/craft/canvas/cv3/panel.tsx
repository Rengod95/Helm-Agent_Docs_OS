// cv3 플로팅 상세: 캔버스 위 맨 위 층에 뜬 판. 면은 받은 요청 카드(approval-card)를 바탕으로 한다. 캔버스를 밀어내지 않고 머리를 끌어 옮긴다.
// 머리: 타일·이름·종류·자리·버전, 칩 줄(리뷰·넣은 곳·스타트·출처·강제), 맨 아래 최근 사용과 상태.
// 본문 순서(사용자 2026-11-19): 1) 설명과 동작 2) 비용 3) 구성 요소 4) 권한과 위임 5) 작동 6) 출처와 리뷰. 아래 줄: 내부 보기·테스트 런·빼기.
// 값은 계약에 있는 필드만 쓴다(표본 `shared-sample.ts`·`shared-meta.ts` + `sample-ext.ts`의 `description`, 계약의 `HOOKS`·`HOOK_POSITIONS`).
import { t } from "@fresnel/client/i18n";
import { badgeVariants, Button, IconButton } from "@caustic/react";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { InfoTip } from "../../info-tip.tsx";
import { agoText } from "../shared-sample.ts";
import { Icon, KIND_COLOR, KindGlyph, KindTile, PartGlyph, type PartIcon } from "./glyphs.tsx";
import { FOLD_WORD, hookRows, pluginFacts, type Fact } from "./facts.ts";
import { RELATION_DASH } from "./layout.ts";
import { descriptionOf } from "./sample-ext.ts";
import {
  BUILDER,
  canNudge,
  inProfile,
  placedOf,
  pluginOf,
  providerOf,
  relationsOf,
  type CanvasProfile,
  type Placed,
  type Plugin,
  type RelationKind,
} from "./model.ts";
import { bundleMetaOf, usedByOf } from "../shared-meta.ts";
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
  setStart(name: string): void;
  toggleBundle(id: string): void;
  removeBundle(id: string): void;
  testRun(name: string): void;
}

/**
 * 떠 있는 판. 면은 받은 요청 카드와 같다(surface.base, border.subtle 1px, rounded-xl, 안쪽 16). 머리를 끌어 옮기고 두 번 누르면 제자리.
 * 머리: 위 줄(타일 32 + 제목 + 곁 줄), 그 아래 칩 줄(타일 왼쪽 끝에서 시작), 맨 아래 최근 사용 줄. 본문은 섹션마다 선으로 가른다.
 */
function FloatingPanel(props: {
  readonly children: ReactNode;
  readonly label: string;
  readonly head: ReactNode;
  readonly foot: ReactNode;
  readonly onClose: () => void;
}): ReactElement {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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
      className="cv3-float absolute z-30 flex flex-col rounded-xl text-ui text-text-primary"
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
        className="cv3-float-head relative cursor-grab px-4 pt-4 pb-1 active:cursor-grabbing"
        onPointerDown={startDrag}
        onDoubleClick={() => {
          setPos(null);
        }}
        title={t("desktop.craft.canvas.cv3.panel.move")}
      >
        {props.head}
        <span className="absolute top-3 right-3">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4">{props.children}</div>
      {props.foot === null ? null : (
        <footer className="cv3-float-foot flex flex-wrap items-center gap-1.5 px-4 py-3">
          {props.foot}
        </footer>
      )}
    </section>
  );
}

/** 머리: 위 줄(타일·제목·곁 줄), 칩 줄(타일 왼쪽 끝에서), 최근 사용 줄 */
function Head(props: {
  readonly tile: ReactNode;
  readonly title: string;
  readonly aside?: string;
  readonly sub: ReactNode;
  readonly chips?: ReactNode;
  readonly foot?: ReactNode;
}): ReactElement {
  return (
    <div className="pe-8">
      <div className="flex min-w-0 items-start gap-3">
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
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ui-sm text-text-tertiary">
            {props.sub}
          </div>
        </div>
      </div>
      {props.chips === undefined ? null : (
        <div className="mt-3.5 flex flex-wrap gap-1">{props.chips}</div>
      )}
      {props.foot === undefined ? null : (
        <div className="mt-3 flex min-w-0 items-center gap-1.5 text-ui-sm text-text-tertiary">
          {props.foot}
        </div>
      )}
    </div>
  );
}

/** 본문 섹션: 제목은 14/600 primary(아이콘 16 secondary), 섹션 사이에 선 */
function Section(props: {
  readonly title: string;
  readonly icon: PartIcon;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="cv3-sec py-3.5">
      <h3 className="m-0 mb-2.5 flex items-center gap-2 text-[14px] leading-5 font-semibold text-text-primary">
        <span className="text-text-secondary">
          <PartGlyph name={props.icon} size={16} />
        </span>
        <span>{props.title}</span>
        {props.aside === undefined ? null : (
          <span className="ms-auto flex items-center text-ui-sm font-normal text-text-secondary">
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
  return <span className={`cv3-pill cv3-pill-${props.tone ?? "plain"}`}>{props.children}</span>;
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

/** 관계 종류의 선 견본(캔버스와 같은 문법) */
export function RelationSwatch(props: { readonly kind: RelationKind }): ReactElement {
  return (
    <svg width={28} height={10} aria-hidden="true" className="shrink-0">
      <line
        x1={1}
        x2={27}
        y1={5}
        y2={5}
        className={`cv3-rel cv3-rel-${props.kind} cv3-rel-on`}
        strokeDasharray={RELATION_DASH[props.kind] === "" ? undefined : RELATION_DASH[props.kind]}
      />
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
    <div className="cv3-well px-3 py-3">
      <svg viewBox="0 0 400 96" className="w-full" aria-hidden="true">
        <line x1={10} x2={390} y1={30} y2={30} className="cv3-mini-rail" />
        <rect
          x={before ? 214 : 70}
          y={16}
          width={130}
          height={28}
          rx={7}
          className="cv3-mini-block"
        />
        <text x={before ? 279 : 135} y={34} textAnchor="middle" className="cv3-mini-label">
          {block === null
            ? t("desktop.craft.canvas.cv3.boundary.end")
            : t(BLOCK_WORD[block === "model" ? "model" : block === "tools" ? "tools" : "context"])}
        </text>
        <g style={{ color }}>
          <path d={`M${before ? 190 : 224} 18 l9 12 l-9 12 l-9 -12 Z`} className="cv3-mini-gate" />
          <path d={`M${before ? 190 : 224} 44 V62`} className="cv3-mini-branch" />
          <path
            d={`M${before ? 190 : 224} 62 H${before ? 150 : 270}`}
            className="cv3-mini-branch"
          />
          <path
            d={`M${before ? 190 : 224} 62 H${before ? 230 : 330}`}
            className="cv3-mini-branch cv3-mini-branch-pass"
          />
        </g>
        <text
          x={before ? 146 : 274}
          y={82}
          textAnchor={before ? "end" : "start"}
          className="cv3-mini-out"
          style={{ fill: color }}
        >
          {decision === undefined ? "" : t(DECISION_WORD[decision])}
        </text>
        <text x={before ? 234 : 334} y={82} className="cv3-mini-label">
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
    <div className="cv3-well flex flex-col gap-2 px-3 py-3">
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
              className="cv3-step"
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
            <span className="cv3-mono text-text-secondary">{h}</span>
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
                lanes: (s.lanes ?? []).map((l) => t(LANE_WORD[l])).join(" · "),
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
    <div className="cv3-well px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-text-secondary">
        <PartGlyph name="mcp" size={14} />
        <span className="cv3-mono">{props.p.shared.mcp?.server ?? props.p.name}</span>
        <span className="text-text-tertiary">
          {t("desktop.craft.canvas.cv3.summary.tool", {
            server: "",
            n: tools.length,
            w: tools.filter((x) => x.writes).length,
          }).trim()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {tools.map((x) => (
          <span key={x.name} className="cv3-tool-chip" data-writes={x.writes ? "" : undefined}>
            <span className="cv3-mono truncate">{x.name}</span>
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
    <div className="cv3-well flex flex-col gap-2 px-3 py-3 text-[12.5px]">
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
              <span key={k} className="cv3-chip">
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
            data-slot="cv3-button"
            className="cv3-link"
            onClick={() => props.actions.focus(other)}
          >
            {otherName}
          </button>
        ) : (
          <span className="text-text-primary">{otherName}</span>
        )}
        {r.label !== "" && r.kind !== "replaces" ? (
          <span className="cv3-mono ms-auto truncate text-[11.5px] text-text-tertiary">
            {r.label}
          </span>
        ) : null}
      </li>,
    );
  }
  // 엔진이 주는 기능, 아무도 주지 않는 기능
  for (const need of [...p.meta.requires, ...p.meta.optional]) {
    const prov = providerOf(profile, need.id);
    if (prov.type === "plugin") continue;
    const optional = p.meta.optional.includes(need);
    rows.push(
      <li key={`cap:${need.id}`} className="flex items-center gap-2 py-1 text-[13px]">
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
            prov.type === "none" ? "text-[var(--cs-color-warning-text)]" : "text-text-secondary"
          }
        >
          {t(
            prov.type === "engine"
              ? "desktop.craft.canvas.cv3.rel.engine"
              : "desktop.craft.canvas.cv3.rel.unmet",
          )}
        </span>
        <span className="cv3-mono ms-auto truncate text-[11.5px] text-text-tertiary">
          {need.id}
        </span>
      </li>,
    );
  }
  const source = props.placed?.source;
  if (source?.type === "bundle") {
    const meta = bundleMetaOf(source.id);
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
          data-slot="cv3-button"
          className="cv3-link"
          onClick={() => props.actions.focus(`bundle:${source.id}`)}
        >
          {meta.displayName}
        </button>
        <span className="cv3-mono ms-auto truncate text-[11.5px] text-text-tertiary">{`${source.id}/${p.name}`}</span>
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
          className="cv3-risk-seg"
          data-on={i <= props.level ? "" : undefined}
          data-high={props.level >= 3 ? "" : undefined}
        />
      ))}
    </span>
  );
}

/** 설명과 동작의 네 줄 하나: 왼쪽 세로 선 위의 점(그림) + 줄 이름 + 값 칩들 */
function FlowStep(props: {
  readonly icon: PartIcon;
  readonly label: string;
  readonly facts: readonly Fact[];
}): ReactNode {
  if (props.facts.length === 0) return null;
  return (
    <li className="flex items-start gap-2.5 py-1">
      <span className="cv3-flow-dot shrink-0" aria-hidden="true">
        <PartGlyph name={props.icon} size={13} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-ui-sm text-text-tertiary">{props.label}</div>
        <div className="flex flex-wrap gap-1">
          {props.facts.map((f, i) => (
            <span
              key={`${f.word}:${f.value ?? ""}:${String(i)}`}
              className="cv3-fact"
              data-warn={f.warn ? "" : undefined}
            >
              <span>{t(f.at === null ? f.word : anchorWord(f.at))}</span>
              {f.value === null ? null : <span className="cv3-fact-value">{f.value}</span>}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

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
  const hooks = hookRows(p);
  const description = descriptionOf(p.name);
  const sourceWord =
    placed === undefined
      ? t("desktop.craft.canvas.cv3.source.out")
      : placed.source.type === "base"
        ? t("desktop.craft.canvas.cv3.base")
        : placed.source.type === "bundle"
          ? t("desktop.craft.canvas.cv3.source.bundle", {
              name: bundleMetaOf(placed.source.id).displayName,
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
          <span aria-hidden="true">·</span>
          <span>{t(anchorWord(p.anchor))}</span>
          <span aria-hidden="true">·</span>
          <span className="cv3-mono">{`v${draft ? (meta.pending?.version ?? meta.version) : meta.version}`}</span>
        </>
      }
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
        </>
      }
      foot={
        <>
          <PartGlyph name="clock" size={13} />
          <span>
            {t("desktop.craft.canvas.cv3.meta.lastUsedLine", { ago: agoText(s.lastUsedMin) })}
          </span>
          <span aria-hidden="true">·</span>
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
      head={head}
      foot={foot}
      onClose={() => props.actions.close()}
    >
      {/* 1) 설명과 동작: 무엇인가(목적·설명), 어떻게 도는가(언제 → 읽고 → 바꾸고 → 낸다) */}
      <Section title={t("desktop.craft.canvas.cv3.sec.about")} icon="instruction">
        <p className="m-0 text-[14.5px] leading-[21px] font-medium text-text-primary">
          {t(meta.purpose)}
        </p>
        {description === null ? null : (
          <p className="m-0 mt-1.5 text-ui-relaxed text-text-secondary">{t(description)}</p>
        )}
        <ol className="cv3-flow-steps m-0 mt-3 flex list-none flex-col p-0">
          <FlowStep
            icon="clock"
            label={t("desktop.craft.canvas.cv3.fact.whenLabel")}
            facts={facts.when}
          />
          <FlowStep
            icon="record"
            label={t("desktop.craft.canvas.cv3.fact.readsLabel")}
            facts={facts.reads}
          />
          <FlowStep
            icon="setting"
            label={t("desktop.craft.canvas.cv3.fact.changesLabel")}
            facts={facts.changes}
          />
          <FlowStep
            icon="capability"
            label={t("desktop.craft.canvas.cv3.fact.givesLabel")}
            facts={facts.gives}
          />
        </ol>
      </Section>

      {/* 2) 비용 */}
      <Section
        title={t("desktop.craft.canvas.cv3.sec.cost")}
        icon="hash"
        aside={<InfoTip text={t("desktop.craft.canvas.cv3.cost.hint")} />}
      >
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ["always", meta.cost.always],
              ["drive", meta.cost.drive],
              ["onDemand", meta.cost.onDemand],
              ["toolCount", meta.cost.toolCount],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="cv3-stat">
              <span className="text-[11px] text-text-tertiary">
                {t(`desktop.craft.canvas.cv3.cost.${k}` as const)}
              </span>
              <span
                className={`text-[15px] tabular-nums ${v === null ? "text-text-tertiary" : "text-text-primary"}`}
              >
                {v === null ? "–" : k === "toolCount" ? String(v) : tokens(v)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* 3) 구성 요소 */}
      <Section title={t("desktop.craft.canvas.cv3.sec.parts")} icon="package">
        <dl className="m-0">
          {s.instructions.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.instructions")}>
              <span className="cv3-mono">{s.instructions.join(", ")}</span>
            </Row>
          ) : null}
          {s.skills.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.skills")}>
              <span className="cv3-mono">{s.skills.join(", ")}</span>
            </Row>
          ) : null}
          {s.memory.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.memory")}>
              <span className="cv3-mono">{s.memory.join(", ")}</span>
            </Row>
          ) : null}
          {s.mcp !== undefined ? (
            <Row k={t("desktop.craft.canvas.cv3.part.mcp")}>
              <span className="cv3-mono">{`${s.mcp.server} · ${String(s.mcp.tools.length)}`}</span>
            </Row>
          ) : null}
          {meta.hooks.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.hooks")}>
              <span className="cv3-mono">{meta.hooks.join(", ")}</span>
            </Row>
          ) : null}
          {(s.steps ?? []).length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.steps")}>
              {(s.steps ?? []).map((st) => t(STEP_WORD[st.id])).join(" → ")}
            </Row>
          ) : null}
          {s.settings.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.settings")}>
              <span className="cv3-mono">
                {s.settings.map((x) => `${x.key} = ${x.value}`).join(", ")}
              </span>
            </Row>
          ) : null}
          {meta.recordKinds.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cv3.part.records")}>
              <span className="cv3-mono">{meta.recordKinds.join(", ")}</span>
            </Row>
          ) : null}
        </dl>
      </Section>

      {/* 4) 권한과 위임: 위험 등급, 코드가 도는 곳, 쓰는 도구, 대체, 실행 명령, 빠진 기능, 핸드오프(넘겨주기·넘겨받기) */}
      <Section
        title={t("desktop.craft.canvas.cv3.sec.trust")}
        icon="permission"
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
              <span className="cv3-mono break-all">
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
              <span className="cv3-mono text-warning-text">
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
                      data-slot="cv3-button"
                      className="cv3-link"
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
                      data-slot="cv3-button"
                      className="cv3-link"
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

      {/* 5) 작동: 루프 위 자리 그림, 같은 자리 순서, Hook마다 합치는 방식, 다른 플러그인과의 관계(핸드오프는 4에) */}
      <Section
        title={t("desktop.craft.canvas.cv3.sec.works")}
        icon="stage"
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
        <dl className="m-0 mt-2.5">
          {siblings.length > 1 ? (
            <Row k={t("desktop.craft.canvas.cv3.works.sameSpot")}>
              <span className="flex w-full flex-wrap items-center gap-1">
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
              </span>
            </Row>
          ) : null}
          {hooks.map((h) => (
            <Row
              key={h.hook}
              k={
                h.anchor === null
                  ? t("desktop.craft.canvas.cv3.works.event")
                  : t(anchorWord(h.anchor))
              }
            >
              <span className="cv3-mono">{h.hook}</span>
              <span className="block text-ui-sm text-text-tertiary">{t(FOLD_WORD[h.fold])}</span>
            </Row>
          ))}
        </dl>
        <div className="mt-2">
          <RelationRows
            p={p}
            profile={props.profile}
            placed={placed}
            actions={props.actions}
            skip="handoff"
          />
        </div>
      </Section>

      {/* 6) 출처와 리뷰 */}
      <Section title={t("desktop.craft.canvas.cv3.sec.origin")} icon="hash">
        <dl className="m-0">
          <Row k={t("desktop.craft.canvas.cv3.meta.package")}>
            <span className="cv3-mono">
              {meta.pkg === p.name ? p.name : `${meta.pkg}/${p.name}`}
            </span>
          </Row>
          <Row k={t("desktop.craft.canvas.cv3.meta.version")}>
            <span className="cv3-mono">
              {draft ? (meta.pending?.version ?? "–") : meta.version}
            </span>
            <span className="cv3-mono ms-2 text-text-tertiary">
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
              <span className="block text-ui-sm text-text-tertiary">
                {t(
                  meta.pending.provenance === "assistant"
                    ? "desktop.craft.canvas.cv3.meta.byBuilder"
                    : "desktop.craft.canvas.cv3.meta.byUser",
                )}
                {" · "}
                {t(meta.pending.label)}
              </span>
            </Row>
          ) : null}
          {meta.createdIn !== null ? (
            <Row k={t("desktop.craft.canvas.cv3.meta.createdIn")}>
              <span className="cv3-mono">{meta.createdIn}</span>
            </Row>
          ) : null}
          <Row k={t("desktop.craft.canvas.cv3.meta.author")}>
            {meta.author}
            {meta.license === null ? null : (
              <span className="ms-2 text-text-tertiary">{meta.license}</span>
            )}
          </Row>
          <Row k={t("desktop.craft.canvas.cv3.meta.usedBy")}>
            {usedByOf(p.name)
              .map((u) =>
                t(
                  u === "base"
                    ? "desktop.craft.canvas.cv3.base"
                    : u === "dev"
                      ? "desktop.craft.canvas.cv3.profile.dev"
                      : "desktop.craft.canvas.sample.scale",
                ),
              )
              .join(", ") || t("desktop.craft.canvas.cv3.meta.usedByNone")}
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
  const meta = bundleMetaOf(props.id);
  const kinds = [...new Set(props.members.map((m) => m.plugin.kind))];
  const anchors = new Set(props.members.map((m) => m.plugin.anchor).filter((a) => a !== "drive"));
  const head = (
    <Head
      tile={
        <span className="cv3-bundle-tile rounded-lg">
          <PartGlyph name="package" size={18} />
        </span>
      }
      title={meta.displayName}
      aside={props.id}
      sub={
        <>
          <span>{t("desktop.craft.canvas.cv3.bundle.word")}</span>
          <span aria-hidden="true">·</span>
          <span>{t("desktop.craft.canvas.cv3.bundle.count", { n: props.members.length })}</span>
          {kinds.map((k) => (
            <span key={k} style={{ color: KIND_COLOR[k] }} className="flex">
              <KindGlyph kind={k} size={12} />
            </span>
          ))}
        </>
      }
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
      head={head}
      foot={foot}
      onClose={() => props.actions.close()}
    >
      <Section title={t("desktop.craft.canvas.cv3.sec.about")} icon="instruction">
        <p className="m-0 text-[14.5px] leading-[21px] font-medium text-text-primary">
          {t(meta.purpose)}
        </p>
        <p className="m-0 mt-1.5 text-ui-relaxed text-text-secondary">
          {t("desktop.craft.canvas.cv3.bundle.what")}
        </p>
      </Section>
      <Section
        title={t("desktop.craft.canvas.cv3.bundle.members")}
        icon="package"
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
                data-slot="cv3-button"
                className="cv3-member rounded-lg"
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
                    {t(m.plugin.meta.purpose)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={t("desktop.craft.canvas.cv3.bundle.folding")} icon="stage">
        <p className="m-0 text-ui-relaxed text-text-secondary">
          {t("desktop.craft.canvas.cv3.bundle.foldingText", { n: anchors.size })}
        </p>
      </Section>
      <Section title={t("desktop.craft.canvas.cv3.sec.origin")} icon="hash">
        <dl className="m-0">
          <Row k={t("desktop.craft.canvas.cv3.meta.version")}>
            <span className="cv3-mono">{meta.version}</span>
            <span className="cv3-mono ms-2 text-text-tertiary">{`sha256:${meta.hash}…`}</span>
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
        <span className="cv3-bundle-tile rounded-lg">
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
      head={head}
      foot={null}
      onClose={() => props.actions.close()}
    >
      <Section title={t("desktop.craft.canvas.cv3.sec.about")} icon="instruction">
        <p className="m-0 text-ui-relaxed text-text-primary">
          {t("desktop.craft.canvas.cv3.builder.what")}
        </p>
      </Section>
      <Section title={t("desktop.craft.canvas.cv3.builder.made")} icon="builder">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {props.created.map((n) => (
            <li key={n} className="flex items-center gap-2 text-ui">
              <RelationSwatch kind="creates" />
              <button
                type="button"
                data-slot="cv3-button"
                className="cv3-link"
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
