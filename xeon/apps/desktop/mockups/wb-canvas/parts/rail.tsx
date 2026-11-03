// 띠(층)와 레일. 층마다 한 띠, 띠 사이는 8px 틈과 바탕 단계로만 나눈다(선 없음, DP-03).
// X 띠의 훅 레일: 훅 종류 일곱 칸, 핸들러가 걸린 훅만 이름(꾸밈 없는 글자, DP-31)과 fold 모양 포트를 보인다.
// fold 모양: collect 고리, first 마름모(관문), chain 네모, tap 점.
import type { ReactNode } from "react";
import {
  BANDS,
  GROUP_KIT,
  PLUGIN_LANE_X,
  POINT_PORTS,
  POINT_RAIL,
  QUIET_PORTS,
  RAIL_SEGS,
  type Band,
  type Fold,
} from "../data";
import type { View } from "../store";

export function BandFills({ w, safe }: { w: number; safe?: boolean }) {
  return (
    <>
      {BANDS.map((b) => (
        <div
          key={b.id}
          aria-hidden
          className={`absolute left-0 rounded-lg ${b.id === "X" ? "bg-neutral-soft" : b.id === "F" ? "bg-neutral-soft/40" : "bg-neutral-soft/70"}`}
          style={{ top: b.y, height: b.h, width: w }}
        >
          {b.id === "L3" && safe === true && (
            <div
              className="absolute inset-0 rounded-lg"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, var(--cs-color-border-subtle) 0 1px, transparent 1px 8px)",
              }}
            />
          )}
        </div>
      ))}
      <div
        aria-hidden
        className="absolute border-l border-dashed border-border-default"
        style={{ left: PLUGIN_LANE_X, top: BANDS[1]!.y + 10, height: BANDS[1]!.h - 20 }}
      />
      <span
        className="absolute text-ui-xs text-text-tertiary"
        style={{ left: PLUGIN_LANE_X + 20, top: BANDS[1]!.y + 12 }}
      >
        외부 <span className="font-mono text-mono-sm">plugin</span>
      </span>
    </>
  );
}

/** 띠 이름: 화면 왼쪽에 붙고 세로로만 따라간다(이동해도 늘 보임). */
export function BandLabels({
  view,
  counts,
  context,
}: {
  view: View;
  counts: Partial<Record<Band["id"], string>>;
  context?: Partial<Record<Band["id"], ReactNode>>;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-20">
      {BANDS.map((b) => {
        const top = view.y + b.y * view.k;
        const h = b.h * view.k;
        return (
          <div
            key={b.id}
            className="absolute left-1 grid content-start gap-0.5 self-start rounded-sm bg-bg-app/85 px-1 py-0.5"
            style={{ top: top + 4, maxHeight: Math.max(0, h - 6) }}
          >
            <span className="font-mono text-mono-sm leading-none font-medium text-text-secondary">
              {b.id}
            </span>
            {h > 40 && (
              <span className="text-ui-xs leading-tight text-text-tertiary">{b.title}</span>
            )}
            {h > 56 && counts[b.id] !== undefined && (
              <span className="text-ui-xs leading-tight text-text-tertiary tabular-nums">
                {counts[b.id]}
              </span>
            )}
            {context?.[b.id]}
          </div>
        );
      })}
    </div>
  );
}

export function FoldGlyph({
  fold,
  active,
  size = 9,
}: {
  fold: Fold;
  active?: boolean;
  size?: number;
}) {
  const c =
    active === true
      ? "border-text-primary bg-text-primary"
      : "border-text-secondary bg-surface-base";
  const s = { width: size, height: size };
  if (fold === "first")
    return (
      <span
        aria-hidden
        className={`inline-block rotate-45 rounded-[1px] border ${c}`}
        style={{ width: size - 2, height: size - 2 }}
      />
    );
  if (fold === "chain")
    return <span aria-hidden className={`inline-block rounded-[1.5px] border ${c}`} style={s} />;
  if (fold === "collect")
    return (
      <span
        aria-hidden
        className={`inline-block rounded-full border-2 ${active === true ? "border-text-primary" : "border-text-secondary"} bg-surface-base`}
        style={s}
      />
    );
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full border ${c}`}
      style={{ width: size - 2, height: size - 2 }}
    />
  );
}

export function PointRail({
  activePoint,
  usedBy,
  dimOthers,
}: {
  /** 재생 중 지금 발화한 훅. */
  activePoint?: string | null;
  /** 훅마다 이 맥락에서 핸들러를 건 확장 수. */
  usedBy: Record<string, number>;
  dimOthers?: boolean;
}) {
  return (
    <div
      aria-label="훅 46"
      role="group"
      className="absolute"
      style={{ left: POINT_RAIL.x, top: POINT_RAIL.y }}
    >
      {RAIL_SEGS.map((s) => (
        <div
          key={s.kind}
          className="absolute rounded-md bg-surface-base/70 shadow-[0_0_0_1px_var(--cs-color-border-subtle)]"
          style={{ left: s.x - POINT_RAIL.x, top: 0, width: s.w - 4, height: POINT_RAIL.h }}
        >
          <span className="absolute bottom-1.5 left-2 flex items-baseline gap-1">
            <span className="font-mono text-mono-sm text-text-tertiary">{s.kind}</span>
            <span className="text-ui-xs text-text-tertiary tabular-nums">{s.count}</span>
          </span>
        </div>
      ))}
      {POINT_PORTS.map((p) => {
        const active = activePoint === p.name;
        const n = usedBy[p.name] ?? 0;
        const faded = dimOthers === true && !active;
        return (
          <span
            key={p.name}
            className={`absolute flex items-center gap-1.5 whitespace-nowrap transition-opacity ${faded ? "opacity-35" : ""}`}
            style={{ left: p.x - POINT_RAIL.x - 4.5, top: -4.5 }}
          >
            <FoldGlyph fold={p.fold} active={active} />
            <span className="grid pt-3 leading-tight">
              <span
                className={`text-ui-xs ${active ? "font-semibold text-text-primary" : n > 0 ? "text-text-secondary" : "text-text-tertiary"}`}
              >
                {p.name}
              </span>
              <span className="text-micro text-text-tertiary">
                {p.fold}
                {n > 0 ? ` · ${n}` : ""}
              </span>
            </span>
          </span>
        );
      })}
      {QUIET_PORTS.map((p) => {
        const active = activePoint === p.name;
        return (
          <span
            key={p.name}
            aria-hidden
            className={`absolute rounded-full border ${active ? "size-2.5 border-text-primary bg-text-primary" : "size-1.5 border-border-strong bg-surface-base"}`}
            style={{ left: p.x - POINT_RAIL.x - (active ? 5 : 3), top: active ? -5 : -3 }}
          />
        );
      })}
    </div>
  );
}

/** group-sdk 레일: 그룹 블록이 놓이는 바닥. 확장이 아니라 라이브러리라 고를 수 없다. */
export function GroupKitRail({ absent }: { absent?: boolean }) {
  return (
    <div
      className={`absolute flex items-center gap-3 rounded-md px-2.5 text-ui-xs ${absent === true ? "text-text-tertiary opacity-60" : "text-text-tertiary"} bg-neutral-track`}
      style={{ left: GROUP_KIT.x, top: GROUP_KIT.y, width: GROUP_KIT.w, height: GROUP_KIT.h }}
    >
      <span className="font-mono text-mono-sm text-text-secondary">group-sdk</span>
      <span>defineGroup</span>
      <span>DriveArbiter</span>
      <span>replayDrive</span>
      <span className="ms-auto">슬롯 · 트리거 · 펼치기 · 모으기 · 적용</span>
    </div>
  );
}
