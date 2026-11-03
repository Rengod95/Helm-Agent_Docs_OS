// 지도(orbit): 기본 에이전트를 가운데 두고 층을 원 고리로, 플러그인을 고리 위 점으로, 플러그인 그룹을 바깥 호로 묶는다.
// 세계 좌표(1000×1000)에 원을 그리고 화면 배율과 이동은 CSS 변수 하나로만 옮긴다: 어느 화면 비율에서도 원이고, 확대·이동은 React를 거치지 않는다.
// 선은 SVG, 이름표·점·코어는 그 위 HTML(caustic 칩)이다. 글자는 확대에 따라 조금만 커지고 줄어든다(--ls).
import {
  FloatingBar,
  FloatingBarItem,
  FloatingBarSeparator,
  Tooltip,
  ZoomControl,
} from "@caustic/react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Maximize } from "../_shell";
import { T } from "../_shell/terms";
import { CoreOrb } from "./core";
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
import {
  CENTER,
  OUTER,
  panGuard,
  setVars,
  useViewport,
  vtName,
  type Insets,
  type View,
} from "./viewport";

export type { Insets };

const FRAC = [0.28, 0.5, 0.71, 0.89] as const;
const RING_LAYER: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];
/** 그룹 이름표가 앉는 호의 끝. 구성원 이름표와 겹치지 않는 쪽으로 골랐다. */
const GROUP_END: Record<string, "from" | "to"> = { helm: "from", learning: "to", review: "from" };
/** 코어 지름: 첫 고리(L1) 안지름의 75%. 고리와 함께 커져 언제나 같은 비율로 앉는다(세계 px, 배율 1) */
const R1 = FRAC[0] * OUTER;
const CORE = 0.75 * 2 * R1;
/** 코어 지름의 CSS 값: 확대(--k)에 따라 커지고, 글자 배율(--ls)은 상쇄한다 */
const CORE_SIZE = `calc(var(--k, 1) * ${CORE.toFixed(1)}px / var(--ls, 1))`;
/** 이름표 윗변: 구체 아래 첫 고리 바깥쪽에 앉는다(요약 직접 점 아래). 구체 지름의 %에 22px를 더한다. */
const CORE_LABEL_TOP = `calc(${(((CORE / 2 + R1) / CORE) * 100).toFixed(2)}% + 22px)`;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const pt = (deg: number, f: number): { x: number; y: number } => ({
  x: CENTER + f * OUTER * Math.sin(rad(deg)),
  y: CENTER - f * OUTER * Math.cos(rad(deg)),
});
/** 선 굵기(화면 px)를 세계 좌표로: 확대해도 굵기가 같다 */
const sw = (px: number): string => `calc(${px}px / var(--k))`;
/** 고리·호의 굵기: 화면 px에 판의 굵기 배율(--wb5-lw, 밝은 판은 조금 굵다)을 곱한다 */
const swl = (px: number): string => `calc(${px}px * var(--wb5-lw, 1) / var(--k))`;
/** 고리·호의 불투명도: 세기에 판의 배율(--wb5-line-gain)을 곱하고 1을 넘지 않게 한다(밝은 판은 진한 조각이 바탕과 3:1을 넘도록) */
const lineAlpha = (a: number): string => `min(1, calc(${a.toFixed(3)} * var(--wb5-line-gain, 1)))`;
const place = (x: number, y: number): string =>
  `translate(calc(var(--tx) + var(--k) * ${x.toFixed(1)}px), calc(var(--ty) + var(--k) * ${y.toFixed(1)}px))`;
const safeId = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, "_");

/** 0~1로 자른다 */
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 둘레 위 한 호: 반지름 f × OUTER, 각도 from→to(위가 0, 시계 방향) */
function arcAt(f: number, from: number, to: number): string {
  const a = pt(from, f);
  const b = pt(to, f);
  const r = (f * OUTER).toFixed(1);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
const arcPath = (from: number, to: number): string => arcAt(1, from, to);

/** 두 빛깔을 섞는다: w는 to 쪽 비율(0~1). CSS color-mix라서 밝은 판과 어두운 판이 토큰 값을 따른다. */
const mixOf = (from: string, to: string, w: number): string =>
  `color-mix(in oklab, ${to} ${Math.round(clamp01(w) * 100)}%, ${from})`;
const HUE_BLUE = "var(--wb5-ring-blue)";
const HUE_VIOLET = "var(--wb5-ring-violet)";
const HUE_MAGENTA = "var(--wb5-ring-magenta)";
/** 둘레의 빛깔: 0 파랑 → 0.5 보라 → 1 자홍 */
const ringHue = (u: number): string =>
  u <= 0.5 ? mixOf(HUE_BLUE, HUE_VIOLET, u * 2) : mixOf(HUE_VIOLET, HUE_MAGENTA, (u - 0.5) * 2);

/** 둘레 한 점의 세기 원자료(0~1)와 빛깔 위치(0~1). 사인 셋의 합이라 부드럽고, 고리마다 위상이 다르다. */
function ringSample(i: number, deg: number): { s: number; u: number } {
  const t = rad(deg);
  const s =
    0.5 +
    0.28 * Math.sin(2 * t + 0.4 + i * 1.9) +
    0.14 * Math.sin(3 * t + 2.1 + i * 2.7) +
    0.08 * Math.sin(5 * t + 4 + i * 1.3);
  return { s: clamp01(s), u: 0.5 + 0.5 * Math.sin(t + i * 1.7) };
}

/** 고리·호를 이루는 짧은 조각 하나: 경로, 빛깔, 세기 */
interface Seg {
  d: string;
  hue: string;
  a: number;
}
/** 고리 조각 수: 한 고리에 30개. 이웃과 0.3도씩 겹쳐 이음매가 비지 않는다. */
const RING_SEGS = 30;
function ringArt(i: number, f: number): Seg[] {
  const step = 360 / RING_SEGS;
  const samples = Array.from({ length: RING_SEGS }, (_, j) => ringSample(i, j * step + step / 2));
  // 세기는 고리마다 자기 최대에 맞춘다: 가장 밝은 조각은 0.835, 흐린 조각은 0.035 근처
  const top = Math.max(...samples.map((v) => v.s));
  const out: Seg[] = [];
  for (let j = 0; j < RING_SEGS; j++) {
    const v = samples[j];
    if (v === undefined) continue;
    out.push({
      d: arcAt(f, j * step - 0.3, (j + 1) * step + 0.3),
      hue: ringHue(v.u),
      a: 0.035 + 0.8 * (v.s / top) ** 2.2,
    });
  }
  return out;
}

/** 빛 토막의 반폭(도): 43° ≈ 둘레의 12% */
const LIGHT_HALF = 21.5;
/** 고리마다 빛의 시작 각도(도). 움직임 줄이기에서는 이 자리에 멈춘다. CSS 주기·지연과 맞춘다(orbit-lines.css). */
const LIGHT_START: readonly number[] = [30, 150, 250, 320];
/** 고리 넷: 반지름 비율, 조각, 빛 토막 경로, 시작 각도, 빛 번짐 색 */
const RINGS = FRAC.map((f, i) => ({
  f,
  segs: ringArt(i, f),
  light: arcAt(f, -LIGHT_HALF, LIGHT_HALF),
  start: LIGHT_START[i] ?? 0,
  glow: i % 2 === 0 ? HUE_BLUE : HUE_MAGENTA,
}));

/** 그룹 호의 두 끝 빛깔(처음 → 끝): 그룹마다 색조가 다르다 */
const GROUP_TINT: Record<string, readonly [string, string]> = {
  helm: [HUE_BLUE, HUE_VIOLET],
  learning: [HUE_VIOLET, HUE_MAGENTA],
  review: [HUE_MAGENTA, HUE_BLUE],
};
const DEFAULT_TINT: readonly [string, string] = [HUE_BLUE, HUE_VIOLET];
/** 그룹 빛줄기: 호를 한 번 지나는 주기(초, 고리 빛보다 느리다)와 시작 지연(초, 음수로 흩는다) */
const TRAVEL: Record<string, { sec: number; lag: number }> = {
  helm: { sec: 84, lag: 30 },
  learning: { sec: 96, lag: 58 },
  review: { sec: 72, lag: 9 },
};

/** 그룹 호 조각: 양 끝 20%에서 0까지 스며들고, 둘레를 따라 세기가 조금씩 흔들리며, 빛깔은 처음 → 끝으로 옮아 간다 */
function groupArt(id: string, from: number, to: number): Seg[] {
  const [ca, cb] = GROUP_TINT[id] ?? DEFAULT_TINT;
  const span = to - from;
  const n = Math.max(8, Math.round(span / 5));
  const out: Seg[] = [];
  for (let j = 0; j < n; j++) {
    const u = (j + 0.5) / n;
    const deg = from + span * u;
    const edge = clamp01(Math.min(1, u / 0.2, (1 - u) / 0.2));
    const fade = edge * edge * (3 - 2 * edge);
    const wave = 0.62 + 0.38 * Math.sin(4 * rad(deg) + from / 17);
    out.push({
      d: arcAt(1, from + span * (j / n) - 0.3, from + span * ((j + 1) / n) + 0.3),
      hue: mixOf(ca, cb, u),
      a: 0.92 * fade * wave,
    });
  }
  return out;
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

/** 이름표 안쪽의 빛이 포인터를 따라온다(CSS 변수 둘). 렌더를 거치지 않는다. */
function spot(e: ReactPointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function Orbit({
  insets,
  zoomSlot,
  view,
}: {
  insets: Insets;
  /** 확대·축소 막대가 앉을 자리(캔버스가 둔다) */
  zoomSlot: HTMLElement | null;
  /** 지도의 이동·배율. 배경이 같이 읽는다(캔버스가 쥔다) */
  view: RefObject<View>;
}) {
  const m = useMock();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
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
  const vp = useViewport(box, size, insets, view);
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
      className={`absolute inset-0 touch-none overflow-hidden ${vp.panning ? "cursor-grabbing" : "cursor-grab"}`}
      style={{ opacity: size.w === 0 ? 0 : 1 }}
      data-stage
    >
      <svg className="absolute inset-0 size-full text-text-primary" onClick={onBackground}>
        <defs>
          {/* 고리의 빛 토막: 가장자리에서 가운데로 밝아지는 띠 두 겹(번짐 색, 밝은 심). 호는 고리와 함께 돈다. */}
          {RINGS.map(({ f, glow }, i) => {
            const a = pt(-LIGHT_HALF, f);
            const b = pt(LIGHT_HALF, f);
            return (
              <Fragment key={i}>
                <linearGradient
                  id={`wb5-lg-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                >
                  <stop offset={0} style={{ stopColor: glow }} stopOpacity={0} />
                  <stop offset={0.5} style={{ stopColor: glow }} stopOpacity={0.5} />
                  <stop offset={1} style={{ stopColor: glow }} stopOpacity={0} />
                </linearGradient>
                <linearGradient
                  id={`wb5-lc-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                >
                  <stop offset={0} style={{ stopColor: "var(--wb5-light)" }} stopOpacity={0} />
                  <stop offset={0.5} style={{ stopColor: "var(--wb5-light)" }} stopOpacity={1} />
                  <stop offset={1} style={{ stopColor: "var(--wb5-light)" }} stopOpacity={0} />
                </linearGradient>
              </Fragment>
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
          {RINGS.map(({ f, segs, light, start }, i) => {
            const layer = RING_LAYER[i] ?? "plugin";
            const open = m.ring === layer;
            const hot = hover === layer;
            const r = f * OUTER;
            const circ = 2 * Math.PI * r;
            return (
              <g key={layer} className="wb5-ring" style={{ animationDelay: `${i * 90}ms` }}>
                {/* 고리 몸: 조각마다 빛깔과 세기가 다르다. 바깥에 아주 옅은 번짐 하나가 선 옆을 감싼다. */}
                <g style={{ opacity: open ? 1 : hot ? 0.95 : 0.9, transition: "opacity .2s" }}>
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={r}
                    fill="none"
                    style={{
                      stroke: "var(--wb5-ring-violet)",
                      strokeOpacity: 0.07,
                      strokeWidth: sw(6),
                    }}
                  />
                  {segs.map((s, j) => (
                    <path
                      key={j}
                      d={s.d}
                      fill="none"
                      data-a={s.a.toFixed(3)}
                      style={{
                        stroke: s.hue,
                        strokeOpacity: lineAlpha(s.a),
                        // 밝은 조각은 조금 굵고, 흐린 조각은 가늘다(세기가 굵기도 따른다)
                        strokeWidth: swl(
                          (open ? 2 : hot ? 1.6 : 1.25) * (0.75 + (0.5 * (s.a - 0.035)) / 0.8),
                        ),
                      }}
                    />
                  ))}
                </g>
                {/* 눈금: 가늘고 옅다 */}
                <g className={i % 2 === 0 ? "wb5-drift" : "wb5-drift wb5-drift-rev"}>
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={r - 3.5}
                    fill="none"
                    style={{
                      stroke: "var(--wb5-tick)",
                      strokeOpacity: 0.2,
                      strokeWidth: sw(1.4),
                      strokeDasharray: `calc(1px / var(--k)) calc(${(circ / 120).toFixed(2)}px - 1px / var(--k))`,
                    }}
                  />
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={r - 5}
                    fill="none"
                    style={{
                      stroke: "var(--wb5-tick)",
                      strokeOpacity: 0.26,
                      strokeWidth: sw(2.2),
                      strokeDasharray: `calc(1.4px / var(--k)) calc(${(circ / 12).toFixed(2)}px - 1.4px / var(--k))`,
                    }}
                  />
                </g>
                {/* 빛 토막: 고리를 천천히 한 바퀴 돈다(주기는 orbit-lines.css). 움직임 줄이기에서는 start 각도에 머문다. */}
                <g
                  className={`wb5-light wb5-lr-${i}`}
                  transform={`rotate(${start} ${CENTER} ${CENTER})`}
                >
                  <path
                    d={light}
                    fill="none"
                    style={{ stroke: `url(#wb5-lg-${i})`, strokeWidth: sw(7) }}
                  />
                  <path
                    d={light}
                    fill="none"
                    style={{ stroke: `url(#wb5-lc-${i})`, strokeWidth: sw(1.6) }}
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
            const [ca, cb] = GROUP_TINT[gr.id] ?? DEFAULT_TINT;
            const tr = TRAVEL[gr.id] ?? { sec: 90, lag: 0 };
            const segs = groupArt(gr.id, span.from, span.to);
            const delay = `${420 + gi * 140}ms`;
            return (
              <g
                key={gr.id}
                style={{
                  opacity: on ? 1 : dim || faded ? 0.25 : 0.7,
                  transition: "opacity .25s",
                }}
              >
                {allOff ? (
                  // 그룹이 꺼져 있으면 빛 없이 점선 한 줄
                  <path
                    d={d}
                    fill="none"
                    strokeLinecap="round"
                    style={{
                      stroke: mixOf(ca, cb, 0.5),
                      strokeOpacity: 0.7,
                      strokeWidth: sw(on ? 3 : 2.4),
                      strokeDasharray: `calc(2px / var(--k)) calc(10px / var(--k))`,
                    }}
                  />
                ) : (
                  <>
                    {/* 호 몸: 바깥 번짐 조각(넓고 옅다)과 본선 조각. 고리보다 굵고 밝다. */}
                    <g className="wb5-fade" style={{ animationDelay: delay }}>
                      {segs.map((s, j) => (
                        <path
                          key={`w${j}`}
                          d={s.d}
                          fill="none"
                          style={{
                            stroke: s.hue,
                            strokeOpacity: s.a * 0.14,
                            strokeWidth: sw(11),
                          }}
                        />
                      ))}
                      {segs.map((s, j) => (
                        <path
                          key={`c${j}`}
                          d={s.d}
                          fill="none"
                          data-a={s.a.toFixed(3)}
                          style={{
                            stroke: s.hue,
                            strokeOpacity: lineAlpha(s.a),
                            strokeWidth: swl(on ? 5.2 : 3.6),
                          }}
                        />
                      ))}
                    </g>
                    {/* 빛: 호 위를 점선 한 칸이 지난다(주기는 TRAVEL, 고리 빛보다 느리다). 두 겹이라 가장자리가 번진다. */}
                    <path
                      d={d}
                      pathLength={1}
                      className="wb5-travel wb5-travel-glow"
                      style={{
                        stroke: mixOf(ca, cb, 0.5),
                        strokeWidth: sw(9),
                        strokeOpacity: 0.32,
                        animationDuration: `${tr.sec}s`,
                        animationDelay: `-${tr.lag}s`,
                      }}
                    />
                    <path
                      d={d}
                      pathLength={1}
                      className="wb5-travel wb5-travel-core"
                      style={{
                        stroke: "var(--wb5-light)",
                        strokeWidth: sw(2.2),
                        animationDuration: `${tr.sec}s`,
                        animationDelay: `-${tr.lag}s`,
                      }}
                    />
                  </>
                )}
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
                <button
                  type="button"
                  className="wb5-label wb5-label-sm"
                  data-picked={open ? "" : undefined}
                  data-box={`ring-${layer}`}
                  aria-label={`${ringName(layer)} 층 보기`}
                  onClick={() => m.openRing(layer)}
                  onPointerEnter={() => setHover(layer)}
                  onPointerLeave={() => setHover((h) => (h === layer ? null : h))}
                  onPointerMove={spot}
                >
                  {ringName(layer)}
                </button>
              </div>
            </Pin>
          );
        })}

        <Pin x={CENTER} y={CENTER}>
          <div
            className="pointer-events-none relative -translate-x-1/2 -translate-y-1/2"
            style={{ width: CORE_SIZE, height: CORE_SIZE }}
          >
            <CoreOrb size={CORE} selected={coreSel} onSelect={() => m.select({ k: "agent" })} />
            <div
              className="pointer-events-auto absolute left-1/2 -translate-x-1/2"
              style={{ top: CORE_LABEL_TOP }}
            >
              <button
                type="button"
                className="wb5-label wb5-label-sm"
                data-picked={coreSel ? "" : undefined}
                onClick={() => m.select({ k: "agent" })}
                onPointerMove={spot}
                tabIndex={-1}
                aria-hidden
              >
                {T.baseAgent}
                <span className="font-mono text-[10px] opacity-60">core.loop</span>
              </button>
            </div>
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
                <button
                  type="button"
                  className="wb5-label wb5-label-group"
                  data-group=""
                  data-picked={pickedG ? "" : undefined}
                  data-lit={inGroup ? "" : undefined}
                  data-box={`group-${gr.name}`}
                  aria-pressed={pickedG}
                  aria-label={`${gr.name} ${T.group}`}
                  onClick={() => m.select({ k: "group", id: gr.id })}
                  onPointerMove={spot}
                >
                  {gr.name}
                </button>
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
          <FloatingBar label="확대와 이동" size="sm" className="pointer-events-auto">
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
  const [hot, setHot] = useState(false);
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
  const gname = p.group === undefined ? undefined : groupById(p.group)?.name;
  const tip = `${p.layer === "plugin" ? LAYER_NAME[p.layer] : `${p.layer} ${LAYER_NAME[p.layer]}`}${gname === undefined ? "" : ` · ${gname} ${T.group}`} · ${p.role}`;
  const dx = (CENTER - x) * 0.34;
  const dy = (CENTER - y) * 0.34;
  return (
    <Pin x={x} y={y} style={{ opacity: dim ? 0.32 : shadow ? 0.6 : 1, transition: "opacity .25s" }}>
      <div
        className="wb5-settle"
        ref={setVars({
          "--dx": `calc(var(--k) * ${dx.toFixed(1)}px)`,
          "--dy": `calc(var(--k) * ${dy.toFixed(1)}px)`,
        })}
        style={{ animationDelay: `${160 + index * 34}ms` }}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => setHot(false)}
      >
        <button
          type="button"
          data-dot={p.id}
          aria-label={`${p.name} 점`}
          tabIndex={-1}
          onClick={pick}
          className="wb5-dot pointer-events-auto absolute grid size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0"
          data-hot={hot ? "" : undefined}
        >
          <Mark
            shape={SHAPE_OF[p.layer]}
            size={28}
            on={on}
            group={isGroup}
            failing={failing}
            autoOff={h?.autoOff === true}
            picked={strong}
            hot={hot}
            shadowed={shadow}
          />
        </button>
        <div
          className="pointer-events-auto absolute top-0 -translate-y-1/2"
          style={{ ...(right ? { left: 19 } : { right: 19 }), viewTransitionName: vtName(p.id) }}
        >
          <Tooltip content={tip} side={right ? "right" : "left"} delayDuration={500}>
            <button
              type="button"
              className={`wb5-label ${shadow ? "line-through" : ""}`}
              data-box={`node-${p.id}`}
              data-group={isGroup ? "" : undefined}
              data-picked={strong ? "" : undefined}
              data-lit={lit && !strong ? "" : undefined}
              data-off={!on && !failing ? "" : undefined}
              data-fail={failing ? "" : undefined}
              aria-pressed={picked}
              onClick={pick}
              onKeyDown={onKey}
              onPointerMove={spot}
            >
              {p.name}
              {lead && <span className="wb5-label-tag">{T.lead}</span>}
            </button>
          </Tooltip>
        </div>
      </div>
    </Pin>
  );
}
