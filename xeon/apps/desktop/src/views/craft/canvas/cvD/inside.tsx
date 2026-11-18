// cvD 플러그인 내부: 프로필 노드를 열면 들어오는 화면. 위쪽 경로로 프로필에 돌아간다.
// 왼쪽 "붙는 곳"은 프로필 캔버스와 같은 문법의 작은 줄기 조각이고(이 플러그인이 턴의 어디에 붙나),
// 가운데는 플러그인 몸(종류마다 다르다), 오른쪽은 설정과 권한이다.
//   Drive: 자기 줄기(Drive 색) 위의 단계 판, 병렬 갈래(×n), 핸드오프 고리, 되돌아가는 길
//   Hook: 핸들러(문) 하나와 결정 갈래(통과, 막기·대체·묻기)
//   Inject: 지침 문서, 스킬 선반, 메모리. 모두 컨텍스트 조립으로 들어간다
//   도구: MCP 서버 상자와 그 안의 도구 칩(쓰기 도구는 표식)
import { t, type MessageId } from "@fresnel/client/i18n";
import { useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useCraftTheme } from "../../orbit.tsx";
import { Backdrop } from "./backdrop.tsx";
import { ChipBody, ChipShell } from "./graph.tsx";
import { DecisionGlyph, Icon, KIND_COLOR, KindBadge, KindGlyph, kindVars } from "./glyphs.tsx";
import { PLATE_H, PLATE_W } from "./model.ts";
import {
  pluginById,
  SAMPLE_PLUGINS,
  type Part,
  type PointKey,
  type SamplePlugin,
} from "./sample.ts";
import { currentProfile, useCanvasStore } from "./store.ts";
import { Stage, useViewport, ZoomBar } from "./viewport.tsx";
import { BLOCK_WORD, DECISION_WORD, KIND_WORD, RISK_WORD, pointWord } from "./words.ts";

export interface PluginInsideProps {
  readonly pluginId: string;
  readonly onBack: () => void;
  readonly onOpen: (pluginId: string) => void;
  readonly picker: ReactNode;
}

const INK = (pct: number): string =>
  `color-mix(in oklab, var(--cs-color-text-primary) ${pct}%, transparent)`;
const DRIVE = KIND_COLOR.drive;
const A_TRUNK = 120;
const A_CHIP = 220;
const BX = 420;
const NO_INSET = { left: 0, right: 64, top: 16 } as const;

type Pt = readonly [number, number];

function hv(points: readonly Pt[], r = 8): string {
  const first = points[0];
  if (first === undefined) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1];
    const p = points[i];
    const b = points[i + 1];
    if (a === undefined || p === undefined || b === undefined) continue;
    const ix = Math.sign(p[0] - a[0]);
    const iy = Math.sign(p[1] - a[1]);
    const ox = Math.sign(b[0] - p[0]);
    const oy = Math.sign(b[1] - p[1]);
    d += ` L${p[0] - ix * r} ${p[1] - iy * r} Q${p[0]} ${p[1]} ${p[0] + ox * r} ${p[1] + oy * r}`;
  }
  const last = points.at(-1);
  if (last !== undefined) d += ` L${last[0]} ${last[1]}`;
  return d;
}

function Box(props: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius?: number;
  readonly style?: CSSProperties;
  readonly label?: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div
      role={props.label === undefined ? undefined : "group"}
      aria-label={props.label}
      className="absolute"
      style={{
        left: props.x,
        top: props.y,
        width: props.w,
        height: props.h,
        borderRadius: props.radius ?? 8,
        background: "var(--cs-color-surface-raised)",
        border: `1px solid ${INK(14)}`,
        boxShadow: `inset 0 1px 0 ${INK(6)}`,
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

function Caption(props: {
  readonly x: number;
  readonly y: number;
  readonly text: MessageId;
  readonly count?: number;
}): ReactElement {
  return (
    <div
      className="absolute flex items-center gap-1.5 text-[11px] text-text-tertiary"
      style={{ left: props.x, top: props.y }}
    >
      <span>{t(props.text)}</span>
      {props.count !== undefined && (
        <span className="font-mono text-[10px] tabular-nums">{props.count}</span>
      )}
    </div>
  );
}

// ── 붙는 곳 ─────────────────────────────────────────────────────

/** 이 플러그인이 턴에 붙는 자리를 프로필 캔버스와 같은 문법으로. 몸으로 이어지는 점 하나를 돌려준다 */
function anchorOf(props: { readonly plugin: SamplePlugin; readonly start: boolean }): {
  node: ReactNode;
  out: Pt;
} {
  const p = props.plugin;
  const point: PointKey = p.points[0] ?? "drive";
  const chipY = 96;
  const chip = (
    <div
      className="absolute"
      style={{
        left: p.kind === "drive" ? A_TRUNK - 84 : A_CHIP,
        top: chipY - (p.kind === "drive" ? 16 : 13),
        width: p.kind === "drive" ? 168 : 140,
        height: p.kind === "drive" ? 32 : 26,
      }}
    >
      <ChipShell kind={p.kind} draft={p.draft === true} selected start={props.start}>
        <ChipBody
          chip={{
            plugin: p.id,
            kind: p.kind,
            guard: p.guard === true,
            draft: p.draft === true,
            origin: "profile",
            start: props.start,
          }}
        />
      </ChipShell>
    </div>
  );
  let station: ReactNode = null;
  let wire = "";
  let marker: ReactNode = null;
  const plate = (block: string, y: number): ReactNode => (
    <div
      className="absolute flex items-center rounded-[3px] px-2.5 text-[12px] font-medium text-text-secondary"
      style={{
        left: A_TRUNK - PLATE_W / 2,
        top: y - PLATE_H / 2,
        width: PLATE_W,
        height: PLATE_H,
        background: "var(--cs-color-surface-base)",
        border: `1px solid ${INK(14)}`,
        boxShadow: `0 0 0 3px var(--cs-color-bg-canvas)`,
      }}
    >
      {block}
    </div>
  );
  if (point === "drive") {
    // Drive는 턴 전체를 쥔다: 줄기 머리에 서고, 그 아래 블록들이 흐릿하게 이어진다
    const blocks = ["context", "model", "tools"] as const;
    station = (
      <div aria-hidden="true" className="opacity-55">
        {blocks.map((b, i) => (
          <div key={b}>{plate(t(BLOCK_WORD[b]), chipY + 48 + i * 36)}</div>
        ))}
      </div>
    );
  } else if (point.startsWith("before:") || point.startsWith("after:")) {
    const block = point.slice(point.indexOf(":") + 1);
    const word =
      block === "context" ||
      block === "model" ||
      block === "tools" ||
      block === "ask" ||
      block === "agents" ||
      block === "record"
        ? t(BLOCK_WORD[block])
        : block;
    const plateY = point.startsWith("before:") ? chipY + 44 : chipY - 44;
    station = plate(word, plateY);
    wire = `M${A_CHIP} ${chipY} H${A_TRUNK}`;
    marker = (
      <path
        d={`M${A_TRUNK} ${chipY - 5.5}L${A_TRUNK + 5.5} ${chipY}L${A_TRUNK} ${chipY + 5.5}L${A_TRUNK - 5.5} ${chipY}Z`}
        fill="var(--cs-color-bg-canvas)"
        stroke={INK(70)}
        strokeWidth={1.25}
      />
    );
  } else if (point === "feed:context" || point === "feed:tools") {
    station = plate(t(BLOCK_WORD[point === "feed:context" ? "context" : "tools"]), chipY);
    wire = `M${A_CHIP} ${chipY} H${A_TRUNK + PLATE_W / 2}`;
    marker =
      point === "feed:tools" ? (
        <rect x={A_TRUNK + PLATE_W / 2 + 1} y={chipY - 3} width={6} height={6} fill={INK(62)} />
      ) : (
        <path d={`M${A_TRUNK + PLATE_W / 2 + 1} ${chipY}l6 -4v8Z`} fill={INK(62)} />
      );
  } else if (point.startsWith("boundary:")) {
    station = (
      <span
        className="absolute rounded-full"
        style={{
          left: A_TRUNK - 6,
          top: chipY - 6,
          width: 12,
          height: 12,
          background: "var(--cs-color-bg-canvas)",
          border: `1.5px solid ${INK(48)}`,
        }}
      />
    );
    wire = `M${A_CHIP} ${chipY} H${A_TRUNK + 6}`;
  }
  const node = (
    <>
      <Caption x={A_TRUNK - 76} y={20} text="desktop.craft.canvas.cvD.inside.attach" />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
      >
        <path
          d={`M${A_TRUNK} ${p.kind === "drive" ? chipY : 50} V${chipY + 150}`}
          stroke={INK(16)}
          strokeWidth={7}
          strokeLinecap="round"
        />
        <path
          d={`M${A_TRUNK - 1} ${p.kind === "drive" ? chipY + 18 : 54} V${chipY + 146}`}
          stroke={INK(36)}
          strokeWidth={1.25}
          strokeLinecap="round"
        />
        {wire !== "" && <path d={wire} stroke={INK(34)} fill="none" />}
        {marker}
      </svg>
      {station}
      {chip}
      <div
        className="absolute text-[11px] text-text-tertiary"
        style={{ left: A_TRUNK - 76, top: chipY + 166, width: 300 }}
      >
        {props.start ? t("desktop.craft.canvas.cvD.startDrive") : t(pointWord(point))}
      </div>
    </>
  );
  const outX = p.kind === "drive" ? A_TRUNK + 84 : A_CHIP + 140;
  return { node, out: [outX, chipY] };
}

// ── Drive 몸: 단계와 병렬 갈래, 핸드오프, 되돌아가는 길 ────────────────

function stagePlate(x: number, y: number, label: string, key: string, w = PLATE_W): ReactElement {
  return (
    <div
      key={key}
      role="listitem"
      className="absolute flex items-center gap-2 rounded-[3px] pr-2.5 pl-2 text-[12px] font-medium text-text-primary"
      style={{
        left: x - w / 2,
        top: y - 15,
        width: w,
        height: 30,
        background: "var(--cs-color-surface-base)",
        border: `1px solid color-mix(in oklab, ${DRIVE} 40%, transparent)`,
        boxShadow: `inset 2px 0 0 ${DRIVE}, 0 0 0 3px var(--cs-color-bg-canvas)`,
      }}
    >
      <span className="truncate">{label}</span>
    </div>
  );
}

function GhostDrive(props: {
  readonly x: number;
  readonly y: number;
  readonly id: string;
  readonly onOpen: (id: string) => void;
}): ReactElement {
  const w = 140;
  const h = 26;
  return (
    <button
      type="button"
      data-slot="cvd"
      aria-label={t("desktop.craft.canvas.cvD.inside.openOther", { name: props.id })}
      onDoubleClick={() => props.onOpen(props.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onOpen(props.id);
      }}
      className="absolute flex items-center gap-1.5 px-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
      style={{ left: props.x, top: props.y - h / 2, width: w, height: h }}
    >
      <svg aria-hidden="true" className="absolute inset-0" width={w} height={h}>
        <path
          d={`M9.5 0.5H${w - 9.5}L${w - 0.5} ${h / 2}L${w - 9.5} ${h - 0.5}H9.5L0.5 ${h / 2}Z`}
          fill="var(--cs-color-bg-canvas)"
          stroke={DRIVE}
          strokeDasharray="3 3"
        />
      </svg>
      <span className="relative" style={{ color: DRIVE }}>
        <KindGlyph kind="drive" />
      </span>
      <span className="relative truncate font-mono text-[11.5px] text-text-secondary">
        {props.id}
      </span>
    </button>
  );
}

function ring(ax: number, bx: number, y: number): ReactElement {
  const r = 20;
  return (
    <g>
      <path
        d={`M${ax} ${y - 5} C${ax + 14} ${y - 5} ${ax + 14} ${y - r} ${ax + 30} ${y - r} L${bx - 30} ${y - r} C${bx - 14} ${y - r} ${bx - 14} ${y - 5} ${bx - 2} ${y - 5}`}
        fill="none"
        stroke={DRIVE}
        strokeWidth={1.4}
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <path
        d={`M${bx} ${y + 5} C${bx - 14} ${y + 5} ${bx - 14} ${y + r} ${bx - 30} ${y + r} L${ax + 30} ${y + r} C${ax + 14} ${y + r} ${ax + 14} ${y + 5} ${ax + 2} ${y + 5}`}
        fill="none"
        stroke={DRIVE}
        strokeWidth={1.4}
        strokeDasharray="5 4"
        strokeLinecap="round"
        opacity={0.6}
      />
      <path
        d={`M${bx - 7} ${y - 9}L${bx - 1} ${y - 5}L${bx - 7} ${y - 1}`}
        fill="none"
        stroke={DRIVE}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M${ax + 7} ${y + 1}L${ax + 1} ${y + 5}L${ax + 7} ${y + 9}`}
        fill="none"
        stroke={DRIVE}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.6}
      />
    </g>
  );
}

interface Body {
  readonly node: ReactNode;
  readonly right: number;
  readonly bottom: number;
}

function driveBody(props: {
  readonly plugin: SamplePlugin;
  readonly entry: Pt;
  readonly onOpen: (id: string) => void;
}): Body {
  const p = props.plugin;
  const trunk = BX + 130;
  const stages = p.parts.flatMap((x) => (x.kind === "stage" ? [x] : []));
  const docs = p.parts.flatMap((x) => (x.kind === "instruction" ? [x] : []));
  const handoffs = p.parts.flatMap((x) => (x.kind === "handoff" ? [x] : []));
  const incoming = SAMPLE_PLUGINS.filter((o) => o.handoff?.includes(p.id) === true);
  const plates: ReactNode[] = [];
  const lines: ReactNode[] = [];
  let y = props.entry[1] + 56;
  const top = y;
  let lastY = y;
  let spanLeft = trunk - PLATE_W / 2;
  stages.forEach((s, i) => {
    if (s.parallel <= 1) {
      plates.push(stagePlate(trunk, y, t(s.label), s.id));
      lastY = y;
      y += 64;
      return;
    }
    // 병렬 갈래: 가르는 막대 → n개 판 → 모으는 막대. 막대 끝에 ×n
    const n = s.parallel;
    const step = 132;
    const w = 116;
    const left = trunk - ((n - 1) * step) / 2;
    spanLeft = Math.min(spanLeft, left - w / 2);
    const forkY = y - 18;
    const lanes = Array.from({ length: n }, (_, k) => ({
      id: `${s.id}-${String(k)}`,
      x: left + k * step,
      label: `${t(s.label)} ${String(k + 1)}`,
    }));
    const rowY = y + 16;
    const joinY = y + 50;
    lines.push(
      <g key={`fork-${s.id}`}>
        <path
          d={`M${left} ${forkY} H${left + (n - 1) * step}`}
          stroke={DRIVE}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <path
          d={`M${left} ${joinY} H${left + (n - 1) * step}`}
          stroke={DRIVE}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {lanes.map((lane) => (
          <path
            key={lane.id}
            d={`M${lane.x} ${forkY} V${joinY}`}
            stroke={`color-mix(in oklab, ${DRIVE} 55%, transparent)`}
            strokeWidth={1.25}
          />
        ))}
      </g>,
    );
    plates.push(
      <span
        key={`n-${s.id}`}
        className="absolute font-mono text-[10.5px] tabular-nums"
        style={{ left: left + (n - 1) * step + 8, top: forkY - 8, color: DRIVE }}
      >
        ×{n}
      </span>,
    );
    for (const lane of lanes) plates.push(stagePlate(lane.x, rowY, lane.label, lane.id, w));
    lastY = joinY;
    y = joinY + 50;
    if (i === stages.length - 1) lastY = joinY;
  });
  const bottom = lastY + 34;
  // 줄기(Drive 색, 가늘게)
  lines.unshift(
    <g key="trunk">
      <path
        d={`M${trunk} ${top - 30} V${bottom}`}
        stroke={`color-mix(in oklab, ${DRIVE} 30%, transparent)`}
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d={`M${trunk - 0.75} ${top - 26} V${bottom - 4}`}
        stroke={`color-mix(in oklab, ${DRIVE} 70%, transparent)`}
        strokeWidth={1}
      />
    </g>,
  );
  // 붙는 곳에서 들어오는 선
  lines.push(
    <path
      key="in"
      d={hv([props.entry, [trunk, props.entry[1]], [trunk, top - 30]])}
      fill="none"
      stroke={INK(30)}
      strokeDasharray="2 3"
    />,
  );
  // 자기 되돌아가는 길: 마지막에서 첫 단계 위로
  const loopX = spanLeft - 36;
  lines.push(
    <g key="loop">
      <path
        d={hv(
          [
            [trunk, bottom],
            [trunk, bottom + 16],
            [loopX, bottom + 16],
            [loopX, top - 28],
            [trunk - 8, top - 28],
          ],
          12,
        )}
        fill="none"
        stroke={`color-mix(in oklab, ${DRIVE} 45%, transparent)`}
        strokeWidth={1.5}
      />
      <path
        d={`M${trunk - 14} ${top - 32.5}L${trunk - 8} ${top - 28}L${trunk - 14} ${top - 23.5}`}
        fill="none"
        stroke={DRIVE}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>,
  );
  // 지침: 첫 단계 오른쪽에서 들어간다
  docs.forEach((d, i) => {
    const dx = trunk + 130;
    const dy = top + i * 56;
    plates.push(<DocNode key={d.id} x={dx} y={dy - 20} title={d.title} lines={d.lines} />);
    lines.push(
      <g key={`doc-${d.id}`}>
        <path d={`M${dx} ${dy} H${trunk + PLATE_W / 2 + 7}`} stroke={INK(34)} />
        <path d={`M${trunk + PLATE_W / 2 + 1} ${dy}l6 -4v8Z`} fill={INK(62)} />
      </g>,
    );
  });
  // 핸드오프: 마지막 단계 오른쪽 고리
  let right = trunk + 300;
  handoffs.forEach((h, i) => {
    const hy = lastY + i * 48;
    const ax = trunk + PLATE_W / 2;
    const bx = trunk + 250;
    lines.push(<g key={`h-${h.id}`}>{ring(ax, bx, hy)}</g>);
    plates.push(<GhostDrive key={`g-${h.id}`} x={bx} y={hy} id={h.to} onOpen={props.onOpen} />);
    plates.push(
      <span
        key={`hl-${h.id}`}
        className="absolute text-[10.5px]"
        style={{ left: ax + 40, top: hy - 36, color: DRIVE }}
      >
        {t("desktop.craft.canvas.cvD.handoff")}
      </span>,
    );
    right = Math.max(right, bx + 160);
  });
  incoming.forEach((o, i) => {
    const hy = top + i * 48;
    const ax = trunk + PLATE_W / 2;
    const bx = trunk + 250;
    lines.push(<g key={`in-${o.id}`}>{ring(ax, bx, hy)}</g>);
    plates.push(<GhostDrive key={`gi-${o.id}`} x={bx} y={hy} id={o.id} onOpen={props.onOpen} />);
    right = Math.max(right, bx + 160);
  });
  const node = (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
      >
        {lines}
      </svg>
      <div role="list" aria-label={t("desktop.craft.canvas.cvD.inside.stages")}>
        {plates}
      </div>
    </>
  );
  return { node, right, bottom: bottom + 40 };
}

// ── Hook 몸: 핸들러와 결정 갈래 ─────────────────────────────────────

function handlerBody(props: { readonly plugin: SamplePlugin; readonly entry: Pt }): Body {
  const handlers = props.plugin.parts.flatMap((x) => (x.kind === "handler" ? [x] : []));
  const nodes: ReactNode[] = [];
  const lines: ReactNode[] = [];
  let y = props.entry[1];
  for (const h of handlers) {
    const x = BX;
    const w = 216;
    const hh = 56;
    nodes.push(
      <Box
        key={h.id}
        x={x}
        y={y - 20}
        w={w}
        h={hh}
        radius={5}
        label={t("desktop.craft.canvas.cvD.inside.handler")}
      >
        <div className="flex h-full flex-col justify-center gap-1 px-2.5">
          <div className="flex items-center gap-1.5">
            <KindBadge kind="hook" guard={h.guard} draft={props.plugin.draft === true} size={18} />
            <span className="text-[12px] font-medium text-text-primary">
              {t(pointWord(h.point))}
            </span>
            {h.guard && (
              <span className="ml-auto text-[10.5px] text-text-tertiary">
                {t("desktop.craft.canvas.cvD.guard")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 pl-[25px] text-[11.5px] text-text-secondary">
            <DecisionGlyph decision={h.decision} />
            {t(DECISION_WORD[h.decision])}
          </div>
        </div>
      </Box>,
    );
    lines.push(
      <g key={`in-${h.id}`}>
        <path d={`M${props.entry[0]} ${props.entry[1]} H${x}`} stroke={INK(34)} />
        <rect
          x={x - 3}
          y={props.entry[1] - 3}
          width={6}
          height={6}
          fill="var(--cs-color-bg-canvas)"
          stroke={INK(55)}
        />
      </g>,
    );
    h.outcomes.forEach((o, i) => {
      const oy = y - 24 + i * 52;
      const ox = x + w + 72;
      const pass = i === 0;
      lines.push(
        <g key={`o-${h.id}-${o}`}>
          <path
            d={hv(
              [
                [x + w, y - 2 + i * 16],
                [x + w + 36, y - 2 + i * 16],
                [x + w + 36, oy],
                [ox, oy],
              ],
              6,
            )}
            fill="none"
            stroke={pass ? INK(34) : KIND_COLOR.hook}
            strokeWidth={1}
          />
          <path
            d={`M${ox - 6} ${oy - 3.5}L${ox} ${oy}L${ox - 6} ${oy + 3.5}`}
            fill="none"
            stroke={pass ? INK(50) : KIND_COLOR.hook}
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>,
      );
      nodes.push(
        <div
          key={`ot-${h.id}-${o}`}
          className="absolute flex items-center gap-1.5 rounded-[12px] px-2.5 text-[11.5px]"
          style={{
            left: ox + 2,
            top: oy - 12,
            height: 24,
            border: `1px solid ${pass ? INK(16) : `color-mix(in oklab, ${KIND_COLOR.hook} 45%, transparent)`}`,
            color: pass ? "var(--cs-color-text-secondary)" : "var(--cs-color-text-primary)",
            background: "var(--cs-color-surface-base)",
          }}
        >
          {t(o)}
        </div>,
      );
    });
    y += 120;
  }
  const node = (
    <>
      <Caption
        x={BX}
        y={props.entry[1] - 52}
        text="desktop.craft.canvas.cvD.inside.handler"
        count={handlers.length}
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
      >
        {lines}
      </svg>
      {nodes}
    </>
  );
  return { node, right: BX + 216 + 200, bottom: y };
}

// ── Inject 몸: 지침, 스킬 선반, 메모리 ──────────────────────────────

function DocNode(props: {
  readonly x: number;
  readonly y: number;
  readonly title: MessageId;
  readonly lines: number;
}): ReactElement {
  return (
    <Box
      x={props.x}
      y={props.y}
      w={176}
      h={40}
      radius={4}
      label={t("desktop.craft.canvas.cvD.part.instruction")}
      style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)" }}
    >
      <span
        aria-hidden="true"
        className="absolute top-0 right-0 size-2.5"
        style={{ background: INK(18), clipPath: "polygon(0 0, 100% 100%, 0 100%)" }}
      />
      <div className="flex h-full items-center gap-2 px-2.5">
        <span style={{ color: KIND_COLOR.inject }}>
          <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3 3.5h6M3 6h6M3 8.5h4"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-text-primary">{t(props.title)}</div>
          <div className="font-mono text-[10px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.inside.lines", { count: props.lines })}
          </div>
        </div>
      </div>
    </Box>
  );
}

function injectBody(props: { readonly plugin: SamplePlugin; readonly entry: Pt }): Body {
  const parts = props.plugin.parts;
  const docs = parts.flatMap((x) => (x.kind === "instruction" ? [x] : []));
  const skills = parts.flatMap((x) => (x.kind === "skill" ? [x] : []));
  const memories = parts.flatMap((x) => (x.kind === "memory" ? [x] : []));
  const nodes: ReactNode[] = [];
  const taps: number[] = [];
  let y = props.entry[1] - 20;
  for (const d of docs) {
    nodes.push(<DocNode key={d.id} x={BX} y={y} title={d.title} lines={d.lines} />);
    taps.push(y + 20);
    y += 56;
  }
  if (skills.length > 0) {
    const cols = 2;
    const cw = 140;
    const rows = Math.ceil(skills.length / cols);
    const w = cols * cw + (cols - 1) * 8 + 24;
    const h = 36 + rows * 24 + (rows - 1) * 8 + 12;
    nodes.push(
      <Box
        key="shelf"
        x={BX}
        y={y}
        w={w}
        h={h}
        radius={8}
        label={t("desktop.craft.canvas.cvD.part.skills")}
      >
        <div className="flex h-9 items-center gap-1.5 px-3">
          <span className="text-[12px] font-medium text-text-primary">
            {t("desktop.craft.canvas.cvD.part.skills")}
          </span>
          <span className="font-mono text-[10px] text-text-tertiary">{skills.length}</span>
          <span
            className="ml-auto rounded-[5px] px-1.5 py-px text-[10.5px] text-text-tertiary"
            style={{ border: `1px solid ${INK(12)}` }}
          >
            {t("desktop.craft.canvas.cvD.inside.onDemand")}
          </span>
        </div>
        <ul className="grid gap-2 px-3" style={{ gridTemplateColumns: `repeat(${cols}, ${cw}px)` }}>
          {skills.map((s) => (
            <li
              key={s.id}
              className="flex h-6 items-center gap-1.5 rounded-[12px] px-2"
              style={{ background: "var(--cs-color-surface-base)", border: `1px solid ${INK(12)}` }}
            >
              <span className="font-mono text-[11px]" style={{ color: KIND_COLOR.inject }}>
                /
              </span>
              <span className="truncate font-mono text-[11px] text-text-primary">{s.name}</span>
            </li>
          ))}
        </ul>
      </Box>,
    );
    taps.push(y + 18);
    y += h + 16;
  }
  for (const m of memories) {
    nodes.push(
      <Box
        key={m.id}
        x={BX}
        y={y}
        w={176}
        h={36}
        radius={4}
        label={t("desktop.craft.canvas.cvD.part.memory")}
      >
        <div className="flex h-full items-center gap-2 px-2.5">
          <svg
            width={12}
            height={12}
            viewBox="0 0 12 12"
            aria-hidden="true"
            style={{ color: KIND_COLOR.inject }}
          >
            <ellipse
              cx="6"
              cy="3"
              rx="4"
              ry="1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
            />
            <path
              d="M2 3v6c0 .9 1.8 1.6 4 1.6s4-.7 4-1.6V3"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
            />
          </svg>
          <span className="text-[12px] text-text-primary">
            {t("desktop.craft.canvas.cvD.part.memory")}
          </span>
          <span className="ml-auto text-[11px] text-text-tertiary">{t(m.scope)}</span>
        </div>
      </Box>,
    );
    taps.push(y + 18);
    y += 48;
  }
  const busX = BX - 32;
  const first = taps[0] ?? props.entry[1];
  const last = taps.at(-1) ?? props.entry[1];
  const node = (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
      >
        <path d={`M${busX} ${Math.min(first, props.entry[1])} V${last}`} stroke={INK(30)} />
        {taps.map((ty) => (
          <path key={ty} d={`M${BX} ${ty} H${busX}`} stroke={INK(30)} />
        ))}
        <path d={`M${busX} ${props.entry[1]} H${props.entry[0] + 8}`} stroke={INK(34)} />
        <path d={`M${props.entry[0] + 1} ${props.entry[1]}l6 -4v8Z`} fill={INK(62)} />
      </svg>
      {nodes}
    </>
  );
  return { node, right: BX + 330, bottom: y };
}

// ── 도구 몸: MCP 서버와 도구 칩 ───────────────────────────────────────

function toolBody(props: { readonly plugin: SamplePlugin; readonly entry: Pt }): Body {
  const servers = props.plugin.parts.flatMap((x) => (x.kind === "mcp" ? [x] : []));
  const nodes: ReactNode[] = [];
  const lines: ReactNode[] = [];
  let y = props.entry[1] - 18;
  let right = BX;
  for (const s of servers) {
    const cols = 3;
    const cw = 136;
    const rows = Math.ceil(s.tools.length / cols);
    const w = cols * cw + (cols - 1) * 8 + 24;
    const h = 40 + rows * 24 + (rows - 1) * 8 + 14;
    right = Math.max(right, BX + w);
    nodes.push(
      <Box
        key={s.id}
        x={BX}
        y={y}
        w={w}
        h={h}
        radius={4}
        label={t("desktop.craft.canvas.cvD.part.mcp", { name: s.name })}
      >
        <div className="flex h-9 items-center gap-2 px-3">
          <svg
            width={14}
            height={14}
            viewBox="0 0 14 14"
            aria-hidden="true"
            style={{ color: KIND_COLOR.tool }}
          >
            <rect
              x="2"
              y="2"
              width="10"
              height="4"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
            />
            <rect
              x="2"
              y="8"
              width="10"
              height="4"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
            />
          </svg>
          <span className="font-mono text-[12px] text-text-primary">{s.name}</span>
          <span className="text-[11px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.part.mcpServer")}
          </span>
          <span className="ml-auto font-mono text-[10px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.inside.toolCount", { count: s.tools.length })}
          </span>
        </div>
        <ul className="grid gap-2 px-3" style={{ gridTemplateColumns: `repeat(${cols}, ${cw}px)` }}>
          {s.tools.map((tool) => (
            <li
              key={tool.name}
              aria-label={
                tool.writes
                  ? t("desktop.craft.canvas.cvD.inside.writeTool", { name: tool.name })
                  : tool.name
              }
              className="flex h-6 items-center gap-1.5 rounded-[2px] pr-2 pl-1.5"
              style={{
                background: "var(--cs-color-surface-base)",
                border: `1px solid ${INK(12)}`,
                boxShadow: tool.writes
                  ? `inset 2px 0 0 var(--cs-color-warning-graphic)`
                  : undefined,
              }}
            >
              <span style={{ color: KIND_COLOR.tool }}>
                <KindGlyph kind="tool" size={11} />
              </span>
              <span className="truncate font-mono text-[11px] text-text-primary">{tool.name}</span>
            </li>
          ))}
        </ul>
      </Box>,
    );
    lines.push(
      <g key={`l-${s.id}`}>
        <path d={`M${BX} ${props.entry[1]} H${props.entry[0] + 8}`} stroke={INK(34)} />
        <rect x={props.entry[0] + 1} y={props.entry[1] - 3} width={6} height={6} fill={INK(62)} />
      </g>,
    );
    y += h + 16;
  }
  const node = (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
      >
        {lines}
      </svg>
      {nodes}
    </>
  );
  return { node, right, bottom: y };
}

// ── 설정과 권한 ───────────────────────────────────────────────────

function SideColumn(props: {
  readonly plugin: SamplePlugin;
  readonly x: number;
  readonly y: number;
}): ReactNode {
  const settings = props.plugin.parts.flatMap((p) => (p.kind === "setting" ? [p] : []));
  const perms = props.plugin.parts.flatMap((p) => (p.kind === "permission" ? [p] : []));
  let y = props.y;
  const out: ReactNode[] = [];
  if (settings.length > 0) {
    const h = 34 + settings.length * 22 + 8;
    out.push(
      <Box
        key="settings"
        x={props.x}
        y={y}
        w={208}
        h={h}
        radius={6}
        label={t("desktop.craft.canvas.cvD.part.settings")}
      >
        <div className="flex h-8 items-center px-3 text-[11px] text-text-tertiary">
          {t("desktop.craft.canvas.cvD.part.settings")}
        </div>
        <dl className="px-3">
          {settings.map((s) => (
            <div
              key={s.id}
              className="flex h-[22px] items-center justify-between gap-2 font-mono text-[11px]"
            >
              <dt className="truncate text-text-secondary">{s.key}</dt>
              <dd className="text-text-primary">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Box>,
    );
    y += h + 12;
  }
  for (const p of perms) {
    const level = p.risk === "low" ? 1 : p.risk === "medium" ? 2 : 3;
    const tone =
      p.risk === "high"
        ? "var(--cs-color-danger-graphic)"
        : p.risk === "medium"
          ? "var(--cs-color-warning-graphic)"
          : INK(55);
    out.push(
      <Box
        key={p.id}
        x={props.x}
        y={y}
        w={208}
        h={66}
        radius={6}
        label={t("desktop.craft.canvas.cvD.part.permission")}
      >
        <div className="flex h-8 items-center justify-between px-3">
          <span className="text-[11px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.part.permission")}
          </span>
          <span className="text-[11.5px] font-medium text-text-primary">
            {t(RISK_WORD[p.risk])}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3">
          <span aria-hidden="true" className="flex gap-0.5">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-1.5 w-5 rounded-[1px]"
                style={{ background: i <= level ? tone : INK(10) }}
              />
            ))}
          </span>
          <span className="truncate text-[11px] text-text-secondary">{t(p.scope)}</span>
        </div>
      </Box>,
    );
    y += 78;
  }
  return (
    <>
      <Caption x={props.x} y={props.y - 22} text="desktop.craft.canvas.cvD.inside.config" />
      {out}
    </>
  );
}

// ── 화면 ───────────────────────────────────────────────────────

function body(plugin: SamplePlugin, entry: Pt, onOpen: (id: string) => void): Body {
  if (plugin.kind === "drive") return driveBody({ plugin, entry, onOpen });
  if (plugin.kind === "hook") return handlerBody({ plugin, entry });
  if (plugin.kind === "tool") return toolBody({ plugin, entry });
  return injectBody({ plugin, entry });
}

export function CvdPluginInside(props: PluginInsideProps): ReactNode {
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const theme = useCraftTheme();
  const plugin = pluginById(props.pluginId);
  const start = profile.startDrive === props.pluginId;
  const anchor = plugin === undefined ? null : anchorOf({ plugin, start });
  const b = plugin === undefined || anchor === null ? null : body(plugin, anchor.out, props.onOpen);
  const sideX = (b?.right ?? BX) + 56;
  const width = sideX + 240;
  const height = Math.max(b?.bottom ?? 400, 360) + 40;
  const box = useRef<HTMLDivElement>(null);
  const vp = useViewport(box, width, height, NO_INSET);
  if (plugin === undefined || anchor === null || b === null) return null;
  const parts: readonly Part[] = plugin.parts;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" style={kindVars(theme)}>
      <header className="relative z-20 flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-base px-3">
        <nav
          aria-label={t("desktop.craft.canvas.cvD.inside.path")}
          className="flex min-w-0 items-center gap-1"
        >
          <button
            type="button"
            data-slot="cvd"
            onClick={props.onBack}
            className="inline-flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12.5px] text-text-secondary outline-none hover:bg-[var(--cs-color-fill-hover)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
          >
            <Icon name="back" size={14} />
            {t("desktop.craft.canvas.cvD.profile")}
          </button>
          <Icon name="chevron-right" size={12} />
          <span className="flex items-center gap-1.5 px-1">
            <KindBadge
              kind={plugin.kind}
              guard={plugin.guard === true}
              draft={plugin.draft === true}
              size={18}
            />
            <span aria-current="page" className="font-mono text-[13px] text-text-primary">
              {plugin.id}
            </span>
            <span className="text-[11.5px]" style={{ color: KIND_COLOR[plugin.kind] }}>
              {t(KIND_WORD[plugin.kind])}
            </span>
          </span>
        </nav>
        {plugin.draft === true ? (
          <span className="ml-2 rounded-[8px] border border-[var(--cs-color-warning-border)] bg-[var(--cs-color-warning-soft)] px-2 py-0.5 text-[11.5px] text-[var(--cs-color-warning-text)]">
            {t("desktop.craft.canvas.cvD.draftPending")}
          </span>
        ) : (
          <span className="ml-2 font-mono text-[11px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.inside.approved", { version: 3 })}
          </span>
        )}
        <span className="ml-auto text-[11px] text-text-tertiary">
          {t("desktop.craft.canvas.cvD.inside.parts", { count: parts.length })}
        </span>
        <div className="w-36">{props.picker}</div>
      </header>
      <div
        ref={box}
        data-pan=""
        role="group"
        aria-roledescription={t("desktop.craft.canvas.cvD.a11y.canvas")}
        aria-label={t("desktop.craft.canvas.cvD.inside.label", { name: plugin.id })}
        className="relative min-h-0 flex-1"
        onPointerDown={vp.onPointerDown}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "ArrowUp" && e.metaKey)) props.onBack();
        }}
      >
        <Backdrop view={vp.view} theme={theme} />
        <Stage view={vp.view} w={width} h={height}>
          {anchor.node}
          {b.node}
          <SideColumn plugin={plugin} x={sideX} y={anchor.out[1] - 20} />
        </Stage>
        <div className="absolute right-3 bottom-3 z-20">
          <ZoomBar vp={vp} />
        </div>
      </div>
    </div>
  );
}
