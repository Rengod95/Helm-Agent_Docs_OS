// cvH의 React Flow 노드: 선로(본선·지선, 한 장의 SVG), 관계 선, 정거장, 플러그인 카드(역 표지판), 묶음 역(펼침 틀·접힌 역),
// 드래프트의 출처, 대체된 블록 부품. 카드는 확대 단계(`tierOf`)에 따라 보이는 양을 바꾼다: 멀리 이름표, 가운데 하는 일 한 줄, 가까이 전부.
// 확대 단계는 React Flow 저장소에서 단계 값만 골라 읽어(바뀔 때만 다시 그린다) 이동·확대 중에 카드를 다시 그리지 않는다.
import { t } from "@fresnel/client/i18n";
import { useViewportStore, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { createContext, use, type Context, type ReactElement } from "react";
import type { SharedPlugin } from "../shared-sample.ts";
import { componentFacts, lastUsed, whereText, type Fact } from "./facts.ts";
import { Glyph, KIND_COLOR, KindBadge, KindGlyph, RiskGauge } from "./glyphs.tsx";
import {
  CARD_H,
  CARD_W,
  INTERCHANGE_H,
  INTERCHANGE_W,
  PILL_HALF,
  QUIET_HALF,
  isBlock,
  pluginOf,
  tierOf,
  type Kind,
  type PartPlace,
  type RailPath,
  type Rect,
  type RelationPath,
  type SlotId,
  type Tier,
} from "./model.ts";
import { extOf, GROUP_EXT } from "./sample-ext.ts";
import { KIND_WORD, RELATION_WORD, RISK_WORD, SLOT_WORD, STEP_WORD } from "./words.ts";

// ── 공용 동작 ────────────────────────────────────────────────────────

export interface CanvasActions {
  readonly select: (key: string) => void;
  readonly enter: (name: string) => void;
  readonly toggleFold: (group: string) => void;
}

export const CanvasActionsContext: Context<CanvasActions> = createContext<CanvasActions>({
  select: () => undefined,
  enter: () => undefined,
  toggleFold: () => undefined,
});

/** 확대 단계(바뀔 때만 다시 그린다) */
function useTier(): Tier {
  return useViewportStore((s) => tierOf(s.transform[2]));
}

// ── 선로 ─────────────────────────────────────────────────────────────

type RailsNode = Node<
  {
    readonly rails: readonly RailPath[];
    readonly bounds: Rect;
    readonly hot: ReadonlySet<string> | null;
  },
  "rails"
>;

function railStroke(r: RailPath): string {
  if (r.kind === null) return "var(--cvh-rail)";
  return KIND_COLOR[r.kind];
}

function RailsView(props: NodeProps<RailsNode>): ReactElement {
  const { rails, bounds, hot } = props.data;
  return (
    <svg
      width={bounds.w}
      height={bounds.h}
      viewBox={`${String(bounds.x)} ${String(bounds.y)} ${String(bounds.w)} ${String(bounds.h)}`}
      className="cvh-rails block overflow-visible"
      data-dim={hot === null ? "false" : "true"}
      aria-hidden="true"
    >
      {rails.map((r) => (
        <path
          key={r.key}
          d={r.d}
          className={`cvh-rail-${r.role}${r.owner === null ? "" : " cvh-rail-owned"}`}
          data-hot={r.owner !== null && hot?.has(r.owner) === true ? "true" : "false"}
          style={r.role === "trunk" || r.role === "return" ? undefined : { stroke: railStroke(r) }}
        />
      ))}
    </svg>
  );
}

// ── 관계 선 ──────────────────────────────────────────────────────────

type RelationsNode = Node<
  {
    readonly relations: readonly RelationPath[];
    readonly bounds: Rect;
    readonly hot: ReadonlySet<string> | null;
    readonly showAll: boolean;
  },
  "relations"
>;

function RelationEnd(props: { readonly rel: RelationPath }): ReactElement | null {
  const { end, kind } = props.rel;
  const at = `translate(${String(end.x)} ${String(end.y)}) rotate(${String(end.angle)})`;
  if (kind === "handoff")
    return (
      <path
        d="M-9 -5 L0 0 L-9 5"
        transform={at}
        className="cvh-rel"
        data-kind="handoff"
        style={{ strokeDasharray: "none" }}
      />
    );
  if (kind === "depends")
    return (
      <circle
        cx={end.x}
        cy={end.y}
        r={4.5}
        fill="var(--cvh-ground)"
        className="cvh-rel"
        style={{
          strokeDasharray: "none",
          stroke: props.rel.unmet ? "var(--cs-color-warning-text)" : undefined,
        }}
      />
    );
  if (kind === "replaces")
    return (
      <path
        d="M-8 -4 L0 0 L-8 4"
        transform={at}
        className="cvh-rel"
        style={{ strokeDasharray: "none" }}
      />
    );
  return <circle cx={end.x} cy={end.y} r={3} fill="var(--cvh-ink-3)" />;
}

function relationLabel(rel: RelationPath): string {
  if (rel.kind === "depends" && rel.unmet)
    return t("desktop.craft.canvas.cvH.rel.unmet", { capability: rel.via ?? "" });
  if (rel.kind === "depends" || rel.kind === "replaces")
    return `${t(RELATION_WORD[rel.kind])} · ${(rel.via ?? "").replace("tool:", "")}`;
  return t(RELATION_WORD[rel.kind]);
}

function RelationsView(props: NodeProps<RelationsNode>): ReactElement {
  const { relations, bounds, hot, showAll } = props.data;
  const touches = (r: RelationPath): boolean =>
    hot !== null &&
    (hot.has(r.from) || (r.to !== null && hot.has(r.to)) || hot.has(r.from.replace("seed:", "")));
  const shown = relations.filter((r) => r.kind === "handoff" || showAll || touches(r));
  return (
    <svg
      width={bounds.w}
      height={bounds.h}
      viewBox={`${String(bounds.x)} ${String(bounds.y)} ${String(bounds.w)} ${String(bounds.h)}`}
      className="cvh-relations block overflow-visible"
      data-dim={hot === null ? "false" : "true"}
      aria-hidden="true"
    >
      {shown.map((r) => {
        const label = relationLabel(r);
        const w = label.length * 6.6 + 14;
        return (
          <g key={r.key} className="cvh-rel-item" data-hot={touches(r) ? "true" : "false"}>
            <path
              d={r.d}
              className="cvh-rel"
              data-kind={r.kind}
              data-unmet={r.unmet ? "true" : "false"}
            />
            <RelationEnd rel={r} />
            <g transform={`translate(${String(r.label.x)} ${String(r.label.y)})`}>
              <rect
                x={-w / 2}
                y={-9}
                width={w}
                height={18}
                rx={9}
                fill="var(--cvh-ground)"
                stroke="var(--cvh-hair)"
              />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontSize={11}
                fill={
                  r.unmet
                    ? "var(--cs-color-warning-text)"
                    : r.kind === "handoff"
                      ? "var(--cvh-drive)"
                      : "var(--cvh-ink-2)"
                }
              >
                {label}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// ── 정거장 ───────────────────────────────────────────────────────────

type StationNode = Node<
  { readonly slot: SlotId; readonly index: number; readonly used: boolean },
  "station"
>;

interface Box {
  readonly w: number;
  readonly h: number;
}

export const STATION_BOX: Box = { w: PILL_HALF * 2, h: 36 };
export const QUIET_BOX: Box = { w: QUIET_HALF * 2, h: 28 };
export const CROSSING_BOX: Box = { w: 132, h: 60 };

function StationView(props: NodeProps<StationNode>): ReactElement {
  const { slot, index, used } = props.data;
  const tier = useTier();
  if (isBlock(slot) && !used) {
    // 닿는 것이 없는 블록: 작고 흐린 알약. 번호 없이 이름만
    return (
      <div
        className="flex items-center justify-center rounded-full border-2 px-2"
        style={{
          width: QUIET_BOX.w,
          height: QUIET_BOX.h,
          borderColor: "var(--cvh-rail-soft)",
          background: "var(--cvh-ground)",
        }}
      >
        <span
          className={`truncate text-[var(--cvh-ink-3)] ${tier === "near" ? "text-[11px]" : "text-[14px]"}`}
        >
          {t(SLOT_WORD[slot])}
        </span>
      </div>
    );
  }
  if (isBlock(slot)) {
    return (
      <div
        className="flex items-center justify-center gap-2 rounded-full border-[3px] px-3"
        style={{
          width: STATION_BOX.w,
          height: STATION_BOX.h,
          borderColor: "var(--cvh-rail)",
          background: "var(--cvh-ground)",
        }}
      >
        {tier === "near" && (
          <span className="cvh-mono shrink-0 text-[11px] whitespace-nowrap text-[var(--cvh-ink-3)] tabular-nums">
            {String(index).padStart(2, "0")}
          </span>
        )}
        <span
          className={`truncate whitespace-nowrap font-medium text-[var(--cvh-ink)] ${tier === "far" ? "text-[17px]" : tier === "mid" ? "text-[14.5px]" : "text-[13px]"}`}
        >
          {t(SLOT_WORD[slot])}
        </span>
      </div>
    );
  }
  const boundary =
    slot === "conversation-start" || slot === "input-received" || slot === "before-turn-end";
  // 경계는 본선 위 둥근 표, Hook 자리는 건널목(마름모). 이름은 본선 위에 작게(빈 건널목은 이름 없이 흐리게)
  return (
    <div className="relative" style={{ width: CROSSING_BOX.w, height: CROSSING_BOX.h }}>
      {(boundary || used) && (
        <span
          className={`absolute left-1/2 -translate-x-1/2 truncate text-center ${tier === "far" ? "text-[15px]" : tier === "mid" ? "text-[13px]" : "text-[11px]"}`}
          style={{
            top: 0,
            maxWidth: CROSSING_BOX.w,
            color: used ? "var(--cvh-ink-2)" : "var(--cvh-ink-3)",
          }}
        >
          {t(SLOT_WORD[slot])}
        </span>
      )}
      {boundary ? (
        <span
          className="absolute rounded-full border-[3px]"
          style={{
            left: CROSSING_BOX.w / 2 - 9,
            top: CROSSING_BOX.h / 2 - 9,
            width: 18,
            height: 18,
            borderColor: "var(--cvh-rail)",
            background: slot === "conversation-start" ? "var(--cvh-rail)" : "var(--cvh-ground)",
          }}
        />
      ) : (
        <span
          className="absolute rotate-45 border-2"
          style={{
            left: CROSSING_BOX.w / 2 - 6,
            top: CROSSING_BOX.h / 2 - 6,
            width: 12,
            height: 12,
            borderColor: used ? "var(--cvh-hook)" : "var(--cvh-rail-soft)",
            background: "var(--cvh-ground)",
          }}
        />
      )}
    </div>
  );
}

// ── 카드 ─────────────────────────────────────────────────────────────

interface CardMarks {
  readonly base: boolean;
  readonly start: boolean;
  readonly order: number;
  readonly group: string | null;
  readonly relations: number;
  readonly unmet: string | null;
}

type PluginNode = Node<
  {
    readonly name: string;
    readonly marks: CardMarks;
    readonly selected: boolean;
    readonly spot: number;
  },
  "plugin"
>;

function FactChip(props: { readonly fact: Fact; readonly big: boolean }): ReactElement {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 rounded-[6px] bg-[var(--cs-color-fill-hover)] px-1.5 py-[2px] text-[var(--cvh-ink-2)] ${props.big ? "text-[13.5px]" : "text-[11.5px]"}`}
    >
      <span className="shrink-0 text-[var(--cvh-ink-3)]">
        <Glyph name={props.fact.glyph} size={props.big ? 13 : 11} />
      </span>
      <span className={`truncate ${props.fact.mono ? "cvh-mono" : ""}`}>{props.fact.text}</span>
    </span>
  );
}

/** Drive 카드의 작은 노선: 단계가 정거장, 나란한 단계는 겹선 ×n, 끝의 화살은 핸드오프 */
function StepStrip(props: { readonly p: SharedPlugin }): ReactElement | null {
  const steps = props.p.steps ?? [];
  if (steps.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-[var(--cvh-ink-2)]">
      {steps.map((s, i) => (
        <span key={s.id} className="flex min-w-0 items-center gap-1">
          {i > 0 && (
            <span className="h-[2px] w-2.5 shrink-0" style={{ background: "var(--cvh-drive)" }} />
          )}
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full border-[1.5px] px-1.5 leading-[16px]"
            style={{ borderColor: "var(--cvh-drive)" }}
          >
            {t(STEP_WORD[s.id])}
            {s.parallel > 1 && (
              <span className="cvh-mono text-[10px] text-[var(--cvh-ink-3)]">×{s.parallel}</span>
            )}
          </span>
        </span>
      ))}
      <span className="shrink-0 text-[var(--cvh-ink-3)]">
        <Glyph name="loop" size={11} />
      </span>
    </span>
  );
}

function StatusMarks(props: {
  readonly p: SharedPlugin;
  readonly marks: CardMarks;
  readonly big: boolean;
}): ReactElement {
  const ext = extOf(props.p.name);
  const size = props.big ? "text-[13px]" : "text-[11px]";
  return (
    <span className={`flex shrink-0 items-center gap-1.5 ${size}`}>
      {props.marks.start && (
        <span className="inline-flex items-center gap-1" style={{ color: "var(--cvh-drive)" }}>
          <Glyph name="start" size={11} />
          {t("desktop.craft.canvas.cvH.mark.start")}
        </span>
      )}
      {props.marks.base && (
        <span className="inline-flex items-center gap-1 text-[var(--cvh-ink-3)]">
          <Glyph name="lock" size={11} />
          {t("desktop.craft.canvas.cvH.mark.base")}
        </span>
      )}
      {ext?.review === "draft" && (
        <span className="text-[var(--cs-color-warning-text)]">
          {t("desktop.craft.canvas.cvH.review.draft")}
        </span>
      )}
      {ext?.review === "pending" && (
        <span className="text-[var(--cs-color-warning-text)]">
          {t("desktop.craft.canvas.cvH.review.pending")}
        </span>
      )}
    </span>
  );
}

function CardView(props: NodeProps<PluginNode>): ReactElement | null {
  const { name, marks, selected, spot } = props.data;
  const p = pluginOf(name);
  const tier = useTier();
  const actions = use(CanvasActionsContext);
  if (p === undefined) return null;
  const color = KIND_COLOR[p.kind];
  const ext = extOf(name);
  const draft = ext?.review === "draft";
  return (
    <div
      className="cvh-card relative flex flex-col"
      data-selected={selected ? "true" : "false"}
      data-draft={draft ? "true" : "false"}
      data-spot={spot > 0 ? "true" : "false"}
      // 같은 노드를 다시 골라도 표시가 다시 돌게 한다
      key={spot}
      data-plugin={name}
      style={{ width: CARD_W, height: CARD_H }}
      onDoubleClick={() => {
        actions.enter(name);
      }}
    >
      <div className="cvh-band shrink-0" style={{ background: color }} />
      {tier === "far" ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <KindBadge kind={p.kind} size={38} draft={draft} guard={p.guard === true} />
            <span className="cvh-mono truncate text-[26px] font-semibold text-[var(--cvh-ink)]">
              {name}
            </span>
          </div>
          <div className="flex items-center justify-between text-[17px] text-[var(--cvh-ink-2)]">
            <span>{t(SLOT_WORD_FOR(p))}</span>
            <StatusMarks p={p} marks={marks} big />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-3.5 pt-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <KindBadge
              kind={p.kind}
              size={tier === "mid" ? 26 : 22}
              draft={draft}
              guard={p.guard === true}
            />
            <span
              className={`cvh-mono min-w-0 flex-1 truncate font-semibold text-[var(--cvh-ink)] ${tier === "mid" ? "text-[19px]" : "text-[15.5px]"}`}
            >
              {name}
            </span>
            <StatusMarks p={p} marks={marks} big={tier === "mid"} />
          </div>
          <div
            className={`mt-1 truncate text-[var(--cvh-ink-3)] ${tier === "mid" ? "text-[14px]" : "text-[12px]"}`}
          >
            {whereText(p)}
            {marks.group !== null && (
              <span>
                {" · "}
                {t("desktop.craft.canvas.cvH.mark.order", { order: marks.order })}
              </span>
            )}
          </div>
          <p
            // 중간 단계에서 경고 줄이 붙으면 쓰임새는 한 줄로 줄인다(카드 높이는 그대로)
            className={`mt-1.5 text-[var(--cvh-ink-2)] ${tier === "mid" && marks.unmet !== null ? "line-clamp-1" : "line-clamp-2"} ${tier === "mid" ? "text-[16.5px] leading-[22px]" : "text-[13px] leading-[18px]"}`}
          >
            {ext === undefined ? "" : t(ext.purpose)}
          </p>
          <div
            className="mt-auto flex min-w-0 flex-wrap items-center gap-1 overflow-hidden"
            style={{ maxHeight: tier === "mid" ? 26 : 22 }}
          >
            {p.kind === "drive" ? (
              <StepStrip p={p} />
            ) : (
              componentFacts(p).map((f) => (
                <FactChip key={`${f.glyph}:${f.text}`} fact={f} big={tier === "mid"} />
              ))
            )}
          </div>
          {tier === "near" && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--cvh-ink-3)]">
              <RiskGauge risk={p.risk} />
              <span>{t(RISK_WORD[p.risk])}</span>
              <span className="text-[var(--cvh-hair)]">|</span>
              <span className="truncate">{lastUsed(p)}</span>
              {marks.unmet !== null && (
                <span className="ml-auto inline-flex items-center gap-1 text-[var(--cs-color-warning-text)]">
                  <Glyph name="warn" size={11} />
                  {marks.unmet}
                </span>
              )}
              {marks.unmet === null && marks.relations > 0 && (
                <span className="ml-auto inline-flex items-center gap-1">
                  <Glyph name="relations" size={11} />
                  {marks.relations}
                </span>
              )}
            </div>
          )}
          {tier === "mid" && marks.unmet !== null && (
            <div className="mt-1 inline-flex items-center gap-1 text-[13px] text-[var(--cs-color-warning-text)]">
              <Glyph name="warn" size={12} />
              {marks.unmet}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SLOT_WORD_FOR(p: SharedPlugin): (typeof SLOT_WORD)[SlotId] {
  if (p.kind === "inject") return SLOT_WORD.context;
  if (p.kind === "tool") return SLOT_WORD.tools;
  if (p.kind === "drive") return SLOT_WORD["input-received"];
  return SLOT_WORD[p.point ?? "tools.before"];
}

// ── 묶음 역 ──────────────────────────────────────────────────────────

type GroupNode = Node<
  {
    readonly id: string;
    readonly members: readonly string[];
    readonly folded: boolean;
    readonly selected: boolean;
    readonly spot: number;
  },
  "group"
>;

/** 묶음에 든 노선(구성원 종류)의 작은 표. 환승역의 노선 표처럼 */
function LineBadges(props: {
  readonly members: readonly string[];
  readonly size: number;
}): ReactElement {
  return (
    <span className="flex items-center gap-1">
      {props.members.map((m) => {
        const p = pluginOf(m);
        return p === undefined ? null : <KindBadge key={m} kind={p.kind} size={props.size} />;
      })}
    </span>
  );
}

function GroupView(props: NodeProps<GroupNode>): ReactElement {
  const { id, members, folded, selected, spot } = props.data;
  const tier = useTier();
  const actions = use(CanvasActionsContext);
  const ext = GROUP_EXT[id];
  const big = tier === "far";
  const foldButton = (
    <button
      type="button"
      className="cvh-icon-btn nodrag shrink-0"
      aria-label={t(
        folded ? "desktop.craft.canvas.cvH.group.unfold" : "desktop.craft.canvas.cvH.group.fold",
        { name: id },
      )}
      title={t(
        folded ? "desktop.craft.canvas.cvH.group.unfold" : "desktop.craft.canvas.cvH.group.fold",
        { name: id },
      )}
      onClick={(e) => {
        e.stopPropagation();
        actions.toggleFold(id);
      }}
    >
      <Glyph name={folded ? "unfold" : "fold"} size={13} />
    </button>
  );
  const head = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-[var(--cvh-ink-2)]">
        <Glyph name="group" size={big ? 22 : 15} />
      </span>
      <span
        className={`cvh-mono truncate font-semibold text-[var(--cvh-ink)] ${big ? "text-[24px]" : "text-[15px]"}`}
      >
        {id}
      </span>
      <LineBadges members={members} size={big ? 26 : 18} />
      <span
        className={`ml-auto shrink-0 text-[var(--cvh-ink-3)] ${big ? "text-[16px]" : "text-[12px]"}`}
      >
        {t("desktop.craft.canvas.cvH.group.members", { count: members.length })}
      </span>
      {foldButton}
    </div>
  );
  if (folded) {
    return (
      <div
        key={spot}
        data-group={id}
        className="cvh-card flex flex-col justify-center gap-1.5 px-3.5"
        data-selected={selected ? "true" : "false"}
        data-spot={spot > 0 ? "true" : "false"}
        style={{
          width: INTERCHANGE_W,
          height: INTERCHANGE_H,
          borderWidth: 2,
          borderColor: "var(--cvh-rail-soft)",
          borderRadius: 18,
        }}
      >
        {/* 환승역: 첫 줄은 이름과 펼치기, 둘째 줄은 이 역에 서는 노선(구성원 종류)과 수 */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[var(--cvh-ink-2)]">
            <Glyph name="group" size={big ? 22 : 17} />
          </span>
          <span
            className={`cvh-mono min-w-0 flex-1 truncate font-semibold text-[var(--cvh-ink)] ${big ? "text-[26px]" : "text-[19px]"}`}
          >
            {id}
          </span>
          {foldButton}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <LineBadges members={members} size={big ? 26 : 22} />
          <span
            className={`shrink-0 text-[var(--cvh-ink-2)] ${big ? "text-[17px]" : "text-[14px]"}`}
          >
            {t("desktop.craft.canvas.cvH.group.members", { count: members.length })}
          </span>
          {!big && (
            <span className="cvh-mono ml-auto truncate text-[12px] text-[var(--cvh-ink-3)]">
              {ext === undefined ? "" : `v${ext.version}`}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      key={spot}
      data-group={id}
      className="flex h-full w-full flex-col rounded-[18px] px-[18px] pt-2.5"
      data-spot={spot > 0 ? "true" : "false"}
      style={{
        width: props.width,
        height: props.height,
        border: `2px solid ${selected ? "var(--cvh-ink-2)" : "var(--cvh-rail-soft)"}`,
        background: "color-mix(in oklab, var(--cvh-ink) 3%, transparent)",
      }}
    >
      {head}
    </div>
  );
}

// ── 드래프트의 출처, 대체된 부품 ──────────────────────────────────────

type SeedNode = Node<{ readonly threadId: string; readonly tool: string }, "seed">;

function SeedView(props: NodeProps<SeedNode>): ReactElement {
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-0.5 rounded-[12px] border border-dashed px-3"
      style={{
        borderColor: "var(--cvh-ink-3)",
        background: "var(--cvh-ground)",
        width: props.width,
        height: props.height,
      }}
    >
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--cvh-ink-2)]">
        <Glyph name="seed" size={12} />
        {t("desktop.craft.canvas.cvH.seed.title")}
      </span>
      <span className="cvh-mono truncate text-[10.5px] text-[var(--cvh-ink-3)]">
        {props.data.threadId} · {props.data.tool}
      </span>
    </div>
  );
}

type PartNode = Node<{ readonly part: PartPlace }, "part">;

function PartView(props: NodeProps<PartNode>): ReactElement {
  const { part } = props.data;
  const conflict = part.by.length > 1;
  return (
    <span
      className="cvh-chip"
      style={{
        background: "var(--cvh-ground)",
        borderColor: conflict ? "var(--cs-color-warning-text)" : "var(--cvh-rail-soft)",
        color: conflict ? "var(--cs-color-warning-text)" : "var(--cvh-ink-2)",
      }}
    >
      <Glyph name="replace" size={11} />
      <span className="cvh-mono">{part.part.replace("tool:", "")}</span>
    </span>
  );
}

// ── 빈 자리(빈 프로필) ────────────────────────────────────────────────

type SocketNode = Node<{ readonly kind: Kind }, "socket">;

function SocketView(props: NodeProps<SocketNode>): ReactElement {
  const color = KIND_COLOR[props.data.kind];
  return (
    <div
      className="flex h-full w-full items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed text-[13px]"
      style={{
        borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
        color,
        width: props.width,
        height: props.height,
      }}
    >
      <KindGlyph kind={props.data.kind} size={14} />
      {t("desktop.craft.canvas.cvH.socket", { kind: t(KIND_WORD[props.data.kind]) })}
    </div>
  );
}

export const NODE_TYPES: NodeTypes = {
  rails: RailsView,
  relations: RelationsView,
  station: StationView,
  plugin: CardView,
  group: GroupView,
  seed: SeedView,
  part: PartView,
  socket: SocketView,
};

export type CanvasNode =
  | RailsNode
  | RelationsNode
  | StationNode
  | PluginNode
  | GroupNode
  | SeedNode
  | PartNode
  | SocketNode;

/** 화면 낭독기와 툴팁에 쓰는 카드 한 줄 */
export function cardLabel(name: string): string {
  const p = pluginOf(name);
  if (p === undefined) return name;
  const ext = extOf(name);
  return `${name}, ${whereText(p)}${ext === undefined ? "" : `. ${t(ext.purpose)}`}`;
}
