// 지도(orbit): 캔버스 가득, 기본 에이전트를 가운데 두고 층을 타원 고리로, 플러그인을 고리 위 점으로, 플러그인 그룹을 바깥 두꺼운 호로 묶는다.
// 고리는 얇은 선이지만 누를 자리는 넓다(보이지 않는 굵은 선). 점과 이름표는 HTML 단추. 크기는 놓인 영역에 맞춰 다시 계산한다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { T } from "../_shell/terms";
import {
  ANGLE,
  CAPS,
  GROUPS,
  LAYER_NAME,
  RING,
  capSlot,
  groupById,
  pluginById,
  type LayerKey,
  type Plugin,
} from "./data";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { litOf, shadowedBy, useMock } from "./store";

const FRAC = [0.28, 0.5, 0.71, 0.89] as const;
const RING_LAYER: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];
/** 그룹 이름표가 앉는 호의 끝. 구성원 이름표와 겹치지 않는 쪽으로 골랐다. */
const GROUP_END: Record<string, "from" | "to"> = { helm: "from", learning: "to", review: "from" };
const CORE = 36;
const ARC_FRAC = 1;

const rad = (deg: number): number => (deg * Math.PI) / 180;

interface Geo {
  w: number;
  h: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
function geoOf(w: number, h: number): Geo {
  const ryMax = Math.max(140, h / 2 - 22);
  const rx = Math.max(170, Math.min(ryMax * 1.6, (w / 2 - 120) / FRAC[3], w / 2 - 56));
  const ry = Math.min(ryMax, rx * 1.2);
  return { w, h, cx: w / 2, cy: h / 2, rx, ry };
}
const pt = (g: Geo, deg: number, f: number): { x: number; y: number } => ({
  x: g.cx + f * g.rx * Math.sin(rad(deg)),
  y: g.cy - f * g.ry * Math.cos(rad(deg)),
});

function arcPath(g: Geo, from: number, to: number): string {
  const a = pt(g, from, ARC_FRAC);
  const b = pt(g, to, ARC_FRAC);
  const rx = ARC_FRAC * g.rx;
  const ry = ARC_FRAC * g.ry;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

const ringName = (k: LayerKey): string =>
  k === "plugin" ? LAYER_NAME[k] : `${k} ${LAYER_NAME[k]}`;
const groupSpan = (id: string): { from: number; to: number } | null => {
  const g = groupById(id);
  const angles = (g?.members ?? [])
    .map((m) => ANGLE[m])
    .filter((a): a is number => a !== undefined);
  if (angles.length === 0) return null;
  return { from: Math.min(...angles) - 9, to: Math.max(...angles) + 9 };
};

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function Orbit({ insets }: { insets: Insets }) {
  const m = useMock();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [hover, setHover] = useState<LayerKey | null>(null);
  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const fit = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = geoOf(size.w, size.h);
  const lit = litOf(m.sel, m.plugins, m.order);
  const at = (id: string): { x: number; y: number } | undefined => {
    const p = m.plugins.find((q) => q.id === id);
    if (p === undefined) return undefined;
    return pt(g, ANGLE[p.id] ?? 0, FRAC[RING[p.layer]] ?? FRAC[3]);
  };
  const tone = (p: Plugin | undefined): string =>
    p?.group !== undefined ? GRP.graphic : "currentColor";

  // 선: 고른 것이 기본 에이전트에 닿는 곳(실선), 같은 그룹의 구성원끼리(그룹색 실선), 기능을 주고받는 곳(점선)
  const links: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    key: string;
    color: string;
    dash?: string;
    w: number;
    o: number;
  }[] = [];
  const center = { x: g.cx, y: g.cy };
  const linking =
    m.sel.k === "plugin" || m.sel.k === "group" || m.sel.k === "hook" || m.sel.k === "layer";
  if (linking)
    for (const id of lit.plugins) {
      const p = m.plugins.find((q) => q.id === id);
      const to = at(id);
      if (to !== undefined)
        links.push({ a: center, b: to, key: `c-${id}`, color: tone(p), w: 1.4, o: 0.6 });
    }
  const gid =
    m.sel.k === "group" ? m.sel.id : m.sel.k === "plugin" ? pluginById(m.sel.id)?.group : undefined;
  const grp = gid === undefined ? undefined : groupById(gid);
  if (grp !== undefined) {
    const root = at(grp.id) ?? at(grp.members[0] ?? "");
    if (root !== undefined)
      for (const id of grp.members) {
        const to = at(id);
        if (to !== undefined && id !== grp.id)
          links.push({ a: root, b: to, key: `g-${id}`, color: GRP.graphic, w: 1.6, o: 0.85 });
      }
  }
  const partners = (p: Plugin): Plugin[] => [
    ...m.plugins.filter(
      (q) => q.id !== p.id && (q.optional ?? []).some((c) => p.provides.includes(c)),
    ),
    ...m.plugins.filter(
      (q) => q.id !== p.id && q.provides.some((c) => (p.optional ?? []).includes(c)),
    ),
  ];
  const picked =
    m.sel.k === "plugin"
      ? m.plugins.find((q) => q.id === (m.sel.k === "plugin" ? m.sel.id : ""))
      : undefined;
  if (picked !== undefined) {
    const from = at(picked.id);
    if (from !== undefined)
      for (const q of partners(picked)) {
        const to = at(q.id);
        if (to !== undefined)
          links.push({
            a: from,
            b: to,
            key: `d-${picked.id}-${q.id}`,
            color: "currentColor",
            dash: "4 4",
            w: 1.2,
            o: 0.6,
          });
      }
  }
  for (const c of CAPS) {
    const by = m.replaced[capSlot(c.id)];
    const a = at(c.builtin);
    const b = by === undefined ? undefined : at(by);
    if (a !== undefined && b !== undefined)
      links.push({ a, b, key: `r-${c.id}`, color: "currentColor", dash: "4 4", w: 1.2, o: 0.6 });
  }

  const onBackground = (e: { target: EventTarget; currentTarget: EventTarget }): void => {
    if (e.target === e.currentTarget || e.target instanceof SVGSVGElement)
      m.select({ k: "agent" }, false);
  };

  return (
    <div
      ref={box}
      className="absolute"
      style={{ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }}
      onClick={onBackground}
      role="presentation"
    >
      <svg
        width={g.w}
        height={g.h}
        className="absolute inset-0 text-text-primary"
        onClick={onBackground}
      >
        {FRAC.map((f, i) => {
          const layer = RING_LAYER[i] ?? "plugin";
          const open = m.ring === layer;
          const hot = hover === layer;
          return (
            <g key={layer}>
              <ellipse
                cx={g.cx}
                cy={g.cy}
                rx={f * g.rx}
                ry={f * g.ry}
                fill="none"
                stroke="currentColor"
                strokeOpacity={open ? 0.8 : hot ? 0.55 : 0.16 + i * 0.04}
                strokeWidth={open ? 2.2 : hot ? 1.8 : 1}
              />
              <ellipse
                cx={g.cx}
                cy={g.cy}
                rx={f * g.rx}
                ry={f * g.ry}
                fill="none"
                stroke="transparent"
                strokeWidth={26}
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onPointerEnter={() => setHover(layer)}
                onPointerLeave={() => setHover((h) => (h === layer ? null : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  m.openRing(layer);
                }}
              />
            </g>
          );
        })}
        {GROUPS.map((gr) => {
          const span = groupSpan(gr.id);
          if (span === null) return null;
          const on = gid === gr.id;
          const dim = lit.active && !gr.members.some((id) => lit.plugins.has(id));
          const allOff = gr.members.every((id) => !m.isOn(id));
          const faded = !gr.members.some((id) =>
            m.plugins.some((p) => p.id === id && m.matches(p)),
          );
          return (
            <path
              key={gr.id}
              d={arcPath(g, span.from, span.to)}
              fill="none"
              stroke={GRP.graphic}
              strokeWidth={on ? 10 : 8}
              strokeLinecap="round"
              strokeDasharray={allOff ? "2 11" : undefined}
              strokeOpacity={on ? 1 : dim || faded ? 0.14 : 0.42}
            />
          );
        })}
        {links.map((l) => (
          <line
            key={l.key}
            x1={l.a.x}
            y1={l.a.y}
            x2={l.b.x}
            y2={l.b.y}
            stroke={l.color}
            strokeOpacity={l.o}
            strokeWidth={l.w}
            strokeDasharray={l.dash}
            style={{ pointerEvents: "none" }}
          />
        ))}
      </svg>

      {RING_LAYER.map((layer, i) => {
        const p = pt(g, 0, FRAC[i] ?? 1);
        const open = m.ring === layer;
        const count = m.plugins.filter((q) => q.layer === layer).length;
        return (
          <button
            key={layer}
            type="button"
            data-box={`ring-${layer}`}
            aria-pressed={open}
            aria-label={`${ringName(layer)} 층 ${count}개 보기`}
            onClick={() => m.openRing(layer)}
            onPointerEnter={() => setHover(layer)}
            onPointerLeave={() => setHover((h) => (h === layer ? null : h))}
            className={`absolute flex h-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center whitespace-nowrap rounded-full border px-2.5 text-[12px] leading-none outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${
              open
                ? "border-text-primary bg-text-primary text-surface-base"
                : hover === layer
                  ? "border-text-secondary bg-surface-base text-text-primary"
                  : "border-transparent bg-surface-base text-text-tertiary"
            }`}
            style={{ left: p.x, top: p.y }}
          >
            {ringName(layer)}
          </button>
        );
      })}

      <button
        type="button"
        data-box="core"
        onClick={() => m.select({ k: "agent" })}
        aria-label={`${T.baseAgent} 보기`}
        aria-pressed={m.sel.k === "agent" && m.panel}
        className={`absolute grid -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-text-primary text-center text-surface-base outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${m.sel.k === "agent" && m.panel ? "shadow-[0_0_0_5px_var(--cs-color-surface-base),0_0_0_6.5px_var(--cs-color-text-primary)]" : ""}`}
        style={{ left: g.cx, top: g.cy, width: CORE * 2, height: CORE * 2 }}
      >
        <span className="grid gap-0.5 leading-tight">
          <span className="text-[12px]">{T.baseAgent}</span>
          <span className="font-mono text-[10px] opacity-60">core.loop</span>
        </span>
      </button>

      {GROUPS.map((gr) => {
        const span = groupSpan(gr.id);
        if (span === null) return null;
        const mid = pt(g, GROUP_END[gr.id] === "to" ? span.to : span.from, ARC_FRAC);
        const pickedG = m.sel.k === "group" && m.sel.id === gr.id;
        const inGroup = gid === gr.id;
        const dim = lit.active && !gr.members.some((id) => lit.plugins.has(id));
        const faded = !gr.members.some((id) => m.plugins.some((p) => p.id === id && m.matches(p)));
        return (
          <GroupChip
            key={gr.id}
            kind="group"
            label={gr.name}
            x={mid.x}
            y={mid.y}
            picked={pickedG}
            lit={inGroup}
            dim={dim || faded}
            onPick={() => m.select({ k: "group", id: gr.id })}
          />
        );
      })}

      {m.plugins.map((p) => {
        const pos = at(p.id);
        if (pos === undefined) return null;
        return (
          <Node
            key={p.id}
            p={p}
            x={pos.x}
            y={pos.y}
            right={pos.x >= g.cx - 1}
            lit={lit.plugins.has(p.id)}
            primary={lit.primary === p.id}
            dim={(lit.active && !lit.plugins.has(p.id)) || !m.matches(p)}
          />
        );
      })}
    </div>
  );
}

/** 그룹 이름표(호 위). 그룹색 테두리와 작은 묶음 표시로 단일 플러그인 이름표와 가른다. */
function GroupChip({
  kind,
  label,
  x,
  y,
  picked,
  lit,
  dim,
  onPick,
}: {
  kind: "group";
  label: string;
  x: number;
  y: number;
  picked: boolean;
  lit: boolean;
  dim: boolean;
  onPick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      data-box={`${kind}-${label}`}
      aria-pressed={picked}
      aria-label={`${label} ${T.group}`}
      onClick={onPick}
      className={`absolute flex h-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium leading-none outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${
        picked ? "border-text-primary bg-text-primary text-surface-base" : "text-text-primary"
      }`}
      style={{
        left: x,
        top: y,
        opacity: dim ? 0.4 : 1,
        ...(picked
          ? {}
          : {
              background: GRP.soft,
              borderColor: lit ? GRP.graphic : GRP.border,
              borderWidth: lit ? 1.5 : 1,
            }),
      }}
    >
      <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
        <circle cx={3} cy={6} r={2} fill={picked ? "currentColor" : GRP.graphic} />
        <circle cx={9} cy={3} r={2} fill={picked ? "currentColor" : GRP.graphic} />
        <circle cx={9} cy={9} r={2} fill={picked ? "currentColor" : GRP.graphic} />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function Node({
  p,
  x,
  y,
  right,
  lit,
  primary,
  dim,
}: {
  p: Plugin;
  x: number;
  y: number;
  right: boolean;
  lit: boolean;
  primary: boolean;
  dim: boolean;
}) {
  const m = useMock();
  const on = m.isOn(p.id);
  const h = m.health(p.id);
  const failing = h !== undefined;
  const shadow = shadowedBy(p.id, m.replaced) !== null;
  const picked = primary && m.panel;
  const isGroup = p.group !== undefined;
  const lead = p.drives === true && on;
  const pick = (): void => m.select({ k: "plugin", id: p.id });
  const onKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick();
    }
  };
  const strong = picked || primary;
  return (
    <div className="absolute" style={{ left: x, top: y, opacity: dim ? 0.32 : shadow ? 0.55 : 1 }}>
      <button
        type="button"
        data-dot={p.id}
        aria-label={`${p.name} 점`}
        tabIndex={-1}
        onClick={pick}
        className="absolute grid size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0"
      >
        <Mark
          shape={SHAPE_OF[p.layer]}
          size={28}
          on={on}
          group={isGroup}
          failing={failing}
          autoOff={h?.autoOff === true}
          picked={strong}
          shadowed={shadow}
        />
      </button>
      <button
        type="button"
        data-box={`node-${p.id}`}
        aria-pressed={picked}
        onClick={pick}
        onKeyDown={onKey}
        className={`absolute top-0 flex h-7 -translate-y-1/2 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] leading-none outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${right ? "left-[17px]" : "right-[17px]"} ${
          strong
            ? "border-text-primary bg-text-primary text-surface-base"
            : `${on ? "text-text-primary" : "text-text-tertiary"} ${isGroup ? "" : "bg-surface-base"} ${failing ? "border-danger-border" : isGroup ? "" : lit ? "border-text-primary" : "border-border-default"}`
        }`}
        style={
          strong || isGroup === false
            ? undefined
            : {
                background: GRP.soft,
                borderColor: failing ? undefined : lit ? GRP.graphic : GRP.border,
                borderWidth: lit && !failing ? 1.5 : 1,
              }
        }
      >
        <span className={shadow ? "line-through" : ""}>{p.name}</span>
        {lead && <span className="text-[11px] opacity-65">{T.lead}</span>}
      </button>
    </div>
  );
}
