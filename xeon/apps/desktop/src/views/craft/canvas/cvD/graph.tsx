// cvD 프로필 그래프 그림: 줄기와 되돌아가는 길, 블록 판, 경계 고리, 붙음 선(직각), 핸드오프 고리(곡선 점선), 묶음 칸, 노드.
// 선은 SVG 한 장, 노드는 HTML 단추다(글자가 선명하고 초점·화면 읽기가 된다). 좌표는 model.ts의 격자를 그대로 쓴다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { DecisionGlyph, Icon, KIND_COLOR, KindBadge } from "./glyphs.tsx";
import {
  DRIVE_H,
  DRIVE_W,
  LOOP_X,
  PLATE_H,
  PLATE_W,
  TRUNK_X,
  type Chip,
  type GroupBox,
  type Handoff,
  type Layout,
  type Row,
  type Slot,
  type Wire,
} from "./model.ts";
import { pluginById, type Kind } from "./sample.ts";
import { BLOCK_WORD, BOUNDARY_WORD, DECISION_WORD, KIND_WORD, pointWord } from "./words.ts";

const INK = (pct: number): string =>
  `color-mix(in oklab, var(--cs-color-text-primary) ${pct}%, transparent)`;

// ── 선 ──────────────────────────────────────────────────────────

function roundedPath(points: readonly (readonly [number, number])[], r: number): string {
  if (points.length < 2) return "";
  const first = points[0];
  if (first === undefined) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const a = points[i - 1];
    const b = points[i + 1];
    if (p === undefined || a === undefined || b === undefined) continue;
    const inX = Math.sign(p[0] - a[0]);
    const inY = Math.sign(p[1] - a[1]);
    const outX = Math.sign(b[0] - p[0]);
    const outY = Math.sign(b[1] - p[1]);
    d += ` L${p[0] - inX * r} ${p[1] - inY * r} Q${p[0]} ${p[1]} ${p[0] + outX * r} ${p[1] + outY * r}`;
  }
  const last = points.at(-1);
  if (last !== undefined) d += ` L${last[0]} ${last[1]}`;
  return d;
}

function Marker(props: { readonly wire: Wire }): ReactNode {
  const end = props.wire.points.at(-1);
  if (end === undefined) return null;
  const [x, y] = end;
  if (props.wire.marker === "diamond")
    return (
      <path
        d={`M${x} ${y - 5.5}L${x + 5.5} ${y}L${x} ${y + 5.5}L${x - 5.5} ${y}Z`}
        fill="var(--cs-color-bg-canvas)"
        stroke={INK(70)}
        strokeWidth={1.25}
      />
    );
  if (props.wire.marker === "chevron") return <path d={`M${x + 1} ${y}l6 -4v8Z`} fill={INK(62)} />;
  if (props.wire.marker === "square")
    return <rect x={x + 1} y={y - 3} width={6} height={6} fill={INK(62)} />;
  return null;
}

/** 노드 쪽 끝의 작은 포트(교차점 표식) */
function Port(props: { readonly x: number; readonly y: number }): ReactElement {
  return (
    <rect
      x={props.x - 2.5}
      y={props.y - 2.5}
      width={5}
      height={5}
      fill="var(--cs-color-bg-canvas)"
      stroke={INK(55)}
      strokeWidth={1}
    />
  );
}

function HandoffRing(props: { readonly h: Handoff }): ReactElement {
  const { ax, bx, y } = props.h;
  const rise = 15;
  const out = `M${ax} ${y - 5} C${ax + 14} ${y - 5} ${ax + 14} ${y - rise} ${ax + 30} ${y - rise} L${bx - 30} ${y - rise} C${bx - 14} ${y - rise} ${bx - 14} ${y - 5} ${bx - 2} ${y - 5}`;
  const back = `M${bx} ${y + 5} C${bx - 14} ${y + 5} ${bx - 14} ${y + rise} ${bx - 30} ${y + rise} L${ax + 30} ${y + rise} C${ax + 14} ${y + rise} ${ax + 14} ${y + 5} ${ax + 2} ${y + 5}`;
  const color = KIND_COLOR.drive;
  return (
    <g>
      <path
        d={out}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <path
        d={back}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray="5 4"
        strokeLinecap="round"
        opacity={0.45}
      />
      <path
        d={`M${bx - 7} ${y - 9}L${bx - 1} ${y - 5}L${bx - 7} ${y - 1}`}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={`M${ax + 7} ${y + 1}L${ax + 1} ${y + 5}L${ax + 7} ${y + 9}`}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.6}
      />
    </g>
  );
}

/** 줄기, 되돌아가는 길, 기록으로 가는 점선, 붙음 선, 핸드오프 */
export function Wires(props: {
  readonly layout: Layout;
  readonly dragKind: Kind | null;
}): ReactElement {
  const L = props.layout;
  const loop: (readonly [number, number])[] = [
    [TRUNK_X, L.trunkBottom - 2],
    [TRUNK_X, L.trunkBottom + 10],
    [LOOP_X, L.trunkBottom + 10],
    [LOOP_X, L.loopEntry],
    [TRUNK_X - 8, L.loopEntry],
  ];
  const ghostRows = L.rows.filter((r) => r.ghost);
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={L.width}
      height={L.height}
    >
      {/* 되돌아가는 길(다음 턴) */}
      <path d={roundedPath(loop, 12)} fill="none" stroke={INK(20)} strokeWidth={1.5} />
      <path
        d={`M${TRUNK_X - 14} ${L.loopEntry - 4.5}L${TRUNK_X - 8} ${L.loopEntry}L${TRUNK_X - 14} ${L.loopEntry + 4.5}`}
        fill="none"
        stroke={INK(38)}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 기록: 모든 블록을 지켜보기만 한다 */}
      <path
        d={`M${TRUNK_X} ${L.trunkBottom + 10} V${L.recordY - PLATE_H / 2}`}
        stroke={INK(26)}
        strokeWidth={1.25}
        strokeDasharray="1.5 3.5"
        strokeLinecap="round"
      />
      {/* 줄기: 유리 막대처럼 겉 6px + 안쪽 밝은 선 */}
      <path
        d={`M${TRUNK_X} ${L.trunkTop} V${L.trunkBottom + 10}`}
        stroke={INK(16)}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        d={`M${TRUNK_X - 1} ${L.trunkTop + 4} V${L.trunkBottom + 6}`}
        stroke={INK(42)}
        strokeWidth={1.25}
        strokeLinecap="round"
      />
      {/* 끌어 놓는 동안 열린 빈 줄의 가지 */}
      {ghostRows.map((r) => (
        <GhostBranch key={r.key} row={r} kind={props.dragKind} />
      ))}
      {L.wires.map((w) => (
        <g key={w.key}>
          <path
            d={roundedPath(w.points, 8)}
            fill="none"
            stroke={INK(w.kind === "chain" ? 24 : 34)}
            strokeWidth={1}
          />
          {w.kind !== "chain" && w.points[0] !== undefined && (
            <Port x={w.points[0][0]} y={w.points[0][1]} />
          )}
          <Marker wire={w} />
        </g>
      ))}
      {L.handoffs.map((h) => (
        <HandoffRing key={h.key} h={h} />
      ))}
    </svg>
  );
}

function GhostBranch(props: { readonly row: Row; readonly kind: Kind | null }): ReactElement {
  const color = props.kind === null ? INK(30) : KIND_COLOR[props.kind];
  const y = props.row.y;
  return (
    <g opacity={0.8}>
      <path
        d={`M${TRUNK_X} ${y} H${TRUNK_X + 112}`}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path
        d={`M${TRUNK_X} ${y - 5.5}L${TRUNK_X + 5.5} ${y}L${TRUNK_X} ${y + 5.5}L${TRUNK_X - 5.5} ${y}Z`}
        fill="var(--cs-color-bg-canvas)"
        stroke={color}
        strokeWidth={1.25}
      />
    </g>
  );
}

// ── 블록 판과 경계 고리 ───────────────────────────────────────────

const BLOCK_INDEX: Readonly<Record<string, string>> = {
  context: "01",
  model: "02",
  tools: "03",
  ask: "04",
  agents: "05",
  record: "06",
};

export function Stations(props: {
  readonly layout: Layout;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  readonly nodeProps: (key: string) => { readonly tabIndex: number; readonly "data-node": string };
}): ReactElement {
  return (
    <>
      {props.layout.rows.map((r) => {
        if ((r.kind === "station" || r.kind === "record") && r.block !== null) {
          const key = `station:${r.block}`;
          const record = r.kind === "record";
          const attached = props.layout.chips.filter((c) => c.point === r.point).length;
          return (
            <button
              key={r.key}
              type="button"
              data-slot="cvd"
              {...props.nodeProps(key)}
              aria-label={t("desktop.craft.canvas.cvD.a11y.block", {
                name: t(BLOCK_WORD[r.block]),
                count: attached,
              })}
              aria-pressed={props.selected === key}
              onClick={() => props.onSelect(key)}
              className="absolute flex items-center gap-2 rounded-[3px] px-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
              style={{
                left: TRUNK_X - PLATE_W / 2,
                top: r.y - PLATE_H / 2,
                width: PLATE_W,
                height: PLATE_H,
                background: "var(--cs-color-surface-base)",
                border: `1px ${record ? "dashed" : "solid"} ${INK(record ? 16 : 14)}`,
                boxShadow: `inset 0 1px 0 ${INK(7)}, 0 0 0 3px var(--cs-color-bg-canvas)`,
                outline: props.selected === key ? `1.5px solid ${INK(80)}` : undefined,
                outlineOffset: 2,
              }}
            >
              <span className="font-mono text-[10px] text-text-tertiary tabular-nums">
                {BLOCK_INDEX[r.block]}
              </span>
              <span
                className={`truncate text-[12px] font-medium ${record ? "text-text-tertiary" : "text-text-secondary"}`}
              >
                {t(BLOCK_WORD[r.block])}
              </span>
            </button>
          );
        }
        if (r.kind === "boundary" && r.boundary !== null) {
          return (
            <div key={r.key} aria-hidden="true">
              <span
                className="absolute rounded-full"
                style={{
                  left: TRUNK_X - 6,
                  top: r.y - 6,
                  width: 12,
                  height: 12,
                  background: "var(--cs-color-bg-canvas)",
                  border: `1.5px solid ${INK(48)}`,
                }}
              />
              <span
                className="absolute text-right text-[11px] leading-4 whitespace-nowrap text-text-tertiary"
                style={{ right: `calc(100% - ${TRUNK_X - 14}px)`, top: r.y - 8 }}
              >
                {t(BOUNDARY_WORD[r.boundary])}
              </span>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

// ── 묶음 칸 ─────────────────────────────────────────────────────

export function Groups(props: {
  readonly layout: Layout;
  readonly names: ReadonlyMap<string, MessageId>;
  readonly selected: string | null;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (key: string) => void;
  readonly nodeProps: (key: string) => { readonly tabIndex: number; readonly "data-node": string };
}): ReactElement {
  return (
    <>
      {props.layout.groups.map((g) => (
        <GroupFrame key={g.id} {...props} g={g} />
      ))}
    </>
  );
}

function GroupFrame(props: {
  readonly g: GroupBox;
  readonly layout: Layout;
  readonly names: ReadonlyMap<string, MessageId>;
  readonly selected: string | null;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (key: string) => void;
  readonly nodeProps: (key: string) => { readonly tabIndex: number; readonly "data-node": string };
}): ReactElement {
  const { g } = props;
  const name = props.names.get(g.id);
  const key = `group:${g.id}`;
  const members = props.layout.chips.filter((c) => c.group === g.id);
  const corner = (pos: CSSProperties, rot: number): ReactElement => (
    <span
      aria-hidden="true"
      className="absolute size-2.5"
      style={{
        ...pos,
        borderTop: `1.5px solid ${INK(40)}`,
        borderLeft: `1.5px solid ${INK(40)}`,
        transform: `rotate(${rot}deg)`,
      }}
    />
  );
  const label = name === undefined ? g.id : t(name);
  return (
    <>
      {g.open ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: g.x,
            top: g.top,
            width: g.w,
            height: g.bottom - g.top,
            background: INK(2.2),
          }}
        >
          {corner({ left: -1, top: -1 }, 0)}
          {corner({ right: -1, top: -1 }, 90)}
          {corner({ right: -1, bottom: -1 }, 180)}
          {corner({ left: -1, bottom: -1 }, 270)}
        </div>
      ) : (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={1}
          height={1}
        >
          <path
            d={`M${g.x + g.w / 2} ${g.top + 28} V${g.bottom - 6}`}
            stroke={INK(34)}
            strokeWidth={2}
            strokeLinecap="round"
          />
          {members.map((m) => (
            <rect
              key={m.plugin}
              x={g.x + g.w / 2 - 3.5}
              y={m.y + m.h / 2 - 3.5}
              width={7}
              height={7}
              fill={INK(55)}
            />
          ))}
        </svg>
      )}
      <button
        type="button"
        data-slot="cvd"
        {...props.nodeProps(key)}
        aria-expanded={g.open}
        aria-label={t("desktop.craft.canvas.cvD.a11y.group", {
          name: label,
          count: g.members.length,
        })}
        onClick={() => props.onSelect(key)}
        onDoubleClick={() => props.onToggle(g.id)}
        className="absolute flex h-6 items-center gap-1.5 rounded-[6px] pr-1 pl-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
        style={{
          left: g.x + (g.open ? 8 : 0),
          top: g.top + 2,
          width: g.open ? g.w - 16 : 112,
          background: "var(--cs-color-surface-raised)",
          border: `1px solid ${INK(14)}`,
          boxShadow: g.open
            ? undefined
            : `3px 3px 0 -1px var(--cs-color-surface-base), 3px 3px 0 0 ${INK(14)}, 6px 6px 0 -1px var(--cs-color-surface-base), 6px 6px 0 0 ${INK(10)}`,
          outline: props.selected === key ? `1.5px solid ${INK(80)}` : undefined,
          outlineOffset: 2,
        }}
      >
        <span className="truncate text-[12px] font-medium text-text-secondary">{label}</span>
        <span className="font-mono text-[10px] text-text-tertiary tabular-nums">
          {g.members.length}
        </span>
        <span
          role="presentation"
          className="ml-auto inline-flex size-5 items-center justify-center rounded-[4px] text-text-tertiary hover:bg-[var(--cs-color-fill-hover)]"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle(g.id);
          }}
        >
          <Icon name={g.open ? "chevron-down" : "chevron-right"} size={12} />
        </span>
      </button>
    </>
  );
}

// ── 플러그인 노드 ─────────────────────────────────────────────────

/** Drive는 양끝이 뾰족한 육각, Inject는 알약, Hook은 각진 사각, 도구는 거의 직각 */
const SHAPE: Readonly<Record<Kind, string>> = {
  inject: "13px",
  hook: "5px",
  drive: "0",
  tool: "2px",
};
const HEX = "polygon(9px 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 9px 100%, 0 50%)";

function chipLabel(c: Chip): string {
  const p = pluginById(c.plugin);
  const parts = [c.plugin, t(KIND_WORD[c.kind])];
  if (c.start) parts.push(t("desktop.craft.canvas.cvD.startDrive"));
  else parts.push(t(pointWord(c.point)));
  if (p?.decision !== undefined) parts.push(t(DECISION_WORD[p.decision]));
  if (c.guard) parts.push(t("desktop.craft.canvas.cvD.guard"));
  if (c.origin === "base") parts.push(t("desktop.craft.canvas.cvD.base"));
  if (c.draft) parts.push(t("desktop.craft.canvas.cvD.draft"));
  return parts.join(", ");
}

/** 8px 자물쇠: 베이스에서 와서 이 프로필에서 뺄 수 없다 */
function BaseMark(): ReactElement {
  return (
    <svg
      width={9}
      height={10}
      viewBox="0 0 9 10"
      aria-hidden="true"
      className="shrink-0 text-text-tertiary"
    >
      <rect x="1" y="4.2" width="7" height="5" rx="1" fill="currentColor" />
      <path
        d="M2.6 4.2V3a1.9 1.9 0 0 1 3.8 0v1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
      />
    </svg>
  );
}

export function ChipBody(props: {
  readonly chip: Pick<Chip, "plugin" | "kind" | "guard" | "draft" | "origin" | "start">;
}): ReactElement {
  const c = props.chip;
  const p = pluginById(c.plugin);
  return (
    <>
      <KindBadge kind={c.kind} guard={c.guard} draft={c.draft} size={c.start ? 20 : 18} />
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[11px] ${c.draft ? "text-text-secondary" : "text-text-primary"}`}
      >
        {c.plugin}
      </span>
      {p?.decision !== undefined && (
        <span className="shrink-0 text-text-tertiary">
          <DecisionGlyph decision={p.decision} />
        </span>
      )}
      {c.origin === "base" && <BaseMark />}
    </>
  );
}

/** 노드 겉모양(모양·테두리). 육각은 clip-path 두 겹으로 테두리를 낸다 */
export function ChipShell(props: {
  readonly kind: Kind;
  readonly draft: boolean;
  readonly selected: boolean;
  readonly start: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const border = props.selected
    ? INK(85)
    : props.start
      ? `color-mix(in oklab, ${KIND_COLOR.drive} 55%, transparent)`
      : INK(15);
  const fill = props.start
    ? `linear-gradient(180deg, color-mix(in oklab, ${KIND_COLOR.drive} 9%, var(--cs-color-surface-raised)), var(--cs-color-surface-raised))`
    : "var(--cs-color-surface-raised)";
  if (props.kind === "drive")
    return (
      <span className="absolute inset-0" style={{ clipPath: HEX, background: border }}>
        <span
          className="absolute inset-px flex items-center gap-1.5 pr-3 pl-2.5"
          style={{ clipPath: HEX, background: fill }}
        >
          {props.children}
        </span>
      </span>
    );
  return (
    <span
      className="absolute inset-0 flex items-center gap-1 pr-2 pl-1"
      style={{
        borderRadius: SHAPE[props.kind],
        background: fill,
        border: `1px ${props.draft ? "dashed" : "solid"} ${props.draft ? INK(36) : border}`,
        boxShadow: `inset 0 1px 0 ${INK(6)}${props.selected ? `, 0 0 0 3px ${INK(10)}` : ""}`,
      }}
    >
      {props.children}
    </span>
  );
}

export function Chips(props: {
  readonly layout: Layout;
  readonly selected: string | null;
  readonly dimmed: string | null;
  readonly onSelect: (key: string) => void;
  readonly onOpen: (plugin: string) => void;
  readonly onHover: (plugin: string | null) => void;
  readonly onDragStart: (plugin: string, e: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly nodeProps: (key: string) => { readonly tabIndex: number; readonly "data-node": string };
}): ReactElement {
  return (
    <>
      {props.layout.chips
        .filter((c) => !c.hidden)
        .map((c) => {
          const key = `plugin:${c.plugin}`;
          const selected = props.selected === key;
          return (
            <button
              key={`${c.plugin}@${c.point}`}
              type="button"
              data-slot="cvd"
              {...props.nodeProps(key)}
              data-plugin={c.plugin}
              aria-label={chipLabel(c)}
              aria-pressed={selected}
              onClick={() => props.onSelect(key)}
              onDoubleClick={() => props.onOpen(c.plugin)}
              onPointerEnter={() => props.onHover(c.plugin)}
              onPointerLeave={() => props.onHover(null)}
              onFocus={() => props.onHover(c.plugin)}
              onBlur={() => props.onHover(null)}
              onPointerDown={(e) => props.onDragStart(c.plugin, e)}
              className="absolute block text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--cs-color-focus-ring)]"
              style={{
                left: c.x,
                top: c.y,
                width: c.w,
                height: c.h,
                opacity: props.dimmed === c.plugin ? 0.35 : 1,
              }}
            >
              <ChipShell kind={c.kind} draft={c.draft} selected={selected} start={c.start}>
                <ChipBody chip={c} />
              </ChipShell>
              {c.start && (
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 -translate-x-1/2 text-[10px] leading-3 font-medium whitespace-nowrap"
                  style={{ top: -15, color: KIND_COLOR.drive }}
                >
                  {t("desktop.craft.canvas.cvD.startDrive")}
                </span>
              )}
            </button>
          );
        })}
    </>
  );
}

/** 가리키거나 초점이 오면 노드가 펼쳐진다: 종류·자리·결정과 최근 사용 한 줄 */
export function HoverCard(props: { readonly chip: Chip }): ReactElement {
  const c = props.chip;
  const p = pluginById(c.plugin);
  const where = c.start ? t("desktop.craft.canvas.cvD.startDrive") : t(pointWord(c.point));
  const tags: string[] = [];
  if (c.guard) tags.push(t("desktop.craft.canvas.cvD.guard"));
  if (c.origin === "base") tags.push(t("desktop.craft.canvas.cvD.base"));
  if (c.draft) tags.push(t("desktop.craft.canvas.cvD.draftPending"));
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 rounded-[10px] p-2.5 motion-safe:animate-[craft-fade_120ms_ease-out]"
      style={{
        left: c.x - 4,
        top: c.y - 4,
        width: Math.max(c.w + 8, 236),
        background: "var(--cs-color-surface-raised)",
        border: `1px solid ${INK(16)}`,
        boxShadow: "var(--cs-elevation-3)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <KindBadge kind={c.kind} guard={c.guard} draft={c.draft} />
        <span className="truncate font-mono text-[11.5px] text-text-primary">{c.plugin}</span>
        <span className="ml-auto text-[11px]" style={{ color: KIND_COLOR[c.kind] }}>
          {t(KIND_WORD[c.kind])}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-text-secondary">
        <span>{where}</span>
        {p?.decision !== undefined && (
          <>
            <span className="text-text-tertiary">·</span>
            <span className="inline-flex items-center gap-1">
              <DecisionGlyph decision={p.decision} />
              {t(DECISION_WORD[p.decision])}
            </span>
          </>
        )}
        {tags.length > 0 && <span className="ml-auto text-text-tertiary">{tags.join(" · ")}</span>}
      </div>
      {p !== undefined && (
        <div className="mt-1 text-[11px] text-text-tertiary">
          {t("desktop.craft.canvas.cvD.recent", { when: t(p.recent) })}
        </div>
      )}
    </div>
  );
}

// ── 놓을 자리 ────────────────────────────────────────────────────

export function Slots(props: {
  readonly slots: readonly Slot[];
  readonly active: string | null;
  readonly kind: Kind;
  readonly emptyStart: boolean;
}): ReactElement {
  const color = KIND_COLOR[props.kind];
  return (
    <>
      {props.slots.map((s) => {
        const on = props.active === s.key;
        const bar = s.w < 20;
        return (
          <span
            key={s.key}
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              borderRadius: bar ? 3 : s.asStart ? 4 : SHAPE[props.kind],
              border: bar ? undefined : `1px dashed ${color}`,
              background: bar
                ? on
                  ? color
                  : `color-mix(in oklab, ${color} 30%, transparent)`
                : `color-mix(in oklab, ${color} ${on ? 22 : 7}%, transparent)`,
              boxShadow: on
                ? `0 0 0 3px color-mix(in oklab, ${color} 18%, transparent)`
                : undefined,
            }}
          />
        );
      })}
    </>
  );
}

/** 스타트 Drive가 없을 때 줄기 머리의 빈 육각 */
export function EmptyStart(props: { readonly layout: Layout }): ReactNode {
  if (!props.layout.emptyStart) return null;
  const y = props.layout.trunkTop;
  return (
    <div
      aria-hidden="true"
      className="absolute flex items-center justify-center text-[11px] text-text-tertiary"
      style={{ left: TRUNK_X - DRIVE_W / 2, top: y - DRIVE_H / 2, width: DRIVE_W, height: DRIVE_H }}
    >
      <svg className="absolute inset-0" width={DRIVE_W} height={DRIVE_H} aria-hidden="true">
        <path
          d={`M9.5 0.5 H${DRIVE_W - 9.5} L${DRIVE_W - 0.5} ${DRIVE_H / 2} L${DRIVE_W - 9.5} ${DRIVE_H - 0.5} H9.5 L0.5 ${DRIVE_H / 2}Z`}
          fill="var(--cs-color-bg-canvas)"
          stroke={INK(30)}
          strokeDasharray="3 3"
        />
      </svg>
      <span className="relative">{t("desktop.craft.canvas.cvD.startDrive")}</span>
    </div>
  );
}
