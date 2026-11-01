// 캔버스 v3 기본 부품: 아이콘 표, 층 표지, 플러그인 타일, "내 것" 표지, 더하기 자리, 세계 맞춤(Fit), 곡선, fold 글리프.
// [gap: C-35 보탬] caustic NodeGraph(efc4b3e)는 측정 선과 좌우 포트만 있어, 층 띠 안 자동 배치·렌즈 줄 → 타일 선·세계 맞춤을
// 토큰으로 직접 그렸다. 재사용이 확실해지면 packages/react의 CanvasViewport·GraphFrame으로 옮길 것을 제안한다(SPEC §9).
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bell,
  Frame,
  CircleX,
  Compass,
  Eye,
  FileText,
  GitBranch,
  Globe,
  History,
  KeyRound,
  Laptop,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Monitor,
  Play,
  Plus,
  Rows3,
  Scan,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Spline,
  Terminal,
  TriangleAlert,
  User,
  Package,
  Settings,
  SquareStack,
  Clock,
  Target,
  Diamond,
  Braces,
} from "../../_shell";
import type { Health, LayerId, Plugin } from "../data";

export const ICON: Record<string, ReactNode> = {
  compass: <Compass />,
  list: <ListChecks />,
  sparkles: <Sparkles />,
  eye: <Eye />,
  scan: <Scan />,
  globe: <Globe />,
  search: <Search />,
  bulb: <Lightbulb />,
  checks: <ListChecks />,
  chat: <MessageSquare />,
  file: <FileText />,
  rows: <Rows3 />,
  play: <Play />,
  spark: <Sparkles />,
  shield: <Shield />,
  shieldcheck: <ShieldCheck />,
  layers: <Layers />,
  history: <History />,
  branch: <GitBranch />,
  route: <Spline />,
  terminal: <Terminal />,
  box: <Frame />,
  key: <KeyRound />,
  cpu: <SquareStack />,
  db: <Package />,
  laptop: <Laptop />,
  monitor: <Monitor />,
  bell: <Bell />,
  settings: <Settings />,
  clock: <Clock />,
  target: <Target />,
  diamond: <Diamond />,
  braces: <Braces />,
};

/** 역할(블록 종류) 아이콘 */
export const ROLE_ICON: Record<string, ReactNode> = {
  drive: <Play />,
  knowledge: <Lightbulb />,
  record: <FileText />,
  restore: <History />,
  signal: <Target />,
  lens: <Scan />,
  guard: <Shield />,
  provider: <Package />,
  rules: <Settings />,
  choose: <Spline />,
  measure: <Rows3 />,
  patch: <Braces />,
};

export const ink = (l: LayerId) => `var(--ink-${l})`;
export const tint = (l: LayerId) => `var(--tint-${l})`;
export const plate = (l: LayerId) => `var(--plate-${l})`;
export const hue = (l: LayerId) => `var(--h-${l})`;

/** 층 mono 표지(DP-31) */
export function LayerCode({ l, className = "" }: { l: LayerId; className?: string }) {
  return (
    <span className={`font-mono text-mono-sm ${className}`} style={{ color: ink(l) }}>
      {l}
    </span>
  );
}

/** 아이콘 면: 층 tint + ink 아이콘. 상태 tone은 오른쪽 위 점(DP-29). */
export function Face({
  l,
  icon,
  size = 24,
  className = "",
}: {
  l: LayerId;
  icon: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center rounded-md [&_svg]:size-[60%] ${className}`}
      style={{ width: size, height: size, background: tint(l), color: ink(l) }}
    >
      {icon}
    </span>
  );
}

/** "내 것" 표지: 사람 글리프 + 글자. 내장은 표지가 없다(기본값은 말하지 않음). */
export function Mine({ origin, compact }: { origin: "user" | "project"; compact?: boolean }) {
  return (
    <span
      className="inline-flex h-4 flex-none items-center gap-0.5 rounded-full bg-surface-base px-1.5 text-ui-xs leading-none text-text-secondary [&_svg]:size-2.5"
      style={{ boxShadow: "inset 0 0 0 1px var(--edge-strong)" }}
    >
      <User />
      {!compact && (origin === "user" ? "내 것" : "프로젝트")}
    </span>
  );
}

export function HealthDot({ h }: { h: Health }) {
  if (h === "auto_off")
    return (
      <span
        className="grid size-4 place-items-center rounded-full bg-danger-soft text-danger-text [&_svg]:size-3"
        title="자동 꺼짐"
      >
        <CircleX />
      </span>
    );
  if (h === "failing")
    return (
      <span
        className="grid size-4 place-items-center rounded-full bg-warning-soft text-warning-text [&_svg]:size-3"
        title="실패 있음"
      >
        <TriangleAlert />
      </span>
    );
  return null;
}

export type TileLook = "normal" | "dim" | "focus" | "related" | "off" | "ghost";

/** 플러그인 타일: 면 + 그림자로 들어 올림. 사용자 것은 층 색 고리 + 옅은 sheen + "내 것" 표지. */
export function Tile({
  p,
  w,
  h,
  look = "normal",
  dense,
  meta,
  mark,
  onClick,
  style,
}: {
  p: Plugin;
  w: number;
  h: number;
  look?: TileLook;
  dense?: boolean;
  meta?: ReactNode;
  mark?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const user = p.origin !== "builtin";
  const off = p.health === "off" || p.health === "auto_off" || look === "off";
  const ring =
    look === "focus"
      ? "0 0 0 2px var(--cs-color-accent-solid)"
      : look === "related"
        ? `0 0 0 1.5px ${ink(p.layer)}`
        : user
          ? `inset 0 0 0 1.25px color-mix(in oklab, ${hue(p.layer)} 70%, transparent)`
          : "inset 0 0 0 1px var(--edge)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${p.name} ${p.id}${user ? " · 내 것" : ""}`}
      className={`group absolute flex flex-col justify-between rounded-lg text-start outline-none transition-[opacity,box-shadow] duration-200 focus-visible:shadow-focus ${user ? "v3-sheen" : ""}`}
      style={{
        width: w,
        height: h,
        padding: dense ? "6px 7px" : "8px 9px",
        background: off && look !== "focus" ? "transparent" : "var(--cs-color-surface-raised)",
        boxShadow:
          off && look !== "focus" ? `inset 0 0 0 1px var(--edge-strong)` : `${ring}, var(--lift)`,
        borderStyle: "none",
        opacity: look === "dim" ? 0.32 : 1,
        ["--h" as string]: hue(p.layer),
        ...style,
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {!dense && <Face l={p.layer} icon={ICON[p.icon]} size={22} />}
        {dense && (
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full"
            style={{ background: ink(p.layer) }}
          />
        )}
        <span
          className={`min-w-0 flex-1 truncate ${dense ? "text-ui-xs font-medium" : "text-ui-sm"} ${off ? "text-text-secondary" : "text-text-primary"}`}
        >
          {p.name}
        </span>
        <HealthDot h={p.health} />
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {meta ?? (
          <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-tertiary">
            {p.id}
          </span>
        )}
        {user && <Mine origin={p.origin as "user" | "project"} compact />}
      </span>
      {mark}
    </button>
  );
}

/** "이 층에 더하기" 자리: 점선 윤곽(여기 없음, V-06) + 더하기 아이콘. */
export function AddSlot({
  w,
  h,
  label,
  name,
  onClick,
  pulse,
  style,
}: {
  w: number;
  h: number;
  label: string;
  /** 접근 이름(없으면 label) */
  name?: string;
  onClick?: () => void;
  pulse?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name ?? label}
      className={`absolute grid place-items-center gap-0.5 rounded-lg text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:shadow-focus [&_svg]:size-4 ${pulse ? "v3-pulse" : ""}`}
      style={{
        width: w,
        height: h,
        border: "1.25px dashed var(--edge-strong)",
        ...style,
      }}
    >
      <span className="grid justify-items-center">
        <Plus />
        <span className="text-ui-xs leading-tight">{label}</span>
      </span>
    </button>
  );
}

/** 세계 맞춤: 부모 크기에 맞춰 줄이고(최소 min, 최대 max) 가운데 둔다. 글자가 화면에서 너무 작아지면 넘치게 두고 스크롤. */
export function Fit({
  w,
  h,
  min = 0.62,
  max = 1.15,
  align = "center",
  children,
  className = "",
}: {
  w: number;
  h: number;
  min?: number;
  max?: number;
  align?: "center" | "start";
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min((r.width - 8) / w, (r.height - 8) / h, max);
      setS(Math.max(min, k));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, min, max]);
  return (
    <div ref={ref} className={`relative flex min-h-0 min-w-0 flex-1 overflow-auto ${className}`}>
      <div
        className={`relative flex-none ${align === "center" ? "m-auto" : "mx-auto mb-auto"}`}
        style={{ width: w * s, height: h * s }}
      >
        <div
          className="absolute left-0 top-0"
          style={{ width: w, height: h, transform: `scale(${s})`, transformOrigin: "0 0" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** 수평으로 들어가 수평으로 나오는 부드러운 곡선 */
export function hCurve(ax: number, ay: number, bx: number, by: number) {
  const dx = Math.max(24, Math.abs(bx - ax) * 0.5);
  return `M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}`;
}

/** fold 글리프(지점이 핸들러 결과를 모으는 방식): tap 점 · first 관문 · chain 사슬 · collect 고리 */
export function FoldGlyph({ fold, color = "currentColor" }: { fold: string; color?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="flex-none">
      {fold === "tap" && <circle cx="6" cy="6" r="2.2" fill={color} />}
      {fold === "first" && (
        <path d="M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z" fill="none" stroke={color} strokeWidth="1.5" />
      )}
      {fold === "chain" && (
        <g fill="none" stroke={color} strokeWidth="1.4">
          <rect x="1" y="4" width="5.5" height="4" rx="2" />
          <rect x="5.5" y="4" width="5.5" height="4" rx="2" />
        </g>
      )}
      {fold === "collect" && (
        <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.5" />
      )}
    </svg>
  );
}

export const FOLD_LABEL: Record<string, string> = {
  tap: "보기",
  first: "막기",
  chain: "고치기",
  collect: "모으기",
};
