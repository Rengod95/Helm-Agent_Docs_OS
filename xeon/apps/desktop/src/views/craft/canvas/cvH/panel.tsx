// cvH 플로팅 상세 패널: 노드를 누르면 캔버스 위에 뜨는 큰 판(캔버스를 밀어내지 않는다).
// 노드의 반대편에 자리를 잡고(노드를 가리지 않게), 머리를 끌어 옮길 수 있다. 머리와 할 일 줄은 고정이고 가운데가 스크롤된다.
// 보이는 것은 계약에 있는 필드뿐이다: 목적, 종류와 붙는 자리, 구성 요소, 권한과 위험, 출처·버전·해시, 리뷰, 넣은 곳, 관계, 최근 사용·비용.
import { t } from "@fresnel/client/i18n";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { InfoTip } from "../../info-tip.tsx";
import { SHARED_PROFILES, type SharedPlugin } from "../shared-sample.ts";
import { lastUsed, relationsFor, viaOf } from "./facts.ts";
import { Glyph, KIND_COLOR, KindBadge, RiskGauge, type GlyphName } from "./glyphs.tsx";
import {
  canMove,
  entriesOf,
  hasPlugin,
  isBase,
  pluginOf,
  slotOf,
  SLOTS,
  sideOf,
  type CanvasProfile,
  type Kind,
  type Relation,
} from "./model.ts";
import { extOf, foldOf, GROUP_EXT, DRAFT_SOURCE } from "./sample-ext.ts";
import {
  BRANCH_WORD,
  DECISION_WORD,
  ENFORCEMENT_WORD,
  FOLD_WORD,
  HEALTH_WORD,
  KIND_WORD,
  LANE_WORD,
  ORIGIN_WORD,
  PROFILE_WORD,
  RELATION_WORD,
  REVIEW_WORD,
  RISK_WORD,
  SLOT_WORD,
  STEP_WORD,
} from "./words.ts";

export const PANEL_W = 452;

export interface PanelActions {
  readonly close: () => void;
  readonly focus: (name: string) => void;
  readonly enter: (name: string) => void;
  readonly remove: (name: string) => void;
  readonly removeGroup: (id: string) => void;
  readonly add: (name: string) => void;
  readonly move: (name: string, dir: -1 | 1) => void;
  readonly setStart: (name: string) => void;
  readonly toggleFold: (id: string) => void;
}

function Section(props: {
  readonly title: string;
  readonly glyph: GlyphName;
  readonly children: ReactNode;
  readonly info?: string;
}): ReactElement {
  return (
    <section className="border-t border-[var(--cvh-hair)] px-5 py-3.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-[var(--cvh-ink-3)]">
        <Glyph name={props.glyph} size={12} />
        {props.title}
        {props.info !== undefined && <InfoTip text={props.info} />}
      </h3>
      {props.children}
    </section>
  );
}

function Row(props: { readonly k: string; readonly children: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-[24px] items-baseline gap-3 text-[13px]">
      <span className="w-[92px] shrink-0 text-[var(--cvh-ink-3)]">{props.k}</span>
      <span className="min-w-0 flex-1 text-[var(--cvh-ink)]">{props.children}</span>
    </div>
  );
}

/** 붙는 자리를 그림으로: 작은 본선 위 정거장 열둘과 이 플러그인의 갈림 */
function WhereMap(props: {
  readonly kind: Kind;
  readonly slot: (typeof SLOTS)[number];
}): ReactElement {
  const W = PANEL_W - 40;
  const step = (W - 24) / (SLOTS.length - 1);
  const xOf = (i: number): number => 12 + i * step;
  const at = SLOTS.indexOf(props.slot);
  const x = xOf(at);
  const color = KIND_COLOR[props.kind];
  const up = sideOf(props.kind) === "above";
  const y0 = 34;
  const tip = up ? 6 : 62;
  let branch = "";
  if (props.kind === "inject")
    branch = `M${String(x - 16)} ${String(tip)} L${String(x - 16)} ${String(y0 - 12)} Q${String(x - 16)} ${String(y0)} ${String(x)} ${String(y0)}`;
  else if (props.kind === "tool")
    branch = `M${String(x)} ${String(y0)} Q${String(x + 16)} ${String(y0)} ${String(x + 16)} ${String(y0 - 12)} L${String(x + 16)} ${String(tip)}`;
  else if (props.kind === "hook")
    branch = `M${String(x)} ${String(y0 - 12)} L${String(x)} ${String(tip)}`;
  else
    branch = `M${String(x)} ${String(y0)} L${String(x)} ${String(y0 + 8)} A6 6 0 1 1 ${String(x + 0.1)} ${String(y0 + 8)} L${String(x)} ${String(tip)}`;
  return (
    <svg width={W} height={68} viewBox={`0 0 ${String(W)} 68`} aria-hidden="true" className="block">
      <path
        d={`M4 ${String(y0)} L${String(W - 4)} ${String(y0)}`}
        stroke="var(--cvh-rail)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      {SLOTS.map((s, i) => {
        const block = ["context", "model", "tools", "ask", "agents", "record"].includes(s);
        return block ? (
          <rect
            key={s}
            x={xOf(i) - 7}
            y={y0 - 5}
            width={14}
            height={10}
            rx={5}
            fill="var(--cvh-ground)"
            stroke="var(--cvh-rail)"
            strokeWidth={2}
          />
        ) : (
          <circle
            key={s}
            cx={xOf(i)}
            cy={y0}
            r={s.includes(".") ? 2.5 : 4}
            fill="var(--cvh-ground)"
            stroke="var(--cvh-rail)"
            strokeWidth={2}
          />
        );
      })}
      <path d={branch} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <circle
        cx={props.kind === "inject" ? x - 16 : props.kind === "tool" ? x + 16 : x}
        cy={tip}
        r={4}
        fill={color}
      />
    </svg>
  );
}

function relationRow(
  rel: Relation,
  me: string,
): {
  readonly glyph: GlyphName;
  readonly text: string;
  readonly target: string | null;
  readonly warn: boolean;
} {
  const word = t(RELATION_WORD[rel.kind]);
  if (rel.kind === "handoff") {
    const out = rel.from === me;
    const other = out ? rel.to : rel.from;
    return {
      glyph: "handoff",
      text: t(
        out
          ? "desktop.craft.canvas.cvH.panel.rel.handoffTo"
          : "desktop.craft.canvas.cvH.panel.rel.handoffFrom",
        { name: other ?? "" },
      ),
      target: other,
      warn: false,
    };
  }
  if (rel.kind === "depends") {
    if (rel.unmet)
      return {
        glyph: "warn",
        text: t("desktop.craft.canvas.cvH.panel.rel.unmet", { capability: rel.via ?? "" }),
        target: null,
        warn: true,
      };
    const out = rel.from === me;
    return {
      glyph: "relations",
      text: t(
        out
          ? "desktop.craft.canvas.cvH.panel.rel.needs"
          : "desktop.craft.canvas.cvH.panel.rel.gives",
        { capability: rel.via ?? "", name: (out ? rel.to : rel.from) ?? "" },
      ),
      target: out ? rel.to : rel.from,
      warn: false,
    };
  }
  if (rel.kind === "replaces")
    return {
      glyph: "replace",
      text: t("desktop.craft.canvas.cvH.panel.rel.replaces", {
        part: (rel.via ?? "").replace("tool:", ""),
      }),
      target: null,
      warn: false,
    };
  if (rel.kind === "creates")
    return {
      glyph: "seed",
      text: t("desktop.craft.canvas.cvH.panel.rel.creates", {
        thread: rel.via ?? "",
        tool: DRAFT_SOURCE.tool,
      }),
      target: null,
      warn: false,
    };
  const gid = rel.from.replace("group:", "");
  return {
    glyph: "group",
    text: `${word} · ${t("desktop.craft.canvas.cvH.panel.rel.ownedBy", { group: gid, extension: GROUP_EXT[gid]?.extension ?? gid })}`,
    target: rel.from,
    warn: false,
  };
}

function usedBy(name: string): string {
  const ids = (["dev", "scale"] as const).filter((id) => {
    const p = SHARED_PROFILES[id];
    return p.base.includes(name) || p.plugins.includes(name);
  });
  return ids.length === 0
    ? t("desktop.craft.canvas.cvH.panel.usedByNone")
    : ids.map((id) => t(PROFILE_WORD[id])).join(", ");
}

function Components(props: { readonly p: SharedPlugin }): ReactElement {
  const { p } = props;
  const ext = extOf(p.name);
  const rows: ReactNode[] = [];
  if (p.instructions.length > 0)
    rows.push(
      <Row key="ins" k={t("desktop.craft.canvas.cvH.comp.instructions")}>
        <span className="flex flex-wrap gap-1">
          {p.instructions.map((f) => (
            <span key={f} className="cvh-chip cvh-mono">
              {f}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.skills.length > 0)
    rows.push(
      <Row key="sk" k={t("desktop.craft.canvas.cvH.comp.skills", { count: p.skills.length })}>
        <span className="flex flex-wrap gap-1">
          {p.skills.map((f) => (
            <span key={f} className="cvh-chip cvh-mono">
              {f}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.memory.length > 0)
    rows.push(
      <Row key="mem" k={t("desktop.craft.canvas.cvH.comp.memory")}>
        <span className="flex flex-wrap gap-1">
          {p.memory.map((f) => (
            <span key={f} className="cvh-chip cvh-mono">
              {f}
            </span>
          ))}
        </span>
      </Row>,
    );
  if (p.mcp !== undefined) {
    const transport = p.settings.find((s) => s.key === "transport")?.value ?? "stdio";
    rows.push(
      <Row key="mcp" k={t("desktop.craft.canvas.cvH.comp.mcp")}>
        <span className="cvh-mono">{p.mcp.server}</span>
        <span className="text-[var(--cvh-ink-3)]"> · {transport}</span>
      </Row>,
      <Row key="tools" k={t("desktop.craft.canvas.cvH.comp.tools", { count: p.mcp.tools.length })}>
        <span className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {p.mcp.tools.map((x) => (
            <span key={x.name} className="cvh-mono flex items-center gap-1.5 text-[12px]">
              <span
                className="inline-block size-[7px] shrink-0 rounded-[1px]"
                style={
                  x.writes
                    ? { background: "var(--cs-color-warning-text)" }
                    : { border: "1px solid var(--cvh-ink-3)" }
                }
              />
              {x.name}
            </span>
          ))}
        </span>
      </Row>,
    );
  }
  if (ext?.launch !== undefined)
    rows.push(
      <Row key="launch" k={t("desktop.craft.canvas.cvH.comp.launch")}>
        <code className="cvh-mono block rounded-[6px] bg-[var(--cs-color-fill-hover)] px-2 py-1 text-[12px] break-all">
          {[ext.launch.command, ...ext.launch.args].join(" ")}
        </code>
        {ext.launch.envNames.length > 0 && (
          <span className="mt-1 block text-[12px] text-[var(--cvh-ink-3)]">
            {t("desktop.craft.canvas.cvH.comp.env")}{" "}
            <span className="cvh-mono">{ext.launch.envNames.join(", ")}</span>
          </span>
        )}
      </Row>,
    );
  if (p.kind === "hook" && ext?.hook !== undefined)
    rows.push(
      <Row key="hook" k={t("desktop.craft.canvas.cvH.comp.hook")}>
        <span className="cvh-mono">{ext.hook}</span>
        <span className="mt-0.5 block text-[12px] text-[var(--cvh-ink-2)]">
          {t(FOLD_WORD[foldOf(ext.hook)])}
          {p.decision !== undefined &&
            ` · ${t("desktop.craft.canvas.cvH.comp.decides", { decision: t(DECISION_WORD[p.decision]) })}`}
        </span>
      </Row>,
    );
  if (p.steps !== undefined)
    rows.push(
      <Row key="steps" k={t("desktop.craft.canvas.cvH.comp.steps", { count: p.steps.length })}>
        <span className="flex flex-wrap items-center gap-1">
          {p.steps.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-[var(--cvh-ink-3)]">→</span>}
              <span
                className="cvh-chip"
                style={{ borderColor: "var(--cvh-drive)", color: "var(--cvh-ink)" }}
              >
                {t(STEP_WORD[s.id])}
                {s.parallel > 1 && (
                  <span className="cvh-mono text-[var(--cvh-ink-3)]">×{s.parallel}</span>
                )}
              </span>
            </span>
          ))}
          <span className="text-[var(--cvh-ink-3)]">
            <Glyph name="loop" size={12} />
          </span>
        </span>
        {p.steps.some((s) => s.lanes !== undefined) && (
          <span className="mt-1 block text-[12px] text-[var(--cvh-ink-3)]">
            {p.steps
              .filter((s) => s.lanes !== undefined)
              .map(
                (s) =>
                  `${t(STEP_WORD[s.id])}: ${(s.lanes ?? []).map((l) => t(LANE_WORD[l])).join(" · ")}`,
              )
              .join(" / ")}
          </span>
        )}
      </Row>,
    );
  if (p.settings.length > 0)
    rows.push(
      <Row key="set" k={t("desktop.craft.canvas.cvH.comp.settings")}>
        <span className="flex flex-col">
          {p.settings.map((s) => (
            <span key={s.key} className="cvh-mono flex justify-between gap-3 text-[12px]">
              <span className="text-[var(--cvh-ink-2)]">{s.key}</span>
              <span>{s.value}</span>
            </span>
          ))}
        </span>
      </Row>,
    );
  if (rows.length === 0)
    return (
      <p className="text-[13px] text-[var(--cvh-ink-3)]">
        {t("desktop.craft.canvas.cvH.comp.none")}
      </p>
    );
  return <div className="flex flex-col gap-1.5">{rows}</div>;
}

function useDrag(): {
  readonly offset: { readonly x: number; readonly y: number };
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
} {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0 || (e.target instanceof HTMLElement && e.target.closest("button") !== null))
      return;
    start.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      const s = start.current;
      if (s === null) return;
      setOffset({ x: s.ox + ev.clientX - s.x, y: s.oy + ev.clientY - s.y });
    };
    const up = (): void => {
      start.current = null;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return { offset, onPointerDown };
}

function Shell(props: {
  readonly side: "left" | "right";
  readonly inset: number;
  readonly label: string;
  readonly head: ReactNode;
  readonly foot: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
}): ReactElement {
  const drag = useDrag();
  const pos =
    props.side === "right"
      ? { right: 16 - drag.offset.x }
      : { left: props.inset + 16 + drag.offset.x };
  return (
    <aside
      role="dialog"
      aria-label={props.label}
      data-float-panel=""
      className="cvh-float absolute z-30 flex flex-col overflow-hidden"
      style={{
        ...pos,
        top: 60 + drag.offset.y,
        width: PANEL_W,
        maxHeight: `calc(100% - ${String(76 + Math.max(0, drag.offset.y))}px)`,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <div
        className="cursor-grab select-none active:cursor-grabbing"
        onPointerDown={drag.onPointerDown}
        title={t("desktop.craft.canvas.cvH.panel.drag")}
      >
        {props.head}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{props.children}</div>
      <div className="flex flex-wrap items-center gap-1 border-t border-[var(--cvh-hair)] px-3 py-2">
        {props.foot}
      </div>
    </aside>
  );
}

export function PluginPanel(props: {
  readonly name: string;
  readonly profile: CanvasProfile;
  readonly side: "left" | "right";
  readonly inset: number;
  readonly actions: PanelActions;
}): ReactElement | null {
  const { name, profile, actions } = props;
  const p = pluginOf(name);
  const ext = extOf(name);
  if (p === undefined || ext === undefined) return null;
  const via = viaOf(profile, name);
  const inProfile = hasPlugin(profile, name);
  const rels = relationsFor(profile, name);
  const slot = slotOf(p);
  const color = KIND_COLOR[p.kind];
  const writes = p.mcp?.tools.filter((x) => x.writes).length ?? 0;
  const replaceConflict = ext.replaces.filter((part) =>
    entriesOf(profile).some((m) => m !== name && (extOf(m)?.replaces ?? []).includes(part)),
  );

  const head = (
    <div>
      <div className="h-[5px]" style={{ background: color }} />
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <KindBadge
          kind={p.kind}
          size={36}
          draft={ext.review === "draft"}
          guard={p.guard === true}
        />
        <div className="min-w-0 flex-1">
          <h2 className="cvh-mono truncate text-[20px] font-semibold text-[var(--cvh-ink)]">
            {name}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--cvh-ink-2)]">
            <span style={{ color }}>{t(KIND_WORD[p.kind])}</span>
            {" · "}
            {t(SLOT_WORD[slot])}
            {p.decision !== undefined && ` · ${t(DECISION_WORD[p.decision])}`}
            {profile.startDrive === name && ` · ${t("desktop.craft.canvas.cvH.mark.start")}`}
          </p>
        </div>
        <button
          type="button"
          className="cvh-icon-btn shrink-0"
          aria-label={t("desktop.craft.canvas.cvH.panel.close")}
          onClick={actions.close}
        >
          <Glyph name="close" size={13} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        <span
          className="cvh-chip"
          style={
            ext.review === "approved"
              ? undefined
              : {
                  color: "var(--cs-color-warning-text)",
                  borderColor: "var(--cs-color-warning-border, var(--cvh-hair))",
                }
          }
        >
          {t(REVIEW_WORD[ext.review])}
        </span>
        <span className="cvh-chip">{t(HEALTH_WORD[ext.health])}</span>
        <span className="cvh-chip">{t(ENFORCEMENT_WORD[ext.enforcement])}</span>
        <span className="cvh-chip">
          {via.kind === "base"
            ? t("desktop.craft.canvas.cvH.via.base")
            : via.kind === "group"
              ? t("desktop.craft.canvas.cvH.via.group", { group: via.id })
              : via.kind === "profile"
                ? t("desktop.craft.canvas.cvH.via.profile", { order: via.index })
                : t("desktop.craft.canvas.cvH.via.none")}
        </span>
      </div>
    </div>
  );

  const removeWhy = isBase(profile, name)
    ? t("desktop.craft.canvas.cvH.panel.removeBase")
    : via.kind === "group"
      ? t("desktop.craft.canvas.cvH.panel.removeMember")
      : null;

  const foot = inProfile ? (
    <>
      <button
        type="button"
        className="cvh-btn"
        style={{ color: "var(--cvh-ink)" }}
        onClick={() => {
          actions.enter(name);
        }}
      >
        <Glyph name="enter" size={12} />
        {t("desktop.craft.canvas.cvH.panel.inside")}
      </button>
      <button
        type="button"
        className="cvh-btn"
        disabled
        title={t("desktop.craft.canvas.cvH.panel.testSample")}
      >
        <Glyph name="play" size={12} />
        {t("desktop.craft.canvas.cvH.panel.test")}
      </button>
      {p.kind === "drive" && profile.startDrive !== name && (
        <button
          type="button"
          className="cvh-btn"
          onClick={() => {
            actions.setStart(name);
          }}
        >
          <Glyph name="start" size={12} />
          {t("desktop.craft.canvas.cvH.panel.setStart")}
        </button>
      )}
      <span className="ml-auto flex items-center">
        <button
          type="button"
          className="cvh-icon-btn"
          disabled={!canMove(profile, name, -1)}
          aria-label={t("desktop.craft.canvas.cvH.panel.earlier")}
          title={t("desktop.craft.canvas.cvH.panel.earlier")}
          onClick={() => {
            actions.move(name, -1);
          }}
        >
          <Glyph name="up" size={13} />
        </button>
        <button
          type="button"
          className="cvh-icon-btn"
          disabled={!canMove(profile, name, 1)}
          aria-label={t("desktop.craft.canvas.cvH.panel.later")}
          title={t("desktop.craft.canvas.cvH.panel.later")}
          onClick={() => {
            actions.move(name, 1);
          }}
        >
          <Glyph name="down" size={13} />
        </button>
        <button
          type="button"
          className="cvh-btn"
          disabled={removeWhy !== null}
          title={removeWhy ?? undefined}
          onClick={() => {
            actions.remove(name);
          }}
        >
          <Glyph name="trash" size={12} />
          {t("desktop.craft.canvas.cvH.panel.remove")}
        </button>
      </span>
    </>
  ) : (
    <>
      <span className="px-2 text-[12px] text-[var(--cvh-ink-3)]">
        {t("desktop.craft.canvas.cvH.via.none")}
      </span>
      <button
        type="button"
        className="cvh-btn ml-auto"
        style={{ color: "var(--cvh-ink)" }}
        onClick={() => {
          actions.add(name);
        }}
      >
        <Glyph name="plus" size={12} />
        {t("desktop.craft.canvas.cvH.panel.add")}
      </button>
    </>
  );

  return (
    <Shell
      side={props.side}
      inset={props.inset}
      label={t("desktop.craft.canvas.cvH.panel.label", { name })}
      head={head}
      foot={foot}
      onClose={actions.close}
    >
      <section className="px-5 pt-1 pb-3.5">
        <p className="text-[15px] leading-[22px] text-[var(--cvh-ink)]">{t(ext.purpose)}</p>
      </section>
      <Section title={t("desktop.craft.canvas.cvH.panel.where")} glyph="right">
        <WhereMap kind={p.kind} slot={slot} />
        <p className="mt-1 text-[12.5px] text-[var(--cvh-ink-2)]">
          {t("desktop.craft.canvas.cvH.panel.whereLine", {
            branch: t(BRANCH_WORD[p.kind]),
            slot: t(SLOT_WORD[slot]),
          })}
        </p>
      </Section>
      <Section title={t("desktop.craft.canvas.cvH.panel.parts")} glyph="skill">
        <Components p={p} />
      </Section>
      <Section title={t("desktop.craft.canvas.cvH.panel.risk")} glyph="shield">
        <Row k={t("desktop.craft.canvas.cvH.panel.riskLevel")}>
          <span className="flex items-center gap-2">
            <RiskGauge risk={p.risk} wide />
            <span
              style={
                p.risk === "exec" || p.risk === "write"
                  ? { color: "var(--cs-color-warning-text)" }
                  : undefined
              }
            >
              {t(RISK_WORD[p.risk])}
            </span>
          </span>
        </Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.runs")}>
          {p.code
            ? t("desktop.craft.canvas.cvH.panel.code")
            : t("desktop.craft.canvas.cvH.panel.noCode")}
          {ext.isolated === true && ` · ${t("desktop.craft.canvas.cvH.panel.isolated")}`}
        </Row>
        {writes > 0 && (
          <Row k={t("desktop.craft.canvas.cvH.panel.writes")}>
            {t("desktop.craft.canvas.cvH.panel.writeTools", { count: writes })}
          </Row>
        )}
        {ext.replaces.length > 0 && (
          <Row k={t("desktop.craft.canvas.cvH.rel.replaces")}>
            <span className="cvh-mono">
              {ext.replaces.map((r) => r.replace("tool:", "")).join(", ")}
            </span>
            {replaceConflict.length > 0 && (
              <span className="mt-0.5 block text-[12px] text-[var(--cs-color-warning-text)]">
                {t("desktop.craft.canvas.cvH.panel.replaceConflict")}
              </span>
            )}
          </Row>
        )}
      </Section>
      <Section
        title={t("desktop.craft.canvas.cvH.panel.relations")}
        glyph="relations"
        info={t("desktop.craft.canvas.cvH.panel.relationsInfo")}
      >
        {rels.length === 0 ? (
          <p className="text-[13px] text-[var(--cvh-ink-3)]">
            {t("desktop.craft.canvas.cvH.panel.noRelations")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {rels.map((r) => {
              const row = relationRow(r, name);
              const target = row.target;
              return (
                <li key={r.key}>
                  {target === null ? (
                    <span
                      className="flex items-center gap-2 px-1 py-1 text-[13px]"
                      style={row.warn ? { color: "var(--cs-color-warning-text)" } : undefined}
                    >
                      <Glyph name={row.glyph} size={12} />
                      {row.text}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="cvh-btn w-full justify-start px-1 text-[13px]"
                      onClick={() => {
                        actions.focus(target);
                      }}
                    >
                      <Glyph name={row.glyph} size={12} />
                      {row.text}
                      <span className="ml-auto text-[var(--cvh-ink-3)]">
                        <Glyph name="right" size={11} />
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title={t("desktop.craft.canvas.cvH.panel.source")} glyph="doc">
        <Row k={t("desktop.craft.canvas.cvH.panel.origin")}>{t(ORIGIN_WORD[ext.origin.kind])}</Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.version")}>
          <span className="cvh-mono">{ext.version}</span>
        </Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.hash")}>
          <span className="cvh-mono text-[12px]">{ext.currentHash ?? "—"}</span>
        </Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.review")}>
          {t(REVIEW_WORD[ext.review])}
          {ext.approvedAt !== null && (
            <span className="text-[var(--cvh-ink-3)]"> · {ext.approvedAt.slice(0, 10)}</span>
          )}
        </Row>
        {ext.origin.createdIn !== undefined && (
          <Row k={t("desktop.craft.canvas.cvH.panel.createdIn")}>
            <span className="cvh-mono text-[12px]">{ext.origin.createdIn.threadId}</span>
          </Row>
        )}
        <Row k={t("desktop.craft.canvas.cvH.panel.usedBy")}>{usedBy(name)}</Row>
      </Section>
      <Section
        title={t("desktop.craft.canvas.cvH.panel.usage")}
        glyph="loop"
        info={t("desktop.craft.canvas.cvH.panel.costInfo")}
      >
        <Row k={t("desktop.craft.canvas.cvH.panel.lastUsed")}>{lastUsed(p)}</Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.cost")}>
          {ext.cost.basis === "unknown" || ext.cost.always === null
            ? t("desktop.craft.canvas.cvH.panel.costUnknown")
            : t("desktop.craft.canvas.cvH.panel.costLine", {
                always: ext.cost.always,
                onDemand: ext.cost.onDemand ?? 0,
              })}
        </Row>
      </Section>
    </Shell>
  );
}

export function GroupPanel(props: {
  readonly id: string;
  readonly profile: CanvasProfile;
  readonly folded: boolean;
  readonly side: "left" | "right";
  readonly inset: number;
  readonly actions: PanelActions;
}): ReactElement | null {
  const { id, profile, actions } = props;
  const g = profile.groups.find((x) => x.id === id);
  const ext = GROUP_EXT[id];
  if (g === undefined || ext === undefined) return null;
  const head = (
    <div className="flex items-start gap-3 px-5 pt-4 pb-3">
      <span className="inline-flex size-9 items-center justify-center rounded-[8px] border-2 border-[var(--cvh-rail-soft)] text-[var(--cvh-ink-2)]">
        <Glyph name="group" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="cvh-mono truncate text-[20px] font-semibold text-[var(--cvh-ink)]">{id}</h2>
        <p className="mt-0.5 text-[13px] text-[var(--cvh-ink-2)]">
          {t("desktop.craft.canvas.cvH.group.title", { count: g.members.length })}
        </p>
      </div>
      <button
        type="button"
        className="cvh-icon-btn shrink-0"
        aria-label={t("desktop.craft.canvas.cvH.panel.close")}
        onClick={actions.close}
      >
        <Glyph name="close" size={13} />
      </button>
    </div>
  );
  const foot = (
    <>
      <button
        type="button"
        className="cvh-btn"
        style={{ color: "var(--cvh-ink)" }}
        onClick={() => {
          actions.toggleFold(id);
        }}
      >
        <Glyph name={props.folded ? "unfold" : "fold"} size={12} />
        {t(
          props.folded
            ? "desktop.craft.canvas.cvH.group.unfold"
            : "desktop.craft.canvas.cvH.group.fold",
          { name: id },
        )}
      </button>
      <button
        type="button"
        className="cvh-btn ml-auto"
        onClick={() => {
          actions.removeGroup(id);
        }}
      >
        <Glyph name="trash" size={12} />
        {t("desktop.craft.canvas.cvH.group.remove")}
      </button>
    </>
  );
  return (
    <Shell
      side={props.side}
      inset={props.inset}
      label={t("desktop.craft.canvas.cvH.panel.label", { name: id })}
      head={head}
      foot={foot}
      onClose={actions.close}
    >
      <section className="px-5 pt-1 pb-3.5">
        <p className="text-[15px] leading-[22px] text-[var(--cvh-ink)]">{t(ext.purpose)}</p>
      </section>
      <Section
        title={t("desktop.craft.canvas.cvH.group.membersTitle")}
        glyph="group"
        info={t("desktop.craft.canvas.cvH.group.rules")}
      >
        <ol className="flex flex-col gap-0.5">
          {g.members.map((m, i) => {
            const p = pluginOf(m);
            if (p === undefined) return null;
            return (
              <li key={m}>
                <button
                  type="button"
                  className="cvh-btn h-auto w-full justify-start gap-2.5 px-1.5 py-1.5"
                  onClick={() => {
                    actions.focus(m);
                  }}
                >
                  <span className="cvh-mono w-4 text-[11px] text-[var(--cvh-ink-3)]">{i + 1}</span>
                  <KindBadge kind={p.kind} size={20} />
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="cvh-mono text-[13px] text-[var(--cvh-ink)]">{m}</span>
                    <span className="text-[12px] text-[var(--cvh-ink-3)]">
                      {t(KIND_WORD[p.kind])} · {t(SLOT_WORD[slotOf(p)])}
                    </span>
                  </span>
                  <span className="ml-auto text-[var(--cvh-ink-3)]">
                    <Glyph name="right" size={11} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section title={t("desktop.craft.canvas.cvH.panel.source")} glyph="doc">
        <Row k={t("desktop.craft.canvas.cvH.group.extension")}>
          <span className="cvh-mono">{ext.extension}</span>
        </Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.origin")}>{t(ORIGIN_WORD[ext.origin])}</Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.version")}>
          <span className="cvh-mono">{ext.version}</span>
        </Row>
        <Row k={t("desktop.craft.canvas.cvH.panel.hash")}>
          <span className="cvh-mono text-[12px]">{ext.currentHash}</span>
        </Row>
      </Section>
    </Shell>
  );
}
