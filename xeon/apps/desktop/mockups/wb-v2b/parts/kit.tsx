// 노드 편집기 기본 부품: 포트 글리프·알약, 선(경로·묶음·경유점), 블록 해부, 스파크라인, fold 글리프.
// caustic NodeGraph(efc4b3e)는 DOM 측정 선과 좌우 포트 줄을 주지만, 이 시안은 (1) 포트 타입 색과 모양, (2) 가장자리에 걸친
// 알약 포트, (3) 묶음 선과 경유점(reroute), (4) 결정적 좌표(스크린숏 재현)가 필요해 토큰으로 직접 그렸다. [gap: C-35·C-36 보탬]
import type { CSSProperties, ReactNode } from "react";
import {
  FolderTree,
  CircleCheck,
  Globe,
  KeyRound,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Search,
  ShieldCheck,
  Compass,
  FileText,
  Sparkles,
  Lock,
} from "../../_shell";
import type { Ext, Fold, Health, PortType } from "../data";

export const PORT_VAR: Record<PortType | "record", string> = {
  cap: "var(--port-cap)",
  on: "var(--port-on)",
  post: "var(--port-post)",
  drive: "var(--port-drive)",
  record: "var(--port-record)",
};

/** 포트 타입 모양: 능력 원(속 빈 원 = optional), on 둥근 네모(소켓), post 삼각(보냄), drive 마름모(구동). 색과 모양이 겹쳐 뜻을 준다. */
export function PortGlyph({
  type,
  hollow = false,
  size = 8,
}: {
  type: PortType | "record";
  hollow?: boolean;
  size?: number;
}) {
  const c = PORT_VAR[type];
  const fill = hollow ? "none" : c;
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 10 10"
      aria-hidden
      className="flex-none overflow-visible"
    >
      {type === "cap" && <circle cx="5" cy="5" r="4" fill={fill} stroke={c} strokeWidth="1.6" />}
      {type === "on" && (
        <rect x="1" y="1" width="8" height="8" rx="2.2" fill={fill} stroke={c} strokeWidth="1.6" />
      )}
      {type === "post" && (
        <path
          d="M2 1.2 L9 5 L2 8.8 Z"
          fill={fill}
          stroke={c}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}
      {type === "drive" && (
        <path
          d="M5 0.6 L9.4 5 L5 9.4 L0.6 5 Z"
          fill={fill}
          stroke={c}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      )}
      {type === "record" && (
        <rect
          x="1.5"
          y="2.5"
          width="7"
          height="5"
          rx="1"
          fill="none"
          stroke={c}
          strokeWidth="1.4"
        />
      )}
    </svg>
  );
}

export type PillState = "idle" | "lit" | "target" | "invalid" | "muted" | "off";

/** 가장자리에 걸친 포트 알약. side l = 블록 왼쪽(입력), r = 오른쪽(출력). */
export function Pill({
  side,
  dy,
  type,
  label,
  state = "idle",
  hollow,
  stub = false,
}: {
  side: "l" | "r";
  dy: number;
  type: PortType | "record";
  label: string;
  state?: PillState;
  hollow?: boolean;
  stub?: boolean;
}) {
  const c = PORT_VAR[type];
  const style: CSSProperties = {
    top: dy,
    [side === "l" ? "left" : "right"]: -27,
    width: 54,
    ["--ring" as string]: c,
    boxShadow:
      state === "target"
        ? `0 0 0 1.5px ${c}, 0 0 0 5px color-mix(in oklab, ${c} 22%, transparent)`
        : state === "lit"
          ? `0 0 0 1.25px ${c}`
          : state === "invalid"
            ? "0 0 0 1.5px var(--cs-color-danger-solid)"
            : "0 0 0 1px var(--block-edge)",
  };
  return (
    <span
      aria-hidden
      className={[
        "absolute z-[2] flex h-4 -translate-y-1/2 items-center gap-1 rounded-full bg-surface-base px-1.5",
        side === "r" ? "flex-row-reverse" : "",
        state === "muted" || state === "off" ? "opacity-45" : "",
        state === "target" ? "v2b-pulse" : "",
      ].join(" ")}
      style={style}
    >
      <PortGlyph type={type} hollow={hollow ?? state === "off"} size={7} />
      <span
        className={[
          "min-w-0 flex-1 truncate font-mono text-[9.5px] leading-none",
          side === "r" ? "text-end" : "",
          state === "lit" || state === "target" ? "text-text-primary" : "text-text-tertiary",
        ].join(" ")}
      >
        {label}
      </span>
      {stub && (
        <span
          className="absolute top-1/2 h-px w-2"
          style={{ [side === "l" ? "right" : "left"]: "100%", background: c, opacity: 0.55 }}
        />
      )}
    </span>
  );
}

// ── 선
export interface Pt {
  x: number;
  y: number;
}
/** 왼쪽 → 오른쪽 부드러운 선(수평 접선). */
export function hPath(a: Pt, b: Pt) {
  const dx = Math.max(28, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export type WireLook =
  | "base"
  | "lit"
  | "hover"
  | "dim"
  | "draft"
  | "invalid"
  | "ghost"
  | "fail"
  | "live";

export function Wire({
  d,
  type,
  look = "base",
  dashed = false,
  width,
  id,
}: {
  d: string;
  type: PortType | "record";
  look?: WireLook;
  dashed?: boolean;
  width?: number;
  id?: string;
}) {
  const c = look === "invalid" || look === "fail" ? "var(--cs-color-danger-solid)" : PORT_VAR[type];
  const w = width ?? (type === "drive" ? 2.25 : look === "lit" || look === "live" ? 1.75 : 1.5);
  const op = look === "dim" ? 0.14 : look === "hover" ? 0.7 : look === "ghost" ? 0.75 : 1;
  const dash =
    look === "draft" || look === "ghost"
      ? "5 4"
      : look === "invalid"
        ? "3 3"
        : dashed
          ? "1.5 4"
          : undefined;
  return (
    <g>
      {/* 바탕색 받침: 선이 겹칠 때 앞선이 뒤선을 끊어 보이게(엣지 할로) */}
      {look !== "dim" && (
        <path
          d={d}
          fill="none"
          stroke="var(--cs-color-bg-app)"
          strokeWidth={w + 3}
          strokeLinecap="round"
          opacity={0.85}
        />
      )}
      <path
        id={id}
        d={d}
        fill="none"
        stroke={c}
        strokeWidth={w}
        strokeLinecap="round"
        strokeDasharray={dash}
        opacity={op}
        className={look === "live" ? "v2b-flow" : undefined}
      />
    </g>
  );
}

/** 묶음이 갈라지는 경유점(reroute). n이 있으면 묶인 선 수. */
export function Reroute({ x, y, type, n }: { x: number; y: number; type: PortType; n?: number }) {
  const c = PORT_VAR[type];
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={n !== undefined ? 7 : 3.5}
        fill="var(--cs-color-surface-base)"
        stroke={c}
        strokeWidth={1.5}
      />
      {n !== undefined && (
        <text
          x={x}
          y={y + 3}
          textAnchor="middle"
          className="fill-text-primary font-mono"
          style={{ fontSize: 8.5, fontWeight: 600 }}
        >
          {n}
        </text>
      )}
    </g>
  );
}

// ── 블록 아이콘
export function ExtIcon({
  name,
}: {
  name: Ext["icon"] | "shield" | "compass" | "file" | "spark" | "lock";
}) {
  switch (name) {
    case "core":
      return <Layers />;
    case "globe":
      return <Globe />;
    case "search":
      return <Search />;
    case "book":
      return <FolderTree />;
    case "check":
      return <ListChecks />;
    case "chat":
      return <MessageSquare />;
    case "helm":
      return <Compass />;
    case "plan":
      return <CircleCheck />;
    case "learn":
      return <Lightbulb />;
    case "review":
      return <ShieldCheck />;
    case "note":
      return <FileText />;
    case "key":
      return <KeyRound />;
    case "shield":
      return <ShieldCheck />;
    case "compass":
      return <Compass />;
    case "file":
      return <FileText />;
    case "spark":
      return <Sparkles />;
    case "lock":
      return <Lock />;
  }
}

const FACE: Record<Health, string> = {
  ok: "bg-neutral-track text-text-secondary",
  warn: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  off: "bg-transparent text-text-tertiary shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]",
};

/** 아이콘 면(DP-29): 상태 tone은 이 작은 면에만. */
export function Face({
  health,
  children,
  size = 22,
}: {
  health: Health;
  children: ReactNode;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className={`inline-grid flex-none place-items-center rounded-md [&_svg]:size-3.5 ${FACE[health]}`}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

export function Spark({
  data,
  w = 44,
  h = 14,
  tone = "var(--cs-color-text-tertiary)",
  fill = false,
}: {
  data: number[];
  w?: number;
  h?: number;
  tone?: string;
  fill?: boolean;
}) {
  const max = Math.max(1, ...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - 1 - (v / max) * (h - 2)] as const);
  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} aria-hidden className="flex-none overflow-visible">
      {fill && <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={tone} opacity={0.12} />}
      <path
        d={d}
        fill="none"
        stroke={tone}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={1.75} fill={tone} />
    </svg>
  );
}

/** fold 모양: collect 고리, first 관문(마름모 반), chain 사슬 네모, tap 점. */
export function FoldGlyph({ fold }: { fold: Fold }) {
  const c = "var(--cs-color-text-tertiary)";
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="flex-none">
      {fold === "collect" && (
        <circle cx="5" cy="5" r="3.4" fill="none" stroke={c} strokeWidth="1.4" />
      )}
      {fold === "first" && (
        <path d="M5 1.2 L8.8 5 L5 8.8 L1.2 5 Z" fill="none" stroke={c} strokeWidth="1.4" />
      )}
      {fold === "chain" && (
        <>
          <rect
            x="0.8"
            y="3"
            width="4.4"
            height="4"
            rx="1"
            fill="none"
            stroke={c}
            strokeWidth="1.2"
          />
          <rect
            x="4.8"
            y="3"
            width="4.4"
            height="4"
            rx="1"
            fill="none"
            stroke={c}
            strokeWidth="1.2"
          />
        </>
      )}
      {fold === "tap" && <circle cx="5" cy="5" r="1.8" fill={c} />}
    </svg>
  );
}

/** 블록 카드 면. 표면과 그림자로 들어 올리고 테두리는 아주 옅은 안쪽 선 하나. */
export function cardStyle(opts: {
  selected?: boolean;
  tone?: string;
  ghost?: boolean;
  off?: boolean;
}): CSSProperties {
  if (opts.ghost)
    return {
      background: "color-mix(in oklab, var(--cs-color-surface-base) 55%, transparent)",
      boxShadow: `inset 0 0 0 1.5px ${opts.tone ?? "var(--cs-color-border-strong)"}`,
      outline: "none",
    };
  if (opts.off)
    return {
      background: "transparent",
      boxShadow: "inset 0 0 0 1px var(--cs-color-border-default)",
    };
  return {
    background: "var(--cs-color-surface-base)",
    boxShadow: opts.selected
      ? `0 0 0 1.5px ${opts.tone ?? "var(--cs-color-text-primary)"}, var(--block-shadow)`
      : `inset 0 0 0 1px var(--block-edge), var(--block-shadow)`,
  };
}
