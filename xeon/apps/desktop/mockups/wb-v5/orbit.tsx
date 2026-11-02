// 지도: 기본 에이전트를 가운데 두고 층을 고리로, 플러그인을 고리 위 점으로, 플러그인 그룹을 바깥 두꺼운 호로 묶는다.
// 점과 이름표는 HTML 단추(눌러 고르고, 끌어서 순서 줄에 놓는다). 고리·호·선은 SVG. 640×520 틀을 통째로 맞춰 줄인다.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { T } from "../_shell/terms";
import { ANGLE, CAPS, GROUPS, LAYER_CODE, LAYER_NAME, RING, capSlot, groupById, pluginById, type LayerKey, type Plugin } from "./data";
import { litOf, shadowedBy, useMock } from "./store";
import { useDragSource } from "./drag";

const W = 640;
const H = 520;
const CX = 320;
const CY = 262;
const RADII = [70, 116, 162, 208];
const ARC_R = 238;
const ARC_PAD = 12;
const RING_LAYER: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];

const ringLabel = (k: LayerKey): string => (k === "plugin" ? LAYER_NAME[k] : `${LAYER_CODE[k]} ${LAYER_NAME[k]}`);
const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180;
const pt = (deg: number, r: number): { x: number; y: number } => ({ x: CX + r * Math.cos(rad(deg)), y: CY + r * Math.sin(rad(deg)) });
const textW = (s: string): number => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 127 ? 13.6 : 7.6), 0);

function arcPath(from: number, to: number, r: number): string {
  const a = pt(from, r);
  const b = pt(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

interface NodeView {
  p: Plugin;
  x: number;
  y: number;
  right: boolean;
}
function place(p: Plugin): NodeView {
  const a = ANGLE[p.id] ?? 0;
  const r = RADII[RING[p.layer]] ?? RADII[3] ?? 208;
  const { x, y } = pt(a, r);
  return { p, x, y, right: x >= CX - 1 };
}

export function Orbit({ children }: { children?: ReactNode }) {
  const m = useMock();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const fit = (): void => setScale(Math.min(el.clientWidth / W, el.clientHeight / H, 1.25));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lit = litOf(m.sel, m.plugins, m.order);
  const nodes = m.plugins.map(place);
  const at = (id: string): NodeView | undefined => nodes.find((n) => n.p.id === id);

  // 선: 선택한 것이 기본 에이전트에 닿는 곳(실선), 기능을 주고받는 곳(점선)
  const solid: { x: number; y: number; key: string }[] = [];
  const dashed: { a: { x: number; y: number }; b: { x: number; y: number }; key: string }[] = [];
  const centerTo = (id: string): void => {
    const n = at(id);
    if (n !== undefined) solid.push({ x: n.x, y: n.y, key: `c-${id}` });
  };
  if (m.sel.k === "plugin" || m.sel.k === "group" || m.sel.k === "hook") for (const id of lit.plugins) centerTo(id);
  const partners = (p: Plugin): Plugin[] => [
    ...m.plugins.filter((q) => q.id !== p.id && (q.optional ?? []).some((c) => p.provides.includes(c))),
    ...m.plugins.filter((q) => q.id !== p.id && q.provides.some((c) => (p.optional ?? []).includes(c))),
  ];
  if (m.sel.k === "plugin") {
    const p = pluginById(m.sel.id) ?? m.plugins.find((q) => q.id === (m.sel.k === "plugin" ? m.sel.id : ""));
    const from = p === undefined ? undefined : at(p.id);
    if (p !== undefined && from !== undefined)
      for (const q of partners(p)) {
        const to = at(q.id);
        if (to !== undefined) dashed.push({ a: from, b: to, key: `d-${p.id}-${q.id}` });
      }
  }
  // 대체: 가려진 내장과 대체한 플러그인을 점선으로 잇는다
  for (const c of CAPS) {
    const by = m.replaced[capSlot(c.id)];
    const a = at(c.builtin);
    const b = by === undefined ? undefined : at(by);
    if (a !== undefined && b !== undefined) dashed.push({ a, b, key: `r-${c.id}` });
  }

  return (
    <div ref={box} className="wb5-paper relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[28px] border border-border-subtle">
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 text-text-primary" aria-hidden>
          {RADII.map((r, i) => (
            <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14 + i * 0.05} strokeWidth={1} />
          ))}
          {RADII.map((r, i) => (
            <text key={`l${r}`} x={CX - r * Math.sin((8 * Math.PI) / 180)} y={CY - r * Math.cos((8 * Math.PI) / 180) - 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.62}
              style={{ paintOrder: "stroke", stroke: "var(--cs-color-surface-base)", strokeWidth: 4 }}>
              {ringLabel(RING_LAYER[i] ?? "plugin")}
            </text>
          ))}
          {GROUPS.map((g) => {
            const angles = g.members.map((id) => ANGLE[id]).filter((a): a is number => a !== undefined);
            const from = Math.min(...angles) - ARC_PAD;
            const to = Math.max(...angles) + ARC_PAD;
            const on = (m.sel.k === "group" && m.sel.id === g.id) || (m.sel.k === "plugin" && groupById(g.id)?.members.includes(m.sel.id) === true);
            const dim = lit.active && !lit.plugins.has(g.members[0] ?? "") && !g.members.some((id) => lit.plugins.has(id));
            return (
              <path key={g.id} d={arcPath(from, to, ARC_R)} fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round"
                strokeOpacity={on ? 0.9 : dim ? 0.12 : 0.28} />
            );
          })}
          {solid.map((l) => (
            <line key={l.key} x1={CX} y1={CY} x2={l.x} y2={l.y} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} />
          ))}
          {dashed.map((l) => (
            <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="4 4" />
          ))}
        </svg>

        <button
          type="button"
          onClick={() => m.select({ k: "agent" })}
          aria-label={`${T.baseAgent} 보기`}
          aria-pressed={m.sel.k === "agent"}
          className={`absolute grid cursor-pointer place-items-center rounded-full border-0 bg-text-primary text-center text-surface-base outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${m.sel.k === "agent" ? "shadow-[0_0_0_5px_var(--cs-color-surface-base),0_0_0_6.5px_var(--cs-color-text-primary)]" : ""}`}
          style={{ left: CX - 38, top: CY - 38, width: 76, height: 76 }}
        >
          <span className="grid gap-0.5">
            <span className="text-ui-sm">{T.baseAgent}</span>
            <span className="font-mono text-[10px] opacity-60">core.loop</span>
          </span>
        </button>

        {GROUPS.map((g) => {
          const angles = g.members.map((id) => ANGLE[id]).filter((a): a is number => a !== undefined);
          const mid = (Math.min(...angles) + Math.max(...angles)) / 2;
          const { x, y } = pt(mid, ARC_R);
          const label = `${g.name}`;
          const w = textW(label) + 26;
          const picked = m.sel.k === "group" && m.sel.id === g.id;
          const inGroup = m.sel.k === "plugin" && g.members.includes(m.sel.id);
          const dim = lit.active && !g.members.some((id) => lit.plugins.has(id));
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={picked}
              onClick={() => m.select({ k: "group", id: g.id })}
              className={`absolute flex h-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border text-[13px] leading-none outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${picked ? "border-text-primary bg-text-primary text-surface-base shadow-[0_0_0_3px_var(--cs-color-surface-base),0_0_0_4.5px_var(--cs-color-text-primary)]" : `bg-surface-base text-text-primary ${inGroup ? "border-text-primary" : "border-border-default"}`}`}
              style={{ left: x, top: y, width: w, opacity: dim ? 0.45 : 1 }}
            >
              {label}
            </button>
          );
        })}

        {nodes.map((n) => (
          <Node key={n.p.id} n={n} lit={lit.plugins.has(n.p.id)} dim={lit.active && !lit.plugins.has(n.p.id)} />
        ))}
      </div>
      {children !== undefined && <div className="absolute left-3 top-3 z-10">{children}</div>}
    </div>
  );
}

function Node({ n, lit, dim }: { n: NodeView; lit: boolean; dim: boolean }) {
  const m = useMock();
  const { p } = n;
  const on = m.isOn(p.id);
  const h = m.health(p.id);
  const failing = h !== undefined;
  const shadow = shadowedBy(p.id, m.replaced);
  const picked = m.sel.k === "plugin" && m.sel.id === p.id;
  const label = `${p.name}${p.drives === true && m.isOn(p.id) ? ` · ${T.lead}` : ""}`;
  const w = textW(label) + 24;
  const drag = useDragSource({ id: p.id, from: null, label: p.name });
  const onKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      m.select({ k: "plugin", id: p.id });
    }
  };
  const faded = shadow !== null;
  return (
    <>
      <span
        aria-hidden
        className={`absolute rounded-full ${on ? "bg-text-primary" : "border border-text-primary bg-surface-base"} ${failing ? "!border-danger-graphic !bg-danger-graphic" : ""} ${faded ? "border-dashed !bg-surface-base opacity-60" : ""}`}
        style={{ left: n.x - 6, top: n.y - 6, width: 12, height: 12, opacity: dim ? 0.4 : undefined }}
      />
      {picked && (
        <span aria-hidden className="absolute rounded-full border border-text-primary" style={{ left: n.x - 12, top: n.y - 12, width: 24, height: 24 }} />
      )}
      {failing && !picked && (
        <span aria-hidden className="absolute rounded-full border border-danger-graphic" style={{ left: n.x - 10, top: n.y - 10, width: 20, height: 20, opacity: dim ? 0.4 : 1 }} />
      )}
      <button
        type="button"
        aria-pressed={picked}
        aria-label={p.name}
        onClick={() => m.select({ k: "plugin", id: p.id })}
        onKeyDown={onKey}
        onPointerDown={drag}
        className={`absolute flex h-7 cursor-pointer select-none items-center whitespace-nowrap rounded-full border px-3 text-[13px] leading-none outline-none focus-visible:shadow-[0_0_0_3px_var(--cs-color-focus-ring)] ${
          picked
            ? "border-text-primary bg-text-primary text-surface-base"
            : `bg-surface-base ${lit ? "border-text-primary text-text-primary" : "border-border-default"} ${on ? "text-text-primary" : "text-text-tertiary"}`
        } ${failing && !picked ? "!border-danger-border" : ""}`}
        style={{ left: n.right ? n.x + 12 : n.x - 12 - w, top: n.y - 14, width: w, opacity: dim ? 0.45 : faded ? 0.55 : 1, touchAction: "none" }}
      >
        <span className={faded ? "line-through" : ""}>{label}</span>
      </button>
    </>
  );
}
