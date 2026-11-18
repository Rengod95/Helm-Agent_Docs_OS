// cvC 플러그인 내부. 프로필 캔버스와 같은 문법(틀·카드·선)으로 한 플러그인의 구성 요소를 그린다.
// 가운데 틀이 그 플러그인의 몸이다: Drive는 "자기 루프"(단계, 나란한 단계는 부채꼴, 끝에서 처음으로 돌아오는 호, 밖으로 나가는 핸드오프),
// Hook은 "Hook 핸들러"(어느 지점, 무슨 결정), Inject는 넣는 것(지침·스킬·메모리), 도구는 MCP 서버와 그 도구. 왼쪽은 쓰는 것(붙음 선),
// 오른쪽은 코어 루프에서 붙는 지점(알약), 아래는 설정과 권한(위험 등급). 코드가 없는 플러그인은 몸 틀 하나와 "코드 없음" 권한 카드로 끝난다.
// 위쪽 경로(프로필 / 플러그인)로 돌아간다. Escape도 돌아간다.
import { Button, IconButton } from "@caustic/react";
import { ChevronLeft, Maximize } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useCraftTheme } from "../../orbit.tsx";
import { GlowGrid } from "./glow-grid.tsx";
import {
  decisionLabel,
  kindLabel,
  permissionLabel,
  pointLabel,
  riskLabel,
  sideLabel,
  stepLabel,
} from "./labels.ts";
import { KindWell, Mark, type PartMark } from "./marks.tsx";
import { placeOf, POINTS, type Rect } from "./model.ts";
import { pluginOf, type Risk, type SamplePlugin } from "./sample.ts";
import { fitView, useSurface } from "./surface.ts";

// ── 배치 ────────────────────────────────────────────────────────────

type Line =
  | {
      readonly kind: "attach";
      readonly d: string;
      readonly dot: { readonly x: number; readonly y: number };
    }
  | { readonly kind: "flow"; readonly d: string; readonly tip: string }
  | { readonly kind: "loop"; readonly d: string; readonly tip: string }
  | {
      readonly kind: "handoff";
      readonly d: string;
      readonly tip: string;
      readonly tag: { readonly x: number; readonly y: number };
    };

type Piece =
  | {
      readonly type: "frame";
      readonly key: string;
      readonly rect: Rect;
      readonly title: string;
      readonly count?: number;
      readonly mark: PartMark | "drive" | "hook";
    }
  | {
      readonly type: "part";
      readonly key: string;
      readonly rect: Rect;
      readonly mark: PartMark;
      readonly title: string;
      readonly sub: string;
      readonly mono?: boolean;
    }
  | {
      readonly type: "step";
      readonly key: string;
      readonly rect: Rect;
      readonly n: string;
      readonly title: string;
      readonly small?: boolean;
    }
  | {
      readonly type: "pill";
      readonly key: string;
      readonly rect: Rect;
      readonly n: string;
      readonly title: string;
    }
  | {
      readonly type: "entry";
      readonly key: string;
      readonly rect: Rect;
      readonly title: string;
      readonly handoff: boolean;
    }
  | { readonly type: "ghost"; readonly key: string; readonly rect: Rect; readonly name: string }
  | {
      readonly type: "hook";
      readonly key: string;
      readonly rect: Rect;
      readonly plugin: SamplePlugin;
    }
  | {
      readonly type: "settings";
      readonly key: string;
      readonly rect: Rect;
      readonly rows: readonly { readonly key: string; readonly value: string }[];
    }
  | {
      readonly type: "permission";
      readonly key: string;
      readonly rect: Rect;
      readonly plugin: SamplePlugin;
    };

interface Plan {
  readonly pieces: readonly Piece[];
  readonly lines: readonly Line[];
  readonly bounds: Rect;
}

const PART_W = 200;
const PART_H = 52;
const CORE_X = 268;
const HEADER = 44;

function arrowTip(x: number, y: number, dir: "right" | "left" | "up"): string {
  if (dir === "right") return `M${x - 7} ${y - 4} L${x} ${y} L${x - 7} ${y + 4}`;
  if (dir === "left") return `M${x + 7} ${y - 4} L${x} ${y} L${x + 7} ${y + 4}`;
  return `M${x - 4} ${y + 7} L${x} ${y} L${x + 4} ${y + 7}`;
}

/** 쓰는 것(왼쪽 열): 지침·스킬·메모리·도구. 각 카드는 몸 틀의 왼쪽 가장자리로 붙는다 */
function inputsOf(p: SamplePlugin, core: Rect, pieces: Piece[], lines: Line[]): void {
  const rows: { mark: PartMark; title: string; sub: string }[] = [];
  const ins = p.inside;
  if (ins.instructions !== undefined)
    rows.push({
      mark: "instructions",
      title: t("desktop.craft.canvas.cvC.part.instructions"),
      sub: ins.instructions.join(", "),
    });
  if (ins.skills !== undefined)
    rows.push({
      mark: "skill",
      title: t("desktop.craft.canvas.cvC.part.skill"),
      sub: ins.skills.join(", "),
    });
  if (ins.memory !== undefined)
    rows.push({
      mark: "memory",
      title: t("desktop.craft.canvas.cvC.part.memory"),
      sub: ins.memory.join(", "),
    });
  if (ins.tools !== undefined)
    rows.push({
      mark: "tool",
      title: t("desktop.craft.canvas.cvC.part.tool"),
      sub: ins.tools.join(", "),
    });
  rows.forEach((r, i) => {
    const rect = { x: 0, y: HEADER + 12 + i * (PART_H + 12), w: PART_W, h: PART_H };
    pieces.push({ type: "part", key: `in-${r.mark}`, rect, ...r });
    const y = rect.y + PART_H / 2;
    lines.push({ kind: "attach", d: `M${PART_W} ${y} H${core.x}`, dot: { x: core.x, y } });
  });
}

/** 코어 루프에서 붙는 지점(오른쪽 알약)과 붙음 선 */
function exitOf(p: SamplePlugin, core: Rect, pieces: Piece[], lines: Line[]): void {
  const place = placeOf(p.name);
  if (place === null || place.lane !== "point") return;
  const rect = { x: core.x + core.w + 64, y: core.y + 4, w: 196, h: 36 };
  pieces.push({
    type: "pill",
    key: "exit",
    rect,
    n: String(POINTS.indexOf(place.point)).padStart(2, "0"),
    title: `${pointLabel(place.point)} · ${sideLabel(place.side)}`,
  });
  const y = rect.y + rect.h / 2;
  lines.push({ kind: "attach", d: `M${core.x + core.w} ${y} H${rect.x}`, dot: { x: rect.x, y } });
}

/** 아래 줄: 설정과 권한 */
function footOf(p: SamplePlugin, x0: number, top: number, pieces: Piece[]): number {
  let x = x0;
  const settings = p.inside.settings ?? [];
  if (settings.length > 0) {
    const h = 48 + settings.length * 28;
    pieces.push({
      type: "settings",
      key: "settings",
      rect: { x, y: top, w: 240, h },
      rows: settings,
    });
    x += 256;
  }
  pieces.push({
    type: "permission",
    key: "permission",
    rect: { x, y: top, w: 240, h: 100 },
    plugin: p,
  });
  return top + Math.max(100, 48 + settings.length * 28);
}

/** Drive: 자기 루프 */
function driveCore(p: SamplePlugin, pieces: Piece[], lines: Line[]): Rect {
  const steps = p.inside.steps ?? [];
  const stepW = 132;
  const gap = 44;
  const entryW = 116;
  const rowY = HEADER + 70;
  const fanH = 30;
  let x = CORE_X + 20;
  const receives = p.handoffTo === undefined && p.name !== "helm";
  pieces.push({
    type: "entry",
    key: "entry",
    rect: { x, y: rowY - 18, w: entryW, h: 36 },
    title: receives
      ? t("desktop.craft.canvas.cvC.part.received")
      : t("desktop.craft.canvas.cvC.part.firstMessage"),
    handoff: receives,
  });
  let prevRight = x + entryW;
  let prevFan: readonly number[] = [rowY];
  x += entryW + gap;
  let firstLeft = x;
  steps.forEach((s, i) => {
    const n = String(i + 1);
    const par = s.parallel ?? [];
    if (i === 0) firstLeft = x;
    if (par.length > 0) {
      const total = par.length * fanH + (par.length - 1) * 8;
      const ys = par.map((_, j) => rowY - total / 2 + j * (fanH + 8) + fanH / 2);
      pieces.push({
        type: "step",
        key: `step-${s.id}`,
        rect: { x, y: rowY - total / 2 - 26, w: stepW, h: 20 },
        n,
        title: stepLabel(s.id),
        small: true,
      });
      par.forEach((name, j) => {
        const y = ys[j] ?? rowY;
        pieces.push({
          type: "step",
          key: `step-${s.id}-${name}`,
          rect: { x, y: y - fanH / 2, w: stepW, h: fanH },
          n: "",
          title: stepLabel(name),
          small: true,
        });
        for (const py of prevFan) {
          lines.push({
            kind: "flow",
            d: `M${prevRight} ${py} C${prevRight + gap / 2} ${py} ${x - gap / 2} ${y} ${x - 2} ${y}`,
            tip: arrowTip(x - 2, y, "right"),
          });
        }
      });
      prevFan = ys;
    } else {
      pieces.push({
        type: "step",
        key: `step-${s.id}`,
        rect: { x, y: rowY - 26, w: stepW, h: 52 },
        n,
        title: stepLabel(s.id),
      });
      for (const py of prevFan) {
        lines.push({
          kind: "flow",
          d: `M${prevRight} ${py} C${prevRight + gap / 2} ${py} ${x - gap / 2} ${rowY} ${x - 2} ${rowY}`,
          tip: arrowTip(x - 2, rowY, "right"),
        });
      }
      prevFan = [rowY];
    }
    prevRight = x + stepW;
    x += stepW + gap;
  });
  const lastRight = prevRight;
  const core: Rect = { x: CORE_X, y: 0, w: x - gap + 20 - CORE_X, h: rowY + 110 };
  // 끝에서 처음으로: 아래로 도는 호(자기 루프)
  if (steps.length > 1) {
    const by = rowY + 74;
    const ax = lastRight - stepW / 2;
    const bx = firstLeft + stepW / 2;
    lines.push({
      kind: "loop",
      d: `M${ax} ${rowY + 28} V${by - 14} Q${ax} ${by} ${ax - 14} ${by} H${bx + 14} Q${bx} ${by} ${bx} ${by - 14} V${rowY + 30}`,
      tip: arrowTip(bx, rowY + 29, "up"),
    });
  }
  pieces.push({
    type: "frame",
    key: "core",
    rect: core,
    title: t("desktop.craft.canvas.cvC.part.loop"),
    count: steps.length,
    mark: "drive",
  });
  // 밖으로: 핸드오프
  const to = p.handoffTo?.[0];
  if (to !== undefined) {
    const g = { x: core.x + core.w + 72, y: rowY - 28, w: 180, h: 56 };
    pieces.push({ type: "ghost", key: `ghost-${to}`, rect: g, name: to });
    const x1 = lastRight;
    const y1 = rowY;
    const x2 = g.x;
    const d = `M${x1} ${y1 + 8} C${x1 + 60} ${y1 + 70} ${x2 - 70} ${y1 + 50} ${x2 - 4} ${y1 + 6}`;
    lines.push({
      kind: "handoff",
      d,
      tip: arrowTip(x2 - 3, y1 + 5, "right"),
      tag: { x: (x1 + x2) / 2 + 20, y: y1 + 56 },
    });
  }
  return core;
}

/** Hook: 핸들러 한 장(지점과 결정) */
function hookCore(p: SamplePlugin, pieces: Piece[]): Rect {
  const core: Rect = { x: CORE_X, y: 0, w: 320, h: HEADER + 128 };
  pieces.push({
    type: "frame",
    key: "core",
    rect: core,
    title: t("desktop.craft.canvas.cvC.part.hook"),
    count: 1,
    mark: "hook",
  });
  pieces.push({
    type: "hook",
    key: "handler",
    rect: { x: CORE_X + 20, y: HEADER + 14, w: 280, h: 96 },
    plugin: p,
  });
  return core;
}

/** Inject·도구: 넣는 것을 틀 안에 격자로 */
function contentCore(p: SamplePlugin, pieces: Piece[]): Rect {
  const ins = p.inside;
  const items: { mark: PartMark; title: string; mono: boolean }[] = [];
  let title = t("desktop.craft.canvas.cvC.part.gives");
  let mark: PartMark = "instructions";
  if (ins.mcp !== undefined) {
    title = `${t("desktop.craft.canvas.cvC.part.mcp")} · ${ins.mcp.server}`;
    mark = "mcp";
    for (const name of ins.mcp.tools) items.push({ mark: "tool", title: name, mono: true });
  } else {
    for (const s of ins.skills ?? []) items.push({ mark: "skill", title: s, mono: false });
    for (const s of ins.instructions ?? [])
      items.push({ mark: "instructions", title: s, mono: false });
    for (const s of ins.memory ?? []) items.push({ mark: "memory", title: s, mono: false });
    if ((ins.skills ?? []).length > 0) {
      title = t("desktop.craft.canvas.cvC.part.skill");
      mark = "skill";
    }
  }
  const cols = ins.mcp !== undefined ? 3 : items.length > 2 ? 2 : 1;
  const cw = ins.mcp !== undefined ? 150 : 176;
  const ch = ins.mcp !== undefined ? 34 : 48;
  const rows = Math.ceil(items.length / cols);
  const core: Rect = {
    x: 0,
    y: 0,
    w: cols * cw + (cols - 1) * 10 + 40,
    h: HEADER + 16 + rows * ch + (rows - 1) * 10 + 20,
  };
  items.forEach((it, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    pieces.push({
      type: "part",
      key: `item-${String(i)}`,
      rect: { x: 20 + c * (cw + 10), y: HEADER + 16 + r * (ch + 10), w: cw, h: ch },
      mark: it.mark,
      title: it.title,
      sub: "",
      mono: it.mono,
    });
  });
  pieces.unshift({ type: "frame", key: "core", rect: core, title, count: items.length, mark });
  return core;
}

export function planOf(p: SamplePlugin): Plan {
  const pieces: Piece[] = [];
  const lines: Line[] = [];
  let core: Rect;
  if (p.kind === "drive") {
    core = driveCore(p, pieces, lines);
    inputsOf(p, core, pieces, lines);
  } else if (p.kind === "hook") {
    core = hookCore(p, pieces);
    inputsOf(p, core, pieces, lines);
  } else {
    core = contentCore(p, pieces);
  }
  exitOf(p, core, pieces, lines);
  // 아래 줄(설정·권한)은 몸 틀의 왼쪽 끝에 맞춘다
  const bottom = footOf(p, core.x, core.y + core.h + 40, pieces);
  const right = pieces.reduce<number>((m, pc) => Math.max(m, pc.rect.x + pc.rect.w), 0);
  return { pieces, lines, bounds: { x: -24, y: -24, w: right + 48, h: bottom + 48 } };
}

// ── 그리기 ──────────────────────────────────────────────────────────

const RISK_STEPS: readonly Risk[] = ["none", "low", "mid", "high"];

function at(r: Rect): {
  readonly translate: string;
  readonly width: number;
  readonly height: number;
} {
  return { translate: `${String(r.x)}px ${String(r.y)}px`, width: r.w, height: r.h };
}

function PieceView(props: { readonly piece: Piece }): ReactNode {
  const pc = props.piece;
  const base = "absolute top-0 left-0";
  switch (pc.type) {
    case "frame":
      return (
        <div
          role="group"
          aria-label={pc.title}
          className={`${base} rounded-[18px] border border-border-subtle bg-surface-base/70`}
          style={at(pc.rect)}
        >
          <div className="flex h-11 items-center gap-2 px-3.5 text-text-secondary">
            <Mark name={pc.mark} size={14} />
            <span className="min-w-0 flex-1 truncate text-ui-strong text-text-primary">
              {pc.title}
            </span>
            {pc.count !== undefined && (
              <span className="font-mono text-mono-sm text-text-tertiary tabular-nums">
                {pc.count}
              </span>
            )}
          </div>
        </div>
      );
    case "part":
      return (
        <div
          className={`${base} flex items-center gap-2.5 rounded-xl bg-surface-raised px-2.5 shadow-1`}
          style={at(pc.rect)}
        >
          <span
            className={`flex shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-inset text-text-secondary ${pc.rect.h < 40 ? "size-5" : "size-7"}`}
          >
            <Mark name={pc.mark} size={pc.rect.h < 40 ? 12 : 15} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className={`truncate ${pc.mono === true ? "font-mono text-mono-sm text-text-primary" : "text-ui-strong text-text-primary"}`}
            >
              {pc.title}
            </span>
            {pc.sub !== "" && (
              <span className="truncate text-ui-xs text-text-tertiary">{pc.sub}</span>
            )}
          </span>
        </div>
      );
    case "step":
      return (
        <div
          className={`${base} flex items-center gap-2 ${pc.small === true && pc.n === "" ? "rounded-lg bg-surface-raised px-2.5 shadow-1" : pc.small === true ? "px-0.5" : "rounded-xl bg-surface-raised px-2.5 shadow-1"}`}
          style={at(pc.rect)}
        >
          {pc.n !== "" && (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-default font-mono text-mono-sm text-text-secondary tabular-nums">
              {pc.n}
            </span>
          )}
          <span
            className={`truncate ${pc.small === true ? "text-ui-sm text-text-secondary" : "text-ui-strong text-text-primary"}`}
          >
            {pc.title}
          </span>
        </div>
      );
    case "pill":
      return (
        <div
          className={`${base} flex items-center gap-2 rounded-full border border-border-subtle bg-surface-base/80 px-3.5`}
          style={at(pc.rect)}
        >
          <span className="font-mono text-mono-sm text-text-tertiary tabular-nums">{pc.n}</span>
          <span className="truncate text-ui-sm text-text-primary">{pc.title}</span>
        </div>
      );
    case "entry":
      return (
        <div
          className={`${base} flex items-center justify-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 text-ui-sm text-text-secondary`}
          style={at(pc.rect)}
        >
          <Mark name={pc.handoff ? "handoff" : "inject"} size={12} />
          <span className="truncate">{pc.title}</span>
        </div>
      );
    case "ghost":
      return (
        <div
          className={`${base} flex items-center gap-2.5 rounded-2xl border border-border-subtle bg-bg-inset px-2.5`}
          style={at(pc.rect)}
        >
          <KindWell kind="drive" muted />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui-strong text-text-secondary">{pc.name}</span>
            <span className="text-ui-xs text-text-tertiary">{kindLabel("drive")}</span>
          </span>
        </div>
      );
    case "hook": {
      const p = pc.plugin;
      const place = placeOf(p.name);
      return (
        <div
          className={`${base} flex flex-col justify-center gap-2.5 rounded-xl bg-surface-raised px-3.5 shadow-1`}
          style={at(pc.rect)}
        >
          <span
            aria-hidden
            className="absolute top-1/2 left-0 h-8 w-[3px] -translate-y-1/2 rounded-r-full bg-text-tertiary"
          />
          <span className="flex items-center gap-2 text-ui text-text-primary">
            <Mark name="hook" size={15} />
            {place !== null && place.lane === "point"
              ? `${pointLabel(place.point)} · ${sideLabel(place.side)}`
              : ""}
          </span>
          <span className="flex items-center gap-1.5">
            {p.decision !== undefined && (
              <span className="rounded-md border border-border-default px-2 py-0.5 text-ui-sm text-text-primary">
                {decisionLabel(p.decision)}
              </span>
            )}
            {p.guard === true && (
              <span className="rounded-md bg-fill-hover px-2 py-0.5 text-ui-sm text-text-secondary">
                {t("desktop.craft.canvas.cvC.guard")}
              </span>
            )}
            <span className="font-mono text-mono-sm text-text-tertiary">{p.hook}</span>
          </span>
        </div>
      );
    }
    case "settings":
      return (
        <div
          className={`${base} flex flex-col rounded-xl bg-surface-raised shadow-1`}
          style={at(pc.rect)}
        >
          <div className="flex h-11 items-center gap-2 px-3.5 text-text-secondary">
            <Mark name="settings" size={14} />
            <span className="text-ui-strong text-text-primary">
              {t("desktop.craft.canvas.cvC.part.settings")}
            </span>
          </div>
          {pc.rows.map((r) => (
            <div key={r.key} className="flex h-7 items-center justify-between gap-3 px-3.5">
              <span className="font-mono text-mono-sm text-text-tertiary">{r.key}</span>
              <span className="font-mono text-mono-sm text-text-primary">{r.value}</span>
            </div>
          ))}
        </div>
      );
    case "permission": {
      const ins = pc.plugin.inside;
      const level = RISK_STEPS.indexOf(ins.risk);
      const high = ins.risk === "high";
      const noCode =
        pc.plugin.kind === "inject" && ins.tools === undefined && ins.settings === undefined;
      return (
        <div
          className={`${base} flex flex-col rounded-xl bg-surface-raised shadow-1`}
          style={at(pc.rect)}
        >
          <div className="flex h-11 items-center gap-2 px-3.5 text-text-secondary">
            <Mark name="permission" size={14} />
            <span className="flex-1 text-ui-strong text-text-primary">
              {t("desktop.craft.canvas.cvC.part.permission")}
            </span>
            <span className={`text-ui-sm ${high ? "text-warning-text" : "text-text-secondary"}`}>
              {riskLabel(ins.risk)}
            </span>
          </div>
          <div className="flex items-center gap-1 px-3.5" aria-hidden>
            {RISK_STEPS.slice(1).map((r, i) => (
              <span
                key={r}
                className={`h-1 flex-1 rounded-full ${i < level ? (high ? "bg-warning-solid" : "bg-text-secondary") : "bg-fill-hover"}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
            {noCode ? (
              <span className="rounded-md border border-dashed border-border-default px-2 py-0.5 text-ui-sm text-text-secondary">
                {t("desktop.craft.canvas.cvC.part.noCode")}
              </span>
            ) : (
              ins.permissions.map((k) => (
                <span
                  key={k}
                  className="rounded-md border border-border-subtle px-2 py-0.5 text-ui-sm text-text-secondary"
                >
                  {permissionLabel(k)}
                </span>
              ))
            )}
          </div>
        </div>
      );
    }
    default:
      return assertNever(pc, "PieceView");
  }
}

function LinesView(props: { readonly plan: Plan }): ReactNode {
  const b = props.plan.bounds;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={b.w}
      height={b.h}
      viewBox={`${String(b.x)} ${String(b.y)} ${String(b.w)} ${String(b.h)}`}
      style={{ translate: `${String(b.x)}px ${String(b.y)}px` }}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.plan.lines.map((l) => {
        switch (l.kind) {
          case "attach":
            return (
              <g key={l.d}>
                <path d={l.d} stroke="var(--cs-color-border-strong)" strokeWidth={1.25} />
                <circle
                  cx={l.dot.x}
                  cy={l.dot.y}
                  r={3.25}
                  fill="var(--cs-color-surface-base)"
                  stroke="var(--cs-color-border-strong)"
                  strokeWidth={1.5}
                />
              </g>
            );
          case "flow":
            return (
              <g key={l.d} stroke="var(--cs-color-text-tertiary)" strokeWidth={1.25}>
                <path d={l.d} />
                <path d={l.tip} />
              </g>
            );
          case "loop":
            return (
              <g key={l.d} stroke="var(--cs-color-text-tertiary)" strokeWidth={1.25}>
                <path d={l.d} strokeDasharray="2 4" />
                <path d={l.tip} />
              </g>
            );
          case "handoff":
            return (
              <g key={l.d} stroke="var(--cs-color-text-secondary)" strokeWidth={1.5}>
                <path d={l.d} strokeDasharray="5 4" />
                <path d={l.tip} />
              </g>
            );
          default:
            return assertNever(l, "LinesView");
        }
      })}
    </svg>
  );
}

export interface PluginInsideProps {
  readonly name: string;
  /** 위쪽 경로의 첫 칸(돌아갈 프로필 이름) */
  readonly profileTitle: string;
  readonly onBack: () => void;
}

export function PluginInside(props: PluginInsideProps): ReactNode {
  const plugin = pluginOf(props.name);
  const dark = useCraftTheme() === "dark";
  const ref = useRef<HTMLDivElement>(null);
  const surface = useSurface(ref);
  const { view, setView } = surface;
  const plan = useMemo(() => (plugin === undefined ? null : planOf(plugin)), [plugin]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    el.focus();
    return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => {
    if (plan === null || size.w === 0) return;
    setView(fitView(plan.bounds, size.w, size.h, { left: 32, right: 32, top: 72, bottom: 40 }));
  }, [plan, size, setView]);
  useEffect(() => {
    fit();
  }, [fit]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onBack();
    }
  };
  if (plugin === undefined || plan === null) return null;
  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden bg-bg-canvas"
      onKeyDown={onKey}
      data-cvc-inside={plugin.name}
    >
      <div
        ref={ref}
        role="region"
        tabIndex={-1}
        aria-label={t("desktop.craft.canvas.cvC.inside.label", { name: plugin.name })}
        onPointerDown={(e) => surface.onPanStart(e)}
        className={`absolute inset-0 overflow-hidden outline-none ${surface.panning ? "cursor-grabbing" : ""}`}
      >
        <GlowGrid view={view} dark={dark} focus={null} />
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.k)})`,
          }}
        >
          {plan.pieces
            .filter((p) => p.type === "frame")
            .map((p) => (
              <PieceView key={p.key} piece={p} />
            ))}
          <LinesView plan={plan} />
          {plan.pieces
            .filter((p) => p.type !== "frame")
            .map((p) => (
              <PieceView key={p.key} piece={p} />
            ))}
          {plan.lines.map((l) =>
            l.kind === "handoff" ? (
              <span
                key={`tag-${l.d}`}
                className="pointer-events-none absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border-subtle bg-surface-base px-2 py-px text-ui-xs text-text-secondary"
                style={{ left: l.tag.x, top: l.tag.y }}
              >
                {t("desktop.craft.canvas.cvC.handoff")}
              </span>
            ) : null,
          )}
        </div>
      </div>
      {/* 위쪽 경로 */}
      <nav
        aria-label={t("desktop.craft.canvas.cvC.inside.path")}
        className="pointer-events-auto absolute top-3 left-3 z-20 flex h-10 items-center gap-1 rounded-2xl bg-material-regular pr-3 pl-1 shadow-2"
      >
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.inside.back")}
          onClick={props.onBack}
        >
          <ChevronLeft aria-hidden />
        </IconButton>
        <Button size="sm" variant="ghost" onClick={props.onBack}>
          {props.profileTitle}
        </Button>
        <span className="text-text-tertiary">/</span>
        <span className="flex items-center gap-2 pl-1.5">
          <KindWell kind={plugin.kind} />
          <span className="text-ui-strong text-text-primary" aria-current="page">
            {plugin.name}
          </span>
          <span className="text-ui-sm text-text-tertiary">{kindLabel(plugin.kind)}</span>
        </span>
      </nav>
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-material-regular p-1 shadow-2">
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvC.fit")}
          onClick={fit}
        >
          <Maximize aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
