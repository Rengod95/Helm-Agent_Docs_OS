// 캔버스 블록(확장 노드). 면은 늘 neutral이고 tone은 오른쪽 위 작은 아이콘 면에만 준다(DP-29, DP-46).
// 아래 가장자리에 연결 포트: 왼쪽 무리 = 받는 기능(requires 꽉 찬 점, optional 빈 점), 오른쪽 셋 = on · post · drive.
// caustic 빈틈 [gap:C-35 제안]: 노드 그래프 노드(`GraphNode`: 제목, 메타, 상태 면, 타입 포트)가 없다. TokenGraphNode는
// 좌우 포트 하나씩에 토큰 경로 전용이라 타입 포트 여럿과 세로 흐름을 그리지 못한다.
import type { ReactNode } from "react";
import { CircleX, Play, TriangleAlert } from "../../_shell";
import type { CNode, CtxNodeState } from "../data";

type Tone = "danger" | "warning" | "neutral";
const face: Record<Tone, string> = {
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  neutral: "bg-neutral-track text-text-tertiary",
};

/** DP-29 상태 면: 16px 아이콘 면 + (있으면) 수. */
export function Mark({
  tone,
  children,
  count,
}: {
  tone: Tone;
  children: ReactNode;
  count?: number;
}) {
  return (
    <span
      className={`inline-flex h-4 flex-none items-center gap-0.5 rounded-xs px-0.5 text-micro leading-none tabular-nums [&_svg]:size-3 ${face[tone]}`}
    >
      {children}
      {count !== undefined && count > 0 && <span className="pe-0.5">{count}</span>}
    </span>
  );
}

const TRUST: Record<string, string> = { builtin: "내장", user: "user", project: "project" };

export interface NodeProps {
  n: CNode;
  st: CtxNodeState;
  selected: boolean;
  /** 비교·재생 등에서 뒤로 물림. */
  dimmed?: boolean;
  /** 고르기. */
  onSelect: (id: string) => void;
  /** 노드 아래 붙는 줄(재생 지연, 비교 차이). */
  tag?: ReactNode;
  /** 맥락 표지 색(비교: 더함·뺌). */
  markTone?: "add" | "remove";
  /** 안전 모드·빈 상태에서 빠진 블록(윤곽만). */
  absent?: boolean;
  live?: boolean;
  /** 보유 중일 때 둘째 줄(주도 사용량). */
  holderLine?: string;
}

export function ExtNode({
  n,
  st,
  selected,
  dimmed,
  onSelect,
  tag,
  markTone,
  absent,
  live,
  holderLine,
}: NodeProps) {
  const off = !st.on;
  const small = n.band === "L1" || n.band === "L0";
  const health =
    absent === true ? null : n.health === "auto_disabled" ? (
      <Mark tone="danger">
        <CircleX />
      </Mark>
    ) : n.health === "failing" && !off ? (
      <Mark tone="warning" count={n.failures}>
        <TriangleAlert />
      </Mark>
    ) : null;
  const meta =
    n.kind === "group"
      ? `${TRUST[n.trust ?? "builtin"]} · ${n.version}`
      : n.kind === "plugin"
        ? (n.sub ??
          `${n.trust === "project" ? "project · " : ""}${(n.provides ?? []).length > 0 ? (n.provides ?? []).join(" · ") : n.version}`)
        : n.sub;
  const status =
    n.health === "auto_disabled"
      ? "자동 꺼짐"
      : n.health === "disabled"
        ? "꺼짐"
        : off
          ? "이 맥락에서 꺼짐"
          : st.pending === "enable"
            ? "다음 단계 경계에 켜짐"
            : st.drive === "holder"
              ? "drive 보유"
              : st.drive === "waiting"
                ? "drive 대기"
                : "켜짐";
  return (
    <button
      type="button"
      data-node={n.id}
      aria-pressed={selected}
      aria-label={`${n.label} ${n.id} · ${n.band} · ${status}${(n.failures ?? 0) > 0 ? ` · 실패 ${n.failures}` : ""}`}
      onClick={() => onSelect(n.id)}
      className={[
        "absolute grid content-start gap-0.5 rounded-md text-start outline-none transition-[opacity,box-shadow] duration-quick focus-visible:shadow-focus",
        small ? "px-2 py-1" : "px-2 py-1.5",
        absent === true
          ? "border border-dashed border-border-default bg-transparent"
          : off
            ? "border border-dashed border-border-strong bg-surface-base/40"
            : "bg-surface-base shadow-[0_0_0_1px_var(--cs-color-border-subtle),var(--cs-elevation-1)] hover:shadow-[0_0_0_1px_var(--cs-color-border-default),var(--cs-elevation-2)]",
        dimmed === true ? "opacity-30" : "",
      ].join(" ")}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={`min-w-0 truncate ${small ? "text-ui-xs" : "text-ui-sm"} ${off || absent === true ? "text-text-tertiary" : "font-medium text-text-primary"}`}
        >
          {n.label}
        </span>
        {n.kind !== "core" && n.kind !== "platform" && n.id !== n.label && (
          <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">{n.id}</span>
        )}
        <span className="ms-auto flex flex-none items-center gap-0.5">
          {st.drive === "holder" && !off && (
            <Mark tone="neutral">
              <Play emphasis="selected" />
            </Mark>
          )}
          {health}
        </span>
      </span>
      {!small && meta !== undefined && (
        <span className="min-w-0 truncate text-ui-xs text-text-tertiary">
          {absent === true
            ? "안전 모드라 빠짐"
            : off && n.health !== "ok"
              ? status
              : st.drive === "holder" && live === true && holderLine !== undefined
                ? holderLine
                : st.drive === "waiting"
                  ? "drive 대기"
                  : st.pending === "enable"
                    ? "다음 단계 경계에 켜짐"
                    : meta}
        </span>
      )}
      <Ports n={n} off={off || absent === true} />
      {st.mark !== undefined && (
        <span
          className={`absolute -top-2 -left-2 grid size-4 place-items-center rounded-full text-micro leading-none font-semibold shadow-[0_0_0_2px_var(--cs-color-bg-app)] ${
            markTone === "remove"
              ? "bg-diff-remove-bg text-diff-remove-text"
              : markTone === "add"
                ? "bg-diff-add-bg text-diff-add-text"
                : "bg-neutral-solid text-neutral-on"
          }`}
          aria-hidden
        >
          {st.mark}
        </span>
      )}
      {tag !== undefined && (
        <span
          className={`absolute left-0 flex max-w-[200%] items-center gap-1 whitespace-nowrap ${n.band === "L3" ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {tag}
        </span>
      )}
    </button>
  );
}

/** 아래 가장자리 포트. 위치는 data.ts의 엣지 끝점 계산과 같다. */
function Ports({ n, off }: { n: CNode; off: boolean }) {
  const caps = n.consumes ?? [];
  const ops: { op: "on" | "post" | "drive"; dx: number; show: boolean }[] = [
    { op: "on", dx: 52, show: (n.points ?? []).length > 0 },
    { op: "post", dx: 34, show: n.usesPost === true },
    { op: "drive", dx: 16, show: n.usesDrive === true },
  ];
  const base = off ? "border-border-strong" : "border-text-tertiary";
  return (
    <>
      {caps.map((c, i) => (
        <span
          key={c.id}
          aria-hidden
          className={`absolute -bottom-[3.5px] size-[7px] rounded-full border ${base} ${c.need === "requires" ? (off ? "bg-border-strong" : "bg-text-tertiary") : "bg-surface-base"}`}
          style={{ left: 14 + i * 12 - 3.5 }}
        />
      ))}
      {ops
        .filter((o) => o.show)
        .map((o) => (
          <span
            key={o.op}
            aria-hidden
            title={o.op}
            className={`absolute -bottom-[4px] grid size-2 place-items-center border bg-surface-base ${base} ${
              o.op === "on"
                ? "rounded-full"
                : o.op === "post"
                  ? "rotate-45 rounded-[1px]"
                  : "rounded-[2px] bg-text-secondary"
            }`}
            style={{ left: n.w - o.dx - 4 }}
          />
        ))}
    </>
  );
}

/** X·F 노드: 표면은 같고, 안에 들어가는 내용은 부르는 쪽이 준다. */
export function HostNode({
  n,
  children,
  selected,
  onSelect,
  dimmed,
  quiet,
}: {
  n: CNode;
  children?: ReactNode;
  selected: boolean;
  onSelect: (id: string) => void;
  dimmed?: boolean;
  /** F 계약처럼 읽기 전용 칸. */
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      data-node={n.id}
      aria-pressed={selected}
      onClick={() => onSelect(n.id)}
      className={[
        "absolute grid content-start gap-0.5 rounded-md text-start outline-none transition-opacity focus-visible:shadow-focus",
        quiet === true
          ? "place-content-center bg-neutral-track/70 px-2 text-ui-xs text-text-secondary hover:bg-neutral-hover"
          : "bg-surface-base px-2 py-1.5 shadow-[0_0_0_1px_var(--cs-color-border-subtle),var(--cs-elevation-1)]",
        dimmed === true ? "opacity-30" : "",
      ].join(" ")}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      {quiet === true ? (
        n.label
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-ui-sm font-medium text-text-primary">{n.label}</span>
            {n.kind === "hook" && (
              <span className="truncate text-ui-xs text-text-tertiary">X 훅</span>
            )}
          </span>
          {children ?? <span className="truncate text-ui-xs text-text-tertiary">{n.sub}</span>}
        </>
      )}
    </button>
  );
}
