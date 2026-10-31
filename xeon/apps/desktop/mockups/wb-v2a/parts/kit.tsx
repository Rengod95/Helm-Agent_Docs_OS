// 지도·구성기 공용 부품: 맞춤 보기, 직교 엣지 경로, 층 색 아이콘 면, fold 모양, 상태 면, 맥락 테두리(hull).
// caustic 빈틈 [gap:C-35 제안]: 세계 좌표 맞춤 보기(fit + 단계 줌), 직교·묶음 엣지, 겹친 사각형 합집합 테두리(hull)가 없다.
// NodeGraph(efc4b3e)는 포트를 재서 곡선을 그리지만 직교 경로·묶음 차선·덧그림(흐름 점)·hull을 주지 않아 여기서 그렸다.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Fold, Hue } from "../data";

/** 세계(w×h)를 부모 폭·높이에 맞춰 줄이거나 키운다. 가운데 정렬. */
export function Viewport({
  w,
  h,
  max = 1.15,
  min = 0.55,
  children,
  label,
  pad = 8,
}: {
  w: number;
  h: number;
  max?: number;
  min?: number;
  children: ReactNode;
  label: string;
  pad?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.85);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setK(Math.max(min, Math.min(max, (r.width - pad * 2) / w, (r.height - pad * 2) / h)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, max, min, pad]);
  return (
    <div
      ref={ref}
      role="application"
      aria-roledescription="캔버스"
      aria-label={label}
      className="relative min-h-0 flex-1 overflow-auto"
    >
      <div className="grid min-h-full place-items-center" style={{ minWidth: w * k + pad * 2 }}>
        <div style={{ width: w * k, height: h * k }} className="relative">
          <div
            className="absolute top-0 left-0 origin-top-left transition-transform duration-300 ease-out"
            style={{ width: w, height: h, transform: `scale(${k})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 직교 경로(둥근 모서리). 세로 먼저: a에서 내려가 midY에서 꺾어 b로. */
export function orthV(a: [number, number], b: [number, number], midY: number, r = 8) {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (Math.abs(ax - bx) < 1) return `M${ax} ${ay} L${bx} ${by}`;
  const dx = Math.sign(bx - ax);
  const dy1 = Math.sign(midY - ay) || 1;
  const dy2 = Math.sign(by - midY) || 1;
  const rr = Math.min(r, Math.abs(bx - ax) / 2, Math.abs(midY - ay), Math.abs(by - midY));
  return [
    `M${ax} ${ay}`,
    `L${ax} ${midY - dy1 * rr}`,
    `Q${ax} ${midY} ${ax + dx * rr} ${midY}`,
    `L${bx - dx * rr} ${midY}`,
    `Q${bx} ${midY} ${bx} ${midY + dy2 * rr}`,
    `L${bx} ${by}`,
  ].join(" ");
}

/** 직교 경로. 가로 먼저: a에서 midX까지 가서 꺾어 b로. */
export function orthH(a: [number, number], b: [number, number], midX: number, r = 8) {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (Math.abs(ay - by) < 1) return `M${ax} ${ay} L${bx} ${by}`;
  const dy = Math.sign(by - ay);
  const dx1 = Math.sign(midX - ax) || 1;
  const dx2 = Math.sign(bx - midX) || 1;
  const rr = Math.min(r, Math.abs(by - ay) / 2, Math.abs(midX - ax), Math.abs(bx - midX));
  return [
    `M${ax} ${ay}`,
    `L${midX - dx1 * rr} ${ay}`,
    `Q${midX} ${ay} ${midX} ${ay + dy * rr}`,
    `L${midX} ${by - dy * rr}`,
    `Q${midX} ${by} ${midX + dx2 * rr} ${by}`,
    `L${bx} ${by}`,
  ].join(" ");
}

export const hueVar = (h: Hue, kind: "ink" | "tint" | "plate" | "hue") => `var(--${kind}-${h})`;

/** 층 색 아이콘 면: 블록의 첫 눈길. 면은 층 tint, 아이콘은 층 ink. */
export function HueTile({
  hue,
  size = 28,
  children,
  className = "",
}: {
  hue: Hue;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center rounded-lg [&_svg]:size-4 ${className}`}
      style={{
        width: size,
        height: size,
        background: hueVar(hue, "tint"),
        color: hueVar(hue, "ink"),
      }}
    >
      {children}
    </span>
  );
}

/** fold 모양: collect 고리, first 마름모(관문), chain 네모, tap 점. 소켓 안과 표 머리에서 같은 모양. */
export function FoldGlyph({
  fold,
  size = 10,
  color = "currentColor",
}: {
  fold: Fold;
  size?: number;
  color?: string;
}) {
  const s = size;
  const c = s / 2;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden className="flex-none">
      {fold === "collect" && (
        <circle cx={c} cy={c} r={c - 1.2} fill="none" stroke={color} strokeWidth={1.6} />
      )}
      {fold === "first" && (
        <path d={`M${c} 0.8 L${s - 0.8} ${c} L${c} ${s - 0.8} L0.8 ${c}Z`} fill={color} />
      )}
      {fold === "chain" && (
        <rect x={1.2} y={1.2} width={s - 2.4} height={s - 2.4} rx={1} fill={color} />
      )}
      {fold === "tap" && <circle cx={c} cy={c} r={c * 0.55} fill={color} />}
    </svg>
  );
}

export const FOLD_LABEL: Record<Fold, string> = {
  collect: "모두 모음",
  first: "첫 답이 정함",
  chain: "차례로 고침",
  tap: "보기만",
};

type Tone = "danger" | "warning" | "neutral" | "success" | "accent" | "agent";
const face: Record<Tone, string> = {
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  neutral: "bg-neutral-track text-text-secondary",
  success: "bg-success-soft text-success-text",
  accent: "bg-accent-soft text-accent-text",
  agent: "bg-agent-soft text-agent-text",
};
/** 상태 면(DP-29): 아이콘 + 짧은 글. 높이 고정·사방 같은 여백(DP-16). */
export function Mark({
  tone,
  icon,
  children,
  className = "",
}: {
  tone: Tone;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-5 flex-none items-center gap-1 rounded-md px-1.5 text-ui-xs leading-none whitespace-nowrap tabular-nums [&_svg]:size-3 ${face[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** 엣지 위 이름표(연한 알약). */
export function WireLabel({
  x,
  y,
  children,
  tone = "neutral",
  style,
}: {
  x: number;
  y: number;
  children: ReactNode;
  tone?: "neutral" | "danger" | "warning" | "accent";
  style?: CSSProperties;
}) {
  const t =
    tone === "danger"
      ? "bg-danger-soft text-danger-text"
      : tone === "warning"
        ? "bg-warning-soft text-warning-text"
        : tone === "accent"
          ? "bg-accent-soft text-accent-text"
          : "bg-surface-raised text-text-secondary shadow-1";
  return (
    <span
      className={`pointer-events-none absolute z-10 inline-flex h-5 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 text-ui-xs whitespace-nowrap tabular-nums ${t}`}
      style={{ left: x, top: y, ...style }}
    >
      {children}
    </span>
  );
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
function rr(r: Rect, rad: number) {
  const { x, y, w, h } = r;
  const q = Math.min(rad, w / 2, h / 2);
  return `M${x + q} ${y}H${x + w - q}Q${x + w} ${y} ${x + w} ${y + q}V${y + h - q}Q${x + w} ${y + h} ${x + w - q} ${y + h}H${x + q}Q${x} ${y + h} ${x} ${y + h - q}V${y + q}Q${x} ${y} ${x + q} ${y}Z`;
}

/**
 * 맥락 테두리(hull): 겹친 둥근 사각형들의 합집합 하나. 면은 한 path(nonzero, 한 번만 칠함), 테두리는 마스크 고리
 * (합집합을 1.5px 키운 흰 모양 − 합집합 검은 모양)라 안쪽 겹친 선이 생기지 않는다.
 */
export function Hull({
  id,
  rects,
  color,
  radius = 18,
  w,
  h,
}: {
  id: string;
  rects: Rect[];
  color: string;
  radius?: number;
  w: number;
  h: number;
}) {
  const inner = rects.map((r) => rr(r, radius)).join(" ");
  const outer = rects
    .map((r) => rr({ x: r.x - 1.75, y: r.y - 1.75, w: r.w + 3.5, h: r.h + 3.5 }, radius + 1.75))
    .join(" ");
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0" width={w} height={h}>
      <defs>
        <mask id={`${id}-ring`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
          <path d={outer} fill="white" />
          <path d={inner} fill="black" />
        </mask>
      </defs>
      <path d={inner} fill={color} fillOpacity={0.045} />
      <rect x={0} y={0} width={w} height={h} fill={color} mask={`url(#${id}-ring)`} />
    </svg>
  );
}

/** 사용량 막대(임대 턴·spawn·토큰). */
export function Meter({
  label,
  used,
  max,
  unit = "",
}: {
  label: string;
  used: number;
  max: number;
  unit?: string;
}) {
  const p = Math.min(100, (used / max) * 100);
  return (
    <span className="inline-flex items-center gap-1.5 text-ui-xs text-text-secondary tabular-nums">
      <span className="text-text-tertiary">{label}</span>
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-neutral-track">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-accent-solid"
          style={{ width: `${p}%` }}
        />
      </span>
      {used}
      {unit}/{max}
      {unit}
    </span>
  );
}
