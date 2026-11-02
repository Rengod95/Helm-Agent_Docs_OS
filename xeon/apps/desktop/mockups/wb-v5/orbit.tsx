// 지도(orbit): 기본 에이전트를 가운데 두고 층을 원 고리로, 플러그인을 고리 위 점으로, 플러그인 그룹을 바깥 호로 묶는다.
// 세계 좌표(1000×1000)에 원을 그리고 화면 배율과 이동은 CSS 변수 하나로만 옮긴다: 어느 화면 비율에서도 원이고, 확대·이동은 React를 거치지 않는다.
// 선은 SVG, 이름표·점·코어는 그 위 HTML(caustic 칩)이다. 글자는 확대에 따라 조금만 커지고 줄어든다(--ls).
import {
  FloatingBar,
  FloatingBarItem,
  FloatingBarSeparator,
  Tooltip,
  Chip,
  ZoomControl,
} from "@caustic/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Maximize } from "../_shell";
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
import { Field, type LitPoint } from "./field";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { litOf, shadowedBy, useMock } from "./store";
import { CENTER, OUTER, panGuard, setVars, useViewport, vtName, type Insets } from "./viewport";

export type { Insets };

const FRAC = [0.28, 0.5, 0.71, 0.89] as const;
const RING_LAYER: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];
/** 그룹 이름표가 앉는 호의 끝. 구성원 이름표와 겹치지 않는 쪽으로 골랐다. */
const GROUP_END: Record<string, "from" | "to"> = { helm: "from", learning: "to", review: "from" };
/** 코어 지름(화면 px, 배율 1) */
const CORE = 88;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const pt = (deg: number, f: number): { x: number; y: number } => ({
  x: CENTER + f * OUTER * Math.sin(rad(deg)),
  y: CENTER - f * OUTER * Math.cos(rad(deg)),
});
/** 선 굵기(화면 px)를 세계 좌표로: 확대해도 굵기가 같다 */
const sw = (px: number): string => `calc(${px}px / var(--k))`;
const place = (x: number, y: number): string =>
  `translate(calc(var(--tx) + var(--k) * ${x.toFixed(1)}px), calc(var(--ty) + var(--k) * ${y.toFixed(1)}px))`;
const safeId = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, "_");

function arcPath(from: number, to: number): string {
  const a = pt(from, 1);
  const b = pt(to, 1);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${OUTER} ${OUTER} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
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

interface LinkSpec {
  a: { x: number; y: number };
  b: { x: number; y: number };
  key: string;
  color: string;
  dash: boolean;
  w: number;
  o: number;
}

/** 화면 위치에 놓는 틀: 위치는 세계 좌표 × 배율, 크기는 글자 배율(--ls)을 따른다 */
function Pin({
  x,
  y,
  children,
  style,
}: {
  x: number;
  y: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{ transform: place(x, y), ...style }}
    >
      <div style={{ transform: "scale(var(--ls))", transformOrigin: "0 0" }}>{children}</div>
    </div>
  );
}

export function Orbit({
  insets,
  zoomSlot,
}: {
  insets: Insets;
  /** 확대·축소 막대가 앉을 자리(캔버스가 둔다) */
  zoomSlot: HTMLElement | null;
}) {
  const m = useMock();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<LayerKey | null>(null);
  const [glOk, setGlOk] = useState(true);
  const noGl = useCallback(() => setGlOk(false), []);
  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const fit = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vp = useViewport(box, size, insets);
  const lit = litOf(m.sel, m.plugins, m.order);
  const at = (id: string): { x: number; y: number } | undefined => {
    const p = m.plugins.find((q) => q.id === id);
    if (p === undefined) return undefined;
    return pt(ANGLE[p.id] ?? 0, FRAC[RING[p.layer]] ?? FRAC[3]);
  };
  const tone = (p: Plugin | undefined): string =>
    p?.group !== undefined ? GRP.graphic : "var(--cs-color-text-primary)";

  // 선: 고른 것이 기본 에이전트에 닿는 곳(실선), 같은 그룹의 구성원끼리(그룹색 실선), 기능을 주고받는 곳(점선)
  const links: LinkSpec[] = [];
  const center = { x: CENTER, y: CENTER };
  const linking =
    m.sel.k === "plugin" || m.sel.k === "group" || m.sel.k === "hook" || m.sel.k === "layer";
  const selKey = JSON.stringify(m.sel);
  if (linking)
    for (const id of lit.plugins) {
      const p = m.plugins.find((q) => q.id === id);
      const to = at(id);
      if (to !== undefined)
        links.push({
          a: center,
          b: to,
          key: `c-${id}`,
          color: tone(p),
          dash: false,
          w: 1.4,
          o: 0.8,
        });
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
          links.push({
            a: root,
            b: to,
            key: `g-${id}`,
            color: GRP.graphic,
            dash: false,
            w: 1.6,
            o: 0.95,
          });
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
            color: "var(--cs-color-text-primary)",
            dash: true,
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
      links.push({
        a,
        b,
        key: `r-${c.id}`,
        color: "var(--cs-color-text-primary)",
        dash: true,
        w: 1.2,
        o: 0.6,
      });
  }

  // 배경 셰이더가 밝힐 점: 고른 것에 들어 있는 플러그인
  const litPoints = useMemo<LitPoint[]>(() => {
    const out: LitPoint[] = [];
    for (const id of lit.plugins) {
      const p = m.plugins.find((q) => q.id === id);
      if (p === undefined) continue;
      const pos = pt(ANGLE[p.id] ?? 0, FRAC[RING[p.layer]] ?? FRAC[3]);
      out.push({ x: pos.x, y: pos.y, s: lit.primary === id ? 1.2 : 0.7 });
    }
    return out;
  }, [lit.plugins, lit.primary, m.plugins]);
  const coreInfo = useMemo(() => ({ x: CENTER, y: CENTER, r: OUTER * 0.9 }), []);

  const onBackground = (e: { target: EventTarget; currentTarget: EventTarget }): void => {
    if (panGuard.current) return;
    if (
      e.target === e.currentTarget ||
      e.target instanceof SVGSVGElement ||
      e.target instanceof HTMLCanvasElement
    )
      m.select({ k: "agent" }, false);
  };

  const coreSel = m.sel.k === "agent" && m.panel;

  return (
    <div
      ref={box}
      role="presentation"
      onClick={onBackground}
      className={`wb5-stage absolute inset-0 touch-none overflow-hidden ${vp.panning ? "cursor-grabbing" : "cursor-grab"} ${glOk ? "" : "wb5-paper"}`}
      style={{ opacity: size.w === 0 ? 0 : 1 }}
      data-stage
    >
      {glOk && <Field view={vp.view} core={coreInfo} lit={litPoints} onUnavailable={noGl} />}
      <svg className="absolute inset-0 size-full text-text-primary" onClick={onBackground}>
        <defs>
          <linearGradient
            id="wb5-ring"
            gradientUnits="userSpaceOnUse"
            x1="140"
            y1="80"
            x2="860"
            y2="920"
          >
            <stop offset="0" stopColor="currentColor" stopOpacity="0.46" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
          </linearGradient>
          <radialGradient id="wb5-halo" gradientUnits="userSpaceOnUse" cx="500" cy="500" r="190">
            <stop offset="0" style={{ stopColor: GRP.graphic }} stopOpacity="0.2" />
            <stop offset="1" style={{ stopColor: GRP.graphic }} stopOpacity="0" />
          </radialGradient>
          {GROUPS.map((gr) => {
            const span = groupSpan(gr.id);
            if (span === null) return null;
            const a = pt(span.from, 1);
            const b = pt(span.to, 1);
            return (
              <linearGradient
                key={gr.id}
                id={`wb5-arc-${safeId(gr.id)}`}
                gradientUnits="userSpaceOnUse"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              >
                <stop offset="0" style={{ stopColor: GRP.graphic }} stopOpacity="0" />
                <stop offset="0.16" style={{ stopColor: GRP.graphic }} stopOpacity="1" />
                <stop offset="0.84" style={{ stopColor: GRP.graphic }} stopOpacity="1" />
                <stop offset="1" style={{ stopColor: GRP.graphic }} stopOpacity="0" />
              </linearGradient>
            );
          })}
          {links.map((l) =>
            l.dash ? null : (
              <linearGradient
                key={l.key}
                id={`wb5-l-${safeId(l.key)}`}
                gradientUnits="userSpaceOnUse"
                x1={l.a.x}
                y1={l.a.y}
                x2={l.b.x}
                y2={l.b.y}
              >
                <stop offset="0" style={{ stopColor: l.color }} stopOpacity="0.1" />
                <stop offset="1" style={{ stopColor: l.color }} stopOpacity={l.o} />
              </linearGradient>
            ),
          )}
        </defs>
        <g className="wb5-world">
          <circle cx={CENTER} cy={CENTER} r={190} fill="url(#wb5-halo)" />
          {FRAC.map((f, i) => {
            const layer = RING_LAYER[i] ?? "plugin";
            const open = m.ring === layer;
            const hot = hover === layer;
            const r = f * OUTER;
            const circ = 2 * Math.PI * r;
            return (
              <g key={layer} className="wb5-ring" style={{ animationDelay: `${i * 90}ms` }}>
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={r}
                  fill="none"
                  stroke={open || hot ? "currentColor" : "url(#wb5-ring)"}
                  style={{
                    strokeWidth: sw(open ? 2.2 : hot ? 1.8 : 1),
                    strokeOpacity: open ? 0.85 : hot ? 0.6 : 1,
                    transition: "stroke-opacity .2s, stroke-width .2s",
                  }}
                />
                <g className={i % 2 === 0 ? "wb5-drift" : "wb5-drift wb5-drift-rev"}>
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={r - 3.5}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.3}
                    style={{
                      strokeWidth: sw(4),
                      strokeDasharray: `calc(1px / var(--k)) calc(${(circ / 120).toFixed(2)}px - 1px / var(--k))`,
                    }}
                  />
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={r - 5}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.4}
                    style={{
                      strokeWidth: sw(7),
                      strokeDasharray: `calc(1.4px / var(--k)) calc(${(circ / 12).toFixed(2)}px - 1.4px / var(--k))`,
                    }}
                  />
                </g>
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={r}
                  fill="none"
                  stroke="transparent"
                  style={{ strokeWidth: sw(26), pointerEvents: "stroke", cursor: "pointer" }}
                  onPointerEnter={() => setHover(layer)}
                  onPointerLeave={() => setHover((h) => (h === layer ? null : h))}
                  onClick={(e) => {
                    if (panGuard.current) return;
                    e.stopPropagation();
                    m.openRing(layer);
                  }}
                />
              </g>
            );
          })}
          {GROUPS.map((gr, gi) => {
            const span = groupSpan(gr.id);
            if (span === null) return null;
            const on = gid === gr.id;
            const dim = lit.active && !gr.members.some((id) => lit.plugins.has(id));
            const allOff = gr.members.every((id) => !m.isOn(id));
            const faded = !gr.members.some((id) =>
              m.plugins.some((p) => p.id === id && m.matches(p)),
            );
            const d = arcPath(span.from, span.to);
            return (
              <g
                key={gr.id}
                style={{
                  opacity: on ? 1 : dim || faded ? 0.25 : 0.7,
                  transition: "opacity .25s",
                }}
              >
                <path
                  d={d}
                  fill="none"
                  stroke={`url(#wb5-arc-${safeId(gr.id)})`}
                  strokeLinecap="round"
                  className={allOff ? undefined : "wb5-sweep"}
                  pathLength={allOff ? undefined : 1}
                  style={{
                    strokeWidth: sw(on ? 6 : 4.5),
                    transition: "stroke-width .25s",
                    animationDelay: `${420 + gi * 140}ms`,
                    ...(allOff
                      ? { strokeDasharray: `calc(2px / var(--k)) calc(10px / var(--k))` }
                      : {}),
                  }}
                />
                <path
                  d={arcPath(span.from + 3, span.to - 3)}
                  fill="none"
                  stroke={`url(#wb5-arc-${safeId(gr.id)})`}
                  style={{ strokeWidth: sw(1), opacity: 0.55 }}
                  transform={`translate(${CENTER} ${CENTER}) scale(1.024) translate(${-CENTER} ${-CENTER})`}
                />
              </g>
            );
          })}
          {links.map((l) =>
            l.dash ? (
              <line
                key={`${selKey}-${l.key}`}
                x1={l.a.x}
                y1={l.a.y}
                x2={l.b.x}
                y2={l.b.y}
                stroke={l.color}
                className="wb5-fade"
                style={{
                  strokeOpacity: l.o,
                  strokeWidth: sw(l.w),
                  strokeDasharray: `calc(4px / var(--k)) calc(4px / var(--k))`,
                  pointerEvents: "none",
                }}
              />
            ) : (
              <line
                key={`${selKey}-${l.key}`}
                x1={l.a.x}
                y1={l.a.y}
                x2={l.b.x}
                y2={l.b.y}
                pathLength={1}
                stroke={`url(#wb5-l-${safeId(l.key)})`}
                className="wb5-draw"
                style={{ strokeWidth: sw(l.w), strokeDasharray: 1, pointerEvents: "none" }}
              />
            ),
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {RING_LAYER.map((layer, i) => {
          const p = pt(0, FRAC[i] ?? 1);
          const open = m.ring === layer;
          return (
            <Pin key={layer} x={p.x} y={p.y}>
              <div className="pointer-events-auto -translate-x-1/2 -translate-y-1/2">
                <Chip
                  size="sm"
                  variant={open ? "solid" : "surface"}
                  data-box={`ring-${layer}`}
                  aria-label={`${ringName(layer)} 층 보기`}
                  onClick={() => m.openRing(layer)}
                  onPointerEnter={() => setHover(layer)}
                  onPointerLeave={() => setHover((h) => (h === layer ? null : h))}
                >
                  {ringName(layer)}
                </Chip>
              </div>
            </Pin>
          );
        })}

        <Pin x={CENTER} y={CENTER}>
          <div
            className="pointer-events-none relative -translate-x-1/2 -translate-y-1/2"
            style={{ width: 140, height: 140 }}
          >
            <svg
              viewBox="-70 -70 140 140"
              className="absolute inset-0 overflow-visible"
              aria-hidden
            >
              <circle
                r={60}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.14}
                strokeWidth={1}
                className="text-text-primary"
              />
              <circle
                r={66}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
                className="text-text-primary"
              />
              <g className="wb5-comet">
                {[0, 1, 2, 3, 4, 5].map((j) => {
                  const a0 = -j * 11;
                  const a1 = a0 - 11;
                  const p0 = { x: 60 * Math.sin(rad(a0)), y: -60 * Math.cos(rad(a0)) };
                  const p1 = { x: 60 * Math.sin(rad(a1)), y: -60 * Math.cos(rad(a1)) };
                  return (
                    <path
                      key={j}
                      d={`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A 60 60 0 0 0 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`}
                      fill="none"
                      strokeLinecap="round"
                      strokeWidth={1.6}
                      strokeOpacity={0.7 - j * 0.12}
                      style={{ stroke: GRP.graphic }}
                    />
                  );
                })}
                <circle cx={0} cy={-60} r={2.6} style={{ fill: GRP.graphic }} />
              </g>
            </svg>
            <button
              type="button"
              data-box="core"
              onClick={() => m.select({ k: "agent" })}
              aria-label={`${T.baseAgent} 보기`}
              aria-pressed={coreSel}
              className={`wb5-core pointer-events-auto absolute grid cursor-pointer place-items-center rounded-full border-0 text-center text-surface-base outline-none focus-visible:shadow-focus ${coreSel ? "wb5-core-on" : ""}`}
              style={{ width: CORE, height: CORE, left: (140 - CORE) / 2, top: (140 - CORE) / 2 }}
            >
              <span className="grid gap-px leading-tight">
                <span className="whitespace-nowrap text-ui-sm font-medium">{T.baseAgent}</span>
                <span className="font-mono text-[10px] opacity-60">core.loop</span>
              </span>
            </button>
          </div>
        </Pin>

        {GROUPS.map((gr) => {
          const span = groupSpan(gr.id);
          if (span === null) return null;
          const mid = pt(GROUP_END[gr.id] === "to" ? span.to : span.from, 1);
          const pickedG = m.sel.k === "group" && m.sel.id === gr.id;
          const inGroup = gid === gr.id;
          const dim = lit.active && !gr.members.some((id) => lit.plugins.has(id));
          const faded = !gr.members.some((id) =>
            m.plugins.some((p) => p.id === id && m.matches(p)),
          );
          return (
            <Pin key={gr.id} x={mid.x} y={mid.y}>
              <div
                className="pointer-events-auto -translate-x-1/2 -translate-y-1/2"
                style={{ opacity: dim || faded ? 0.4 : 1, transition: "opacity .25s" }}
              >
                <Chip
                  size="md"
                  tone={pickedG ? "neutral" : "info"}
                  variant="solid"
                  shadow={inGroup ? "2" : undefined}
                  data-box={`group-${gr.name}`}
                  aria-pressed={pickedG}
                  aria-label={`${gr.name} ${T.group}`}
                  onClick={() => m.select({ k: "group", id: gr.id })}
                >
                  {gr.name}
                </Chip>
              </div>
            </Pin>
          );
        })}

        {m.plugins.map((p, i) => {
          const pos = at(p.id);
          if (pos === undefined) return null;
          return (
            <Node
              key={p.id}
              p={p}
              index={i}
              x={pos.x}
              y={pos.y}
              right={pos.x >= CENTER - 1}
              lit={lit.plugins.has(p.id)}
              primary={lit.primary === p.id}
              dim={(lit.active && !lit.plugins.has(p.id)) || !m.matches(p)}
            />
          );
        })}
      </div>

      {zoomSlot !== null &&
        createPortal(
          <FloatingBar label="확대와 이동" size="sm" radius="lg" className="pointer-events-auto">
            <ZoomControl
              variant="ghost"
              size="sm"
              readout="static"
              value={`${vp.percent}%`}
              label="확대·축소"
              zoomOutLabel="축소"
              zoomInLabel="확대"
              onZoomOut={() => vp.zoomBy(1 / 1.25)}
              onZoomIn={() => vp.zoomBy(1.25)}
            />
            <FloatingBarSeparator />
            <FloatingBarItem icon={<Maximize />} aria-label="전체 보기" onClick={vp.fit} />
          </FloatingBar>,
          zoomSlot,
        )}
    </div>
  );
}

function Node({
  p,
  index,
  x,
  y,
  right,
  lit,
  primary,
  dim,
}: {
  p: Plugin;
  index: number;
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
  const variant = strong
    ? "solid"
    : failing
      ? "outline"
      : !on
        ? "dashed"
        : isGroup
          ? "soft"
          : "surface";
  const chipTone = strong ? "neutral" : failing ? "danger" : isGroup ? "info" : "neutral";
  const gname = p.group === undefined ? undefined : groupById(p.group)?.name;
  const tip = `${p.layer === "plugin" ? LAYER_NAME[p.layer] : `${p.layer} ${LAYER_NAME[p.layer]}`}${gname === undefined ? "" : ` · ${gname} ${T.group}`} · ${p.role}`;
  const dx = (CENTER - x) * 0.34;
  const dy = (CENTER - y) * 0.34;
  return (
    <Pin
      x={x}
      y={y}
      style={{ opacity: dim ? 0.32 : shadow ? 0.55 : 1, transition: "opacity .25s" }}
    >
      <div
        className="wb5-settle"
        ref={setVars({
          "--dx": `calc(var(--k) * ${dx.toFixed(1)}px)`,
          "--dy": `calc(var(--k) * ${dy.toFixed(1)}px)`,
        })}
        style={{ animationDelay: `${160 + index * 34}ms` }}
      >
        {failing && (
          <span
            aria-hidden
            className="wb5-alert absolute left-0 top-0 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full"
          />
        )}
        <button
          type="button"
          data-dot={p.id}
          aria-label={`${p.name} 점`}
          tabIndex={-1}
          onClick={pick}
          className="pointer-events-auto absolute grid size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0"
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
        <div
          className="pointer-events-auto absolute top-0 -translate-y-1/2"
          style={{ ...(right ? { left: 19 } : { right: 19 }), viewTransitionName: vtName(p.id) }}
        >
          <Tooltip content={tip} side={right ? "right" : "left"} delayDuration={500}>
            <Chip
              size="md"
              variant={variant}
              tone={chipTone}
              shadow={lit && !strong ? "2" : undefined}
              count={lead ? T.lead : undefined}
              data-box={`node-${p.id}`}
              aria-pressed={picked}
              onClick={pick}
              onKeyDown={onKey}
              className={shadow ? "line-through" : undefined}
            >
              {p.name}
            </Chip>
          </Tooltip>
        </div>
      </div>
    </Pin>
  );
}
