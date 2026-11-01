// 행 포트 노드(그룹 하위 캔버스의 부품, 그룹 입출력, 흐름의 단계). Blender 노드처럼 머리 → 출력 행 → 입력 행 → 몸.
// 좌표는 결정적이다: 머리 32px, 행 20px. rowY로 선 끝을 계산한다.
import type { CSSProperties, ReactNode } from "react";
import type { Fold, Health, PortType } from "../data";
import { cardStyle, Face, FoldGlyph, PortGlyph, PORT_VAR, type PillState } from "./kit";

export const HEAD_H = 32;
export const ROW_H = 20;

export interface Row {
  id: string;
  side: "in" | "out";
  type: PortType | "record";
  label: string;
  meta?: string;
  fold?: Fold;
  hollow?: boolean;
  state?: PillState;
}

export interface NodeSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  title: string;
  tag?: string;
  icon?: ReactNode;
  health?: Health;
  faceTone?: "agent" | "neutral";
  rows: Row[];
  body?: ReactNode;
  bodyH?: number;
  /** 머리 오른쪽 작은 배지(임대 예산 등). */
  badge?: ReactNode;
}

export const nodeH = (n: NodeSpec) =>
  HEAD_H + n.rows.length * ROW_H + (n.body !== undefined ? (n.bodyH ?? 24) : 4) + 6;

export function rowAnchor(n: NodeSpec, rowId: string) {
  const i = n.rows.findIndex((r) => r.id === rowId);
  const r = n.rows[i]!;
  const y = n.y + HEAD_H + i * ROW_H + ROW_H / 2;
  return { x: r.side === "out" ? n.x + n.w : n.x, y };
}

export function Node({
  n,
  selected,
  dim,
  state = "idle",
  ghost = false,
  onClick,
  style,
}: {
  n: NodeSpec;
  selected?: boolean;
  dim?: boolean;
  state?: "idle" | "active" | "done" | "failed" | "invalid" | "target";
  ghost?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const h = nodeH(n);
  const ring =
    state === "active"
      ? { boxShadow: "0 0 0 2px var(--port-on), var(--block-shadow)" }
      : state === "failed" || state === "invalid"
        ? {
            background: "var(--cs-color-danger-tint)",
            boxShadow: "inset 0 0 0 1px var(--cs-color-danger-border), var(--block-shadow)",
          }
        : state === "target"
          ? {
              boxShadow:
                "0 0 0 1.5px var(--port-drive), 0 0 0 6px color-mix(in oklab, var(--port-drive) 12%, transparent), var(--block-shadow)",
            }
          : {};
  return (
    <div
      data-block
      role="button"
      tabIndex={0}
      aria-label={`${n.title}${n.tag ? ` · ${n.tag}` : ""}`}
      onClick={onClick}
      className="absolute rounded-[10px] outline-none transition-opacity duration-200 focus-visible:shadow-focus"
      style={{
        left: n.x,
        top: n.y,
        width: n.w,
        height: h,
        opacity: dim ? 0.4 : 1,
        ...cardStyle({ selected, ghost }),
        ...ring,
        ...style,
      }}
    >
      <div className="flex h-8 items-center gap-2 px-2.5">
        {n.icon !== undefined && (
          <Face health={n.health ?? "ok"} size={20}>
            {n.icon}
          </Face>
        )}
        <span
          className={`min-w-0 truncate text-[13px] font-semibold ${state === "done" ? "text-text-secondary" : "text-text-primary"}`}
        >
          {n.title}
        </span>
        {n.tag !== undefined && (
          <span className="flex-none font-mono text-[10px] text-text-tertiary">{n.tag}</span>
        )}
        {n.badge !== undefined && <span className="ms-auto flex-none">{n.badge}</span>}
      </div>
      {n.rows.map((r, i) => (
        <div
          key={r.id}
          className={`absolute flex items-center gap-1.5 text-[11.5px] ${r.side === "out" ? "right-0 flex-row-reverse pe-2.5" : "left-0 ps-2.5"}`}
          style={{ top: HEAD_H + i * ROW_H, height: ROW_H, width: n.w }}
        >
          <span
            className={`absolute top-1/2 -translate-y-1/2 rounded-[3px] bg-surface-base p-[1.5px] ${r.side === "out" ? "-right-[6px]" : "-left-[6px]"} ${r.state === "target" ? "v2b-pulse" : ""}`}
            style={{
              ["--ring" as string]: PORT_VAR[r.type],
              boxShadow:
                r.state === "target"
                  ? `0 0 0 1.5px ${PORT_VAR[r.type]}, 0 0 0 4px color-mix(in oklab, ${PORT_VAR[r.type]} 20%, transparent)`
                  : r.state === "invalid"
                    ? "0 0 0 1.5px var(--cs-color-danger-solid)"
                    : undefined,
            }}
          >
            <PortGlyph type={r.type} hollow={r.hollow ?? r.state === "off"} size={8} />
          </span>
          {r.fold !== undefined && <FoldGlyph fold={r.fold} />}
          <span
            className={`min-w-0 truncate ${r.state === "off" ? "text-text-tertiary" : r.state === "invalid" ? "text-danger-text" : r.state === "target" || r.state === "lit" ? "text-text-primary" : "text-text-secondary"}`}
          >
            {r.label}
          </span>
          {r.meta !== undefined && (
            <span className="flex-none truncate font-mono text-[10px] text-text-tertiary">
              {r.meta}
            </span>
          )}
        </div>
      ))}
      {n.body !== undefined && (
        <div
          className="absolute inset-x-0 bottom-0 flex items-center px-2.5 pb-1.5 text-[11px] text-text-tertiary"
          style={{ height: n.bodyH ?? 24 }}
        >
          {n.body}
        </div>
      )}
    </div>
  );
}

/** 임대 예산 배지: 단계가 쓰는 턴·spawn. */
export function Budget({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <span
      className={`inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full px-1.5 font-mono text-[10px] tabular-nums ${tone === "warn" ? "bg-warning-soft text-warning-text" : "bg-neutral-track text-text-secondary"}`}
    >
      <PortGlyph type="drive" size={6} />
      {children}
    </span>
  );
}
