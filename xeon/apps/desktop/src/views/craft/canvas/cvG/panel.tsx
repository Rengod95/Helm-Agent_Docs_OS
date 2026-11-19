// cvG 플로팅 상세: 캔버스 위 맨 위 층에 뜬 큰 판. 캔버스를 밀어내지 않고, 머리를 끌어 옮길 수 있다(두 번 누르면 제자리).
// 플러그인이면 하는 일, 종류와 붙는 자리, 작동(종류마다 작은 그림), 구성 요소, 권한과 위험, 비용, 관계, 출처·버전·해시·리뷰, 최근 사용, 할 수 있는 일.
// 값은 계약에 있는 필드만 쓴다(표본 `shared-sample.ts` + `sample-ext.ts`).
import { t } from "@fresnel/client/i18n";
import { Button } from "@caustic/react";
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
import { RELATION_DASH } from "./layout.ts";
import {
  BUILDER,
  canNudge,
  inProfile,
  pluginOf,
  providerOf,
  relationsOf,
  type CanvasProfile,
  type Placed,
  type Plugin,
  type RelationKind,
} from "./model.ts";
import { bundleMetaOf, usedByOf } from "./sample-ext.ts";
import {
  anchorWord,
  BLOCK_WORD,
  DECISION_WORD,
  HEALTH_WORD,
  KIND_DOES,
  KIND_WORD,
  LANE_WORD,
  ORIGIN_WORD,
  REVIEW_WORD,
  RISK_LEVEL,
  RISK_WORD,
  STEP_WORD,
  tokens,
} from "./words.ts";

export const PANEL_W = 460;
const DOCK = { right: 16, top: 60 } as const;

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

/** 머리를 끌어 옮기는 떠 있는 판의 자리. null이면 오른쪽 위에 붙어 있다 */
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
      className="cvg-float absolute z-30 flex flex-col"
      style={
        pos === null
          ? {
              right: DOCK.right,
              top: DOCK.top,
              width: PANEL_W,
              maxHeight: `calc(100% - ${String(DOCK.top + 16)}px)`,
            }
          : {
              left: pos.x,
              top: pos.y,
              width: PANEL_W,
              maxHeight: `calc(100% - ${String(pos.y + 16)}px)`,
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
        className="cvg-float-head flex cursor-grab items-start gap-3 px-5 pt-4 pb-3 active:cursor-grabbing"
        onPointerDown={startDrag}
        onDoubleClick={() => {
          setPos(null);
        }}
        title={t("desktop.craft.canvas.cvG.panel.move")}
      >
        <div className="min-w-0 flex-1">{props.head}</div>
        <button
          type="button"
          className="cvg-icon-btn -me-1.5"
          aria-label={t("desktop.craft.canvas.cvG.panel.close")}
          onClick={props.onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{props.children}</div>
      <footer className="cvg-float-foot flex flex-wrap items-center gap-1.5 px-5 py-3">
        {props.foot}
      </footer>
    </section>
  );
}

function Section(props: {
  readonly title: string;
  readonly icon: PartIcon;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="cvg-sec mt-4 first:mt-1">
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-text-tertiary">
        <PartGlyph name={props.icon} size={13} />
        <span>{props.title}</span>
        {props.aside === undefined ? null : (
          <span className="ms-auto font-normal">{props.aside}</span>
        )}
      </h3>
      {props.children}
    </section>
  );
}

function Row(props: { readonly k: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-7 items-baseline gap-3 py-0.5 text-[13px]">
      <dt className="w-24 shrink-0 text-text-tertiary">{props.k}</dt>
      <dd className="min-w-0 flex-1 text-text-primary">{props.children}</dd>
    </div>
  );
}

function Pill(props: {
  readonly tone?: "plain" | "warn" | "ok";
  readonly children: ReactNode;
}): ReactElement {
  return <span className={`cvg-pill cvg-pill-${props.tone ?? "plain"}`}>{props.children}</span>;
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
        className={`cvg-rel cvg-rel-${props.kind} cvg-rel-on`}
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
    <div className="cvg-well px-3 py-3">
      <svg viewBox="0 0 400 96" className="w-full" aria-hidden="true">
        <line x1={10} x2={390} y1={30} y2={30} className="cvg-mini-rail" />
        <rect
          x={before ? 214 : 70}
          y={16}
          width={130}
          height={28}
          rx={7}
          className="cvg-mini-block"
        />
        <text x={before ? 279 : 135} y={34} textAnchor="middle" className="cvg-mini-label">
          {block === null
            ? t("desktop.craft.canvas.cvG.boundary.end")
            : t(BLOCK_WORD[block === "model" ? "model" : block === "tools" ? "tools" : "context"])}
        </text>
        <g style={{ color }}>
          <path d={`M${before ? 190 : 224} 18 l9 12 l-9 12 l-9 -12 Z`} className="cvg-mini-gate" />
          <path d={`M${before ? 190 : 224} 44 V62`} className="cvg-mini-branch" />
          <path
            d={`M${before ? 190 : 224} 62 H${before ? 150 : 270}`}
            className="cvg-mini-branch"
          />
          <path
            d={`M${before ? 190 : 224} 62 H${before ? 230 : 330}`}
            className="cvg-mini-branch cvg-mini-branch-pass"
          />
        </g>
        <text
          x={before ? 146 : 274}
          y={82}
          textAnchor={before ? "end" : "start"}
          className="cvg-mini-out"
          style={{ fill: color }}
        >
          {decision === undefined ? "" : t(DECISION_WORD[decision])}
        </text>
        <text x={before ? 234 : 334} y={82} className="cvg-mini-label">
          {t("desktop.craft.canvas.cvG.works.pass")}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Pill>{t(anchorWord(props.p.anchor))}</Pill>
        {decision === undefined ? null : <Pill>{t(DECISION_WORD[decision])}</Pill>}
        <Pill tone={props.p.meta.enforcement === "enforced" ? "ok" : "plain"}>
          {t(
            props.p.meta.enforcement === "enforced"
              ? "desktop.craft.canvas.cvG.works.enforced"
              : "desktop.craft.canvas.cvG.works.advisory",
          )}
        </Pill>
        {s.guard === true ? <Pill>{t("desktop.craft.canvas.cvG.works.guard")}</Pill> : null}
      </div>
    </div>
  );
}

function DriveWorks(props: { readonly p: Plugin; readonly start: boolean }): ReactElement {
  const steps = props.p.shared.steps ?? [];
  const handoff = props.p.shared.handoffTo ?? [];
  return (
    <div className="cvg-well flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="text-text-tertiary">
          {t(
            props.start
              ? "desktop.craft.canvas.cvG.works.startIn"
              : "desktop.craft.canvas.cvG.works.handoffIn",
          )}
        </span>
        {steps.map((st, i) => (
          <span key={st.id} className="flex items-center gap-1.5">
            <span className="text-text-tertiary">→</span>
            <span
              className="cvg-step"
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
            <span className="cvg-mono text-text-secondary">{h}</span>
          </span>
        ))}
      </div>
      {steps.some((s) => s.lanes !== undefined) ? (
        <div className="text-[12px] text-text-tertiary">
          {steps
            .filter((s) => s.lanes !== undefined)
            .map((s) =>
              t("desktop.craft.canvas.cvG.works.lanes", {
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
    <div className="cvg-well px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-text-secondary">
        <PartGlyph name="mcp" size={14} />
        <span className="cvg-mono">{props.p.shared.mcp?.server ?? props.p.name}</span>
        <span className="text-text-tertiary">
          {t("desktop.craft.canvas.cvG.summary.tool", {
            server: "",
            n: tools.length,
            w: tools.filter((x) => x.writes).length,
          }).trim()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {tools.map((x) => (
          <span key={x.name} className="cvg-tool-chip" data-writes={x.writes ? "" : undefined}>
            <span className="cvg-mono truncate">{x.name}</span>
            {x.writes ? (
              <span className="text-[10.5px]">{t("desktop.craft.canvas.cvG.works.writes")}</span>
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
    <div className="cvg-well flex flex-col gap-2 px-3 py-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <Pill>{t("desktop.craft.canvas.cvG.works.always")}</Pill>
        <span className="text-text-secondary">
          {[...s.instructions, ...s.memory].join(", ") ||
            t("desktop.craft.canvas.cvG.works.nothing")}
        </span>
        {cost.always === null ? null : (
          <span className="ms-auto text-text-tertiary tabular-nums">{tokens(cost.always)}</span>
        )}
      </div>
      {s.skills.length > 0 ? (
        <div className="flex items-start gap-2">
          <Pill>{t("desktop.craft.canvas.cvG.works.onDemand")}</Pill>
          <span className="flex flex-wrap gap-1">
            {s.skills.map((k) => (
              <span key={k} className="cvg-chip">
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
}): ReactElement {
  const { p, profile } = props;
  const rels = relationsOf(profile).filter((r) => r.from === p.name || r.to === p.name);
  const rows: ReactNode[] = [];
  for (const r of rels) {
    const outgoing = r.from === p.name;
    const other = outgoing ? r.to : r.from;
    const otherName =
      other === BUILDER
        ? t("desktop.craft.canvas.cvG.builder.name")
        : other.startsWith("tool:")
          ? t("desktop.craft.canvas.cvG.rel.builtinTool", { tool: r.label })
          : other;
    const verb = t(
      outgoing
        ? (`desktop.craft.canvas.cvG.relOut.${r.kind}` as const)
        : (`desktop.craft.canvas.cvG.relIn.${r.kind}` as const),
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
          <button type="button" className="cvg-link" onClick={() => props.actions.focus(other)}>
            {otherName}
          </button>
        ) : (
          <span className="text-text-primary">{otherName}</span>
        )}
        {r.label !== "" && r.kind !== "replaces" ? (
          <span className="cvg-mono ms-auto truncate text-[11.5px] text-text-tertiary">
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
              ? "desktop.craft.canvas.cvG.relOut.optional"
              : "desktop.craft.canvas.cvG.relOut.depends",
          )}
        </span>
        <span
          className={
            prov.type === "none" ? "text-[var(--cs-color-warning-text)]" : "text-text-secondary"
          }
        >
          {t(
            prov.type === "engine"
              ? "desktop.craft.canvas.cvG.rel.engine"
              : "desktop.craft.canvas.cvG.rel.unmet",
          )}
        </span>
        <span className="cvg-mono ms-auto truncate text-[11.5px] text-text-tertiary">
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
          {t("desktop.craft.canvas.cvG.rel.ownedBy")}
        </span>
        <button
          type="button"
          className="cvg-link"
          onClick={() => props.actions.focus(`bundle:${source.id}`)}
        >
          {meta.displayName}
        </button>
        <span className="cvg-mono ms-auto truncate text-[11.5px] text-text-tertiary">{`${source.id}/${p.name}`}</span>
      </li>,
    );
  }
  if (rows.length === 0)
    return (
      <p className="text-[13px] text-text-tertiary">{t("desktop.craft.canvas.cvG.rel.none")}</p>
    );
  return <ul className="flex flex-col">{rows}</ul>;
}

function RiskMeter(props: { readonly level: number }): ReactElement {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="cvg-risk-seg"
          data-on={i <= props.level ? "" : undefined}
          data-high={props.level >= 3 ? "" : undefined}
        />
      ))}
    </span>
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
  const sourceWord =
    placed === undefined
      ? t("desktop.craft.canvas.cvG.source.out")
      : placed.source.type === "base"
        ? t("desktop.craft.canvas.cvG.base")
        : placed.source.type === "bundle"
          ? t("desktop.craft.canvas.cvG.source.bundle", {
              name: bundleMetaOf(placed.source.id).displayName,
            })
          : t("desktop.craft.canvas.cvG.source.profile");
  const writes = (s.mcp?.tools ?? []).filter((x) => x.writes).length;
  const head = (
    <div className="flex items-start gap-3">
      <KindTile kind={p.kind} size={42} draft={draft} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h2 className="truncate text-[18px] font-semibold text-text-primary">{p.name}</h2>
          <span className="truncate text-[12.5px] text-text-tertiary">{meta.displayName}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px]">
          <span className="font-medium" style={{ color: KIND_COLOR[p.kind] }}>
            {t(KIND_WORD[p.kind])}
          </span>
          <span className="text-text-tertiary">·</span>
          <span className="text-text-secondary">{t(anchorWord(p.anchor))}</span>
          {placed !== undefined && placed.siblings > 1 ? (
            <>
              <span className="text-text-tertiary">·</span>
              <span className="text-text-secondary tabular-nums">
                {t("desktop.craft.canvas.cvG.order", { n: placed.order, of: placed.siblings })}
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Pill tone={meta.review.state === "approved" && meta.pending === null ? "ok" : "warn"}>
            {meta.pending !== null && meta.review.state === "approved"
              ? t("desktop.craft.canvas.cvG.review.pendingVersion", { v: meta.pending.version })
              : t(REVIEW_WORD[meta.review.state])}
          </Pill>
          <Pill>{sourceWord}</Pill>
          {placed?.start === true ? <Pill>{t("desktop.craft.canvas.cvG.startDrive")}</Pill> : null}
          <Pill>{t(ORIGIN_WORD[meta.origin])}</Pill>
        </div>
      </div>
    </div>
  );
  const foot = (
    <>
      <Button size="sm" variant="outline" onClick={() => props.actions.open(p.name)}>
        <Icon name="enter" size={13} />
        {t("desktop.craft.canvas.cvG.act.inside")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => props.actions.testRun(p.name)}>
        <Icon name="play" size={12} />
        {t("desktop.craft.canvas.cvG.act.test")}
      </Button>
      {inside && placed.source.type === "profile" ? (
        <>
          <span className="flex items-center">
            <button
              type="button"
              className="cvg-icon-btn"
              disabled={!canNudge(props.profile, p.name, -1)}
              aria-label={t("desktop.craft.canvas.cvG.act.earlier")}
              title={t("desktop.craft.canvas.cvG.act.earlier")}
              onClick={() => props.actions.nudge(p.name, -1)}
            >
              <Icon name="up" size={14} />
            </button>
            <button
              type="button"
              className="cvg-icon-btn"
              disabled={!canNudge(props.profile, p.name, 1)}
              aria-label={t("desktop.craft.canvas.cvG.act.later")}
              title={t("desktop.craft.canvas.cvG.act.later")}
              onClick={() => props.actions.nudge(p.name, 1)}
            >
              <Icon name="down" size={14} />
            </button>
          </span>
          {p.kind === "drive" && !placed.start ? (
            <Button size="sm" variant="ghost" onClick={() => props.actions.setStart(p.name)}>
              {t("desktop.craft.canvas.cvG.act.makeStart")}
            </Button>
          ) : null}
        </>
      ) : null}
      <span className="ms-auto" />
      {!inside ? (
        <Button size="sm" onClick={() => props.actions.add(p.name)}>
          <Icon name="plus" size={13} />
          {t("desktop.craft.canvas.cvG.act.add")}
        </Button>
      ) : placed.source.type === "base" ? (
        <span className="text-[12px] text-text-tertiary">
          {t("desktop.craft.canvas.cvG.act.baseFixed")}
        </span>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => props.actions.remove(p.name)}>
          <Icon name="remove" size={13} />
          {placed.source.type === "bundle"
            ? t("desktop.craft.canvas.cvG.act.removeBundle")
            : t("desktop.craft.canvas.cvG.act.remove")}
        </Button>
      )}
    </>
  );
  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cvG.panel.label", { name: p.name })}
      head={head}
      foot={foot}
      onClose={() => props.actions.close()}
    >
      <p className="text-[15px] leading-[22px] text-text-primary">{t(meta.purpose)}</p>
      <p className="mt-1 text-[12.5px] text-text-tertiary">{t(KIND_DOES[p.kind])}</p>

      <Section
        title={t("desktop.craft.canvas.cvG.sec.works")}
        icon={
          p.kind === "drive"
            ? "stage"
            : p.kind === "hook"
              ? "handler"
              : p.kind === "tool"
                ? "mcp"
                : "instruction"
        }
      >
        {p.kind === "hook" ? <HookWorks p={p} /> : null}
        {p.kind === "drive" ? <DriveWorks p={p} start={placed?.start === true} /> : null}
        {p.kind === "tool" ? <ToolWorks p={p} /> : null}
        {p.kind === "inject" ? <InjectWorks p={p} /> : null}
      </Section>

      <Section title={t("desktop.craft.canvas.cvG.sec.parts")} icon="package">
        <dl>
          {s.instructions.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.instructions")}>
              <span className="cvg-mono">{s.instructions.join(", ")}</span>
            </Row>
          ) : null}
          {s.skills.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.skills")}>
              <span className="cvg-mono">{s.skills.join(", ")}</span>
            </Row>
          ) : null}
          {s.memory.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.memory")}>
              <span className="cvg-mono">{s.memory.join(", ")}</span>
            </Row>
          ) : null}
          {s.mcp !== undefined ? (
            <Row k={t("desktop.craft.canvas.cvG.part.mcp")}>
              <span className="cvg-mono">{`${s.mcp.server} · ${String(s.mcp.tools.length)}`}</span>
            </Row>
          ) : null}
          {meta.hooks.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.hooks")}>
              <span className="cvg-mono">{meta.hooks.join(", ")}</span>
            </Row>
          ) : null}
          {(s.steps ?? []).length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.steps")}>
              {(s.steps ?? []).map((st) => t(STEP_WORD[st.id])).join(" → ")}
            </Row>
          ) : null}
          {s.settings.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.settings")}>
              <span className="cvg-mono">
                {s.settings.map((x) => `${x.key} = ${x.value}`).join(", ")}
              </span>
            </Row>
          ) : null}
          {meta.recordKinds.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.part.records")}>
              <span className="cvg-mono">{meta.recordKinds.join(", ")}</span>
            </Row>
          ) : null}
        </dl>
      </Section>

      <Section
        title={t("desktop.craft.canvas.cvG.sec.risk")}
        icon="permission"
        aside={
          <span className="flex items-center gap-2">
            <RiskMeter level={RISK_LEVEL[s.risk]} />
            <span>{t(RISK_WORD[s.risk])}</span>
          </span>
        }
      >
        <dl>
          <Row k={t("desktop.craft.canvas.cvG.risk.code")}>
            {s.code
              ? t(
                  meta.isolated === true
                    ? "desktop.craft.canvas.cvG.risk.isolated"
                    : "desktop.craft.canvas.cvG.risk.inProcess",
                )
              : t("desktop.craft.canvas.cvG.risk.noCode")}
          </Row>
          {s.mcp !== undefined ? (
            <Row k={t("desktop.craft.canvas.cvG.risk.writeTools")}>
              {t("desktop.craft.canvas.cvG.risk.writeToolsValue", {
                n: writes,
                of: s.mcp.tools.length,
              })}
            </Row>
          ) : null}
          {meta.replaces.length > 0 ? (
            <Row k={t("desktop.craft.canvas.cvG.rel.replaces")}>
              <span className="text-[var(--cs-color-warning-text)]">
                {t("desktop.craft.canvas.cvG.risk.replacesValue", {
                  tools: meta.replaces.join(", "),
                })}
              </span>
            </Row>
          ) : null}
          {draft ? (
            <Row k={t("desktop.craft.canvas.cvG.review.draft")}>
              <span className="text-[var(--cs-color-warning-text)]">
                {t("desktop.craft.canvas.cvG.risk.draftAsk")}
              </span>
            </Row>
          ) : null}
        </dl>
      </Section>

      <Section
        title={t("desktop.craft.canvas.cvG.sec.cost")}
        icon="capability"
        aside={<InfoTip text={t("desktop.craft.canvas.cvG.cost.hint")} />}
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
            <div key={k} className="cvg-stat">
              <span className="text-[11px] text-text-tertiary">
                {t(`desktop.craft.canvas.cvG.cost.${k}` as const)}
              </span>
              <span className="text-[15px] text-text-primary tabular-nums">
                {v === null ? "–" : k === "toolCount" ? String(v) : tokens(v)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("desktop.craft.canvas.cvG.sec.relations")} icon="capability">
        <RelationRows p={p} profile={props.profile} placed={placed} actions={props.actions} />
      </Section>

      <Section title={t("desktop.craft.canvas.cvG.sec.origin")} icon="hash">
        <dl>
          <Row k={t("desktop.craft.canvas.cvG.meta.package")}>
            <span className="cvg-mono">
              {meta.pkg === p.name ? p.name : `${meta.pkg}/${p.name}`}
            </span>
          </Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.version")}>
            <span className="cvg-mono">
              {draft ? (meta.pending?.version ?? "–") : meta.version}
            </span>
            <span className="cvg-mono ms-2 text-text-tertiary">
              {`sha256:${draft ? (meta.pending?.contentHash ?? "") : (meta.review.currentHash ?? "")}…`}
            </span>
          </Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.review")}>
            {meta.review.approvedAt === null
              ? t(REVIEW_WORD[meta.review.state])
              : t("desktop.craft.canvas.cvG.meta.approvedAt", { at: meta.review.approvedAt })}
          </Row>
          {meta.pending !== null ? (
            <Row k={t("desktop.craft.canvas.cvG.meta.pending")}>
              <span>
                {meta.pending.parentVersion === null
                  ? t("desktop.craft.canvas.cvG.meta.pendingNew", { v: meta.pending.version })
                  : t("desktop.craft.canvas.cvG.meta.pendingUpdate", {
                      v: meta.pending.version,
                      from: meta.pending.parentVersion,
                    })}
              </span>
              <span className="block text-[12px] text-text-tertiary">
                {t(
                  meta.pending.provenance === "assistant"
                    ? "desktop.craft.canvas.cvG.meta.byBuilder"
                    : "desktop.craft.canvas.cvG.meta.byUser",
                )}
                {" · "}
                {t(meta.pending.label)}
              </span>
            </Row>
          ) : null}
          <Row k={t("desktop.craft.canvas.cvG.meta.author")}>
            {meta.author}
            {meta.license === null ? null : (
              <span className="ms-2 text-text-tertiary">{meta.license}</span>
            )}
          </Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.origin")}>{t(ORIGIN_WORD[meta.origin])}</Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.usedBy")}>
            {usedByOf(p.name)
              .map((u) =>
                t(
                  u === "base"
                    ? "desktop.craft.canvas.cvG.base"
                    : u === "dev"
                      ? "desktop.craft.canvas.cvG.profile.dev"
                      : "desktop.craft.canvas.sample.scale",
                ),
              )
              .join(", ") || t("desktop.craft.canvas.cvG.meta.usedByNone")}
          </Row>
        </dl>
      </Section>

      <Section title={t("desktop.craft.canvas.cvG.sec.recent")} icon="clock">
        <dl>
          <Row k={t("desktop.craft.canvas.cvG.meta.health")}>{t(HEALTH_WORD[meta.health])}</Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.lastUsed")}>{agoText(s.lastUsedMin)}</Row>
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
    <div className="flex items-start gap-3">
      <span className="cvg-bundle-tile">
        <PartGlyph name="package" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h2 className="truncate text-[18px] font-semibold text-text-primary">
            {meta.displayName}
          </h2>
          <span className="cvg-mono text-[12.5px] text-text-tertiary">{props.id}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-text-secondary">
          <span>{t("desktop.craft.canvas.cvG.bundle.word")}</span>
          <span className="text-text-tertiary">·</span>
          <span>{t("desktop.craft.canvas.cvG.bundle.count", { n: props.members.length })}</span>
          {kinds.map((k) => (
            <span key={k} style={{ color: KIND_COLOR[k] }} className="flex">
              <KindGlyph kind={k} size={12} />
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Pill tone="ok">{t("desktop.craft.canvas.cvG.review.approved")}</Pill>
          <Pill>{t(ORIGIN_WORD[meta.origin])}</Pill>
          <Pill>{`v${meta.version}`}</Pill>
        </div>
      </div>
    </div>
  );
  const foot = (
    <>
      <Button size="sm" variant="outline" onClick={() => props.actions.toggleBundle(props.id)}>
        <Icon name={props.collapsed ? "unfold" : "fold"} size={13} />
        {t(
          props.collapsed
            ? "desktop.craft.canvas.cvG.bundle.unfold"
            : "desktop.craft.canvas.cvG.bundle.fold",
        )}
      </Button>
      <span className="ms-auto" />
      <Button size="sm" variant="ghost" onClick={() => props.actions.removeBundle(props.id)}>
        <Icon name="remove" size={13} />
        {t("desktop.craft.canvas.cvG.act.removeBundle")}
      </Button>
    </>
  );
  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cvG.panel.label", { name: meta.displayName })}
      head={head}
      foot={foot}
      onClose={() => props.actions.close()}
    >
      <p className="text-[15px] leading-[22px] text-text-primary">{t(meta.purpose)}</p>
      <p className="mt-1 text-[12.5px] text-text-tertiary">
        {t("desktop.craft.canvas.cvG.bundle.what")}
      </p>
      <Section
        title={t("desktop.craft.canvas.cvG.bundle.members")}
        icon="package"
        aside={
          <InfoTip
            text={[
              t("desktop.craft.canvas.cvG.bundle.orderHint"),
              t("desktop.craft.canvas.cvG.bundle.nestHint"),
            ]}
          />
        }
      >
        <ol className="flex flex-col gap-1">
          {props.members.map((m, i) => (
            <li key={m.plugin.name}>
              <button
                type="button"
                className="cvg-member"
                onClick={() => props.actions.focus(m.plugin.name)}
              >
                <span className="w-4 text-[12px] text-text-tertiary tabular-nums">
                  {String(i + 1)}
                </span>
                <KindTile kind={m.plugin.kind} size={24} />
                <span className="min-w-0 flex-1 text-start">
                  <span className="block truncate text-[13.5px] text-text-primary">
                    {m.plugin.name}
                  </span>
                  <span className="block truncate text-[12px] text-text-tertiary">
                    {`${t(KIND_WORD[m.plugin.kind])} · ${t(anchorWord(m.plugin.anchor))}`}
                  </span>
                </span>
                <span className="cvg-mono text-[11.5px] text-text-tertiary">{`${props.id}/${m.plugin.name}`}</span>
              </button>
            </li>
          ))}
        </ol>
      </Section>
      <Section title={t("desktop.craft.canvas.cvG.bundle.folding")} icon="stage">
        <p className="text-[13px] leading-[19px] text-text-secondary">
          {t("desktop.craft.canvas.cvG.bundle.foldingText", { n: anchors.size })}
        </p>
      </Section>
      <Section title={t("desktop.craft.canvas.cvG.sec.origin")} icon="hash">
        <dl>
          <Row k={t("desktop.craft.canvas.cvG.meta.version")}>
            <span className="cvg-mono">{meta.version}</span>
            <span className="cvg-mono ms-2 text-text-tertiary">{`sha256:${meta.hash}…`}</span>
          </Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.author")}>{meta.author}</Row>
          <Row k={t("desktop.craft.canvas.cvG.meta.origin")}>{t(ORIGIN_WORD[meta.origin])}</Row>
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
    <div className="flex items-start gap-3">
      <span className="cvg-bundle-tile">
        <PartGlyph name="builder" size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[18px] font-semibold text-text-primary">
          {t("desktop.craft.canvas.cvG.builder.name")}
        </h2>
        <div className="mt-0.5 text-[12.5px] text-text-secondary">
          {t("desktop.craft.canvas.cvG.builder.where")}
        </div>
      </div>
    </div>
  );
  return (
    <FloatingPanel
      label={t("desktop.craft.canvas.cvG.builder.name")}
      head={head}
      foot={null}
      onClose={() => props.actions.close()}
    >
      <p className="text-[14px] leading-[21px] text-text-primary">
        {t("desktop.craft.canvas.cvG.builder.what")}
      </p>
      <Section title={t("desktop.craft.canvas.cvG.builder.made")} icon="builder">
        <ul className="flex flex-col gap-1">
          {props.created.map((n) => (
            <li key={n} className="flex items-center gap-2 text-[13px]">
              <RelationSwatch kind="creates" />
              <button type="button" className="cvg-link" onClick={() => props.actions.focus(n)}>
                {n}
              </button>
              <span className="ms-auto text-text-tertiary">
                {t("desktop.craft.canvas.cvG.review.draft")}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </FloatingPanel>
  );
}
