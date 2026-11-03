// 지도 2단계 "층": 건물 단면. 위에서 아래로 L3 플러그인 그룹(+ 외부 plugin 판) → X 루프(소켓·역) → L2 서비스 → L1·L0 기반 → F 계약.
// 규칙: 위에서 꽂는 것(훅)은 루프 위에, 아래서 받치는 것(기능)은 루프 아래에 둔다. 엣지는 기본으로 그리지 않고 소켓 아래 색 점으로
// 연결을 보인다. 고른 블록, 주도, 실패만 엣지로 그린다(SPEC §3).
import { type ReactNode } from "react";
import { Diamond } from "../../_shell";
import {
  BASE_CHIPS,
  DIFF_EXPLORE,
  EXTS,
  FLOORS,
  HUE_OF,
  LOOP,
  LW,
  PLUGIN_PLATE,
  STATIONS,
  T1_LEASE,
  T1_ON,
  socketOf,
  type Ext,
  type Hue,
} from "../data";
import { useMock } from "../store";
import { Block, holderMark, pinsOf } from "../parts/block";
import { Hull, Mark, WireLabel, hueVar, orthV, type Rect } from "../parts/kit";
import { LoopTrack } from "../parts/loop";

export const isOnIn = (ctx: string, e: Ext) =>
  ctx === "t1" ? T1_ON.includes(e.id) : e.health === "ok" || e.health === "failing";

function Plate({
  y,
  h,
  hue,
  layer,
  title,
  count,
  x = 0,
  w = LW.w,
}: {
  y: number;
  h: number;
  hue: Hue;
  layer: string;
  title: string;
  count?: string;
  x?: number;
  w?: number;
}) {
  return (
    <div
      className="absolute rounded-2xl"
      style={{ left: x, top: y, width: w, height: h, background: hueVar(hue, "plate") }}
    >
      <span className="absolute top-2 left-4 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-mono text-mono-micro" style={{ color: hueVar(hue, "ink") }}>
          {layer}
        </span>
        <span className="text-ui-sm text-text-secondary">{title}</span>
        {count !== undefined && (
          <span className="text-ui-xs text-text-tertiary tabular-nums">{count}</span>
        )}
      </span>
    </div>
  );
}

interface WireSpec {
  d: string;
  tone: "hue" | "accent" | "danger" | "warning" | "muted";
  hue?: Hue;
  dashed?: boolean;
  flow?: boolean;
}

function wiresFor(
  e: Ext,
  lane: number,
  opt: { only?: "drive" | "on-fail"; tone?: WireSpec["tone"] } = {},
): WireSpec[] {
  const out: WireSpec[] = [];
  const hue = HUE_OF[e.layer];
  for (const p of pinsOf(e)) {
    if (opt.only === "drive" && p.kind !== "drive") continue;
    let target: [number, number];
    if (p.kind === "on") {
      const s = socketOf(p.point!);
      if (s === undefined) continue;
      target = [s.x, LOOP.y - 15];
    } else if (p.kind === "post") target = [STATIONS.post.x - 14 + (lane % 4) * 9, LOOP.y - 13];
    else target = [STATIONS.drive.x - 30 + (lane % 3) * 14, LOOP.y - 13];
    out.push({
      d: orthV([p.x, p.y + 2], target, 140 + lane * 7),
      tone: opt.tone ?? (p.kind === "drive" ? "accent" : "hue"),
      hue,
    });
  }
  return out;
}

const STROKE: Record<WireSpec["tone"], string> = {
  hue: "",
  accent: "var(--cs-color-accent-solid)",
  danger: "var(--cs-color-danger-solid)",
  warning: "var(--cs-color-warning-solid)",
  muted: "var(--cs-color-text-tertiary)",
};

export function LayerMap({ overlay }: { overlay?: ReactNode }) {
  const m = useMock();
  const ctx = m.ctx;
  const t1 = ctx === "t1";
  const hookers = EXTS.filter((e) => e.layer === "L3" || e.layer === "plugin");
  const laneOf = (id: string) => hookers.findIndex((e) => e.id === id);
  const sel = m.selected !== null ? EXTS.find((e) => e.id === m.selected) : undefined;

  // 소켓에 꽂힌 블록 색
  const plugged: Record<string, Hue[]> = {};
  for (const e of hookers) {
    if (!isOnIn(ctx, e)) continue;
    for (const p of e.points ?? []) (plugged[p] ??= []).push(HUE_OF[e.layer]);
  }

  // 그릴 엣지
  const wires: WireSpec[] = [];
  const labels: ReactNode[] = [];
  if (t1) {
    wires.push(
      ...wiresFor(extById("helm"), laneOf("helm"), { only: "drive" }).map((w) => ({
        ...w,
        flow: true,
      })),
    );
    wires.push(
      ...wiresFor(extById("plan-first"), laneOf("plan-first"), {
        only: "drive",
        tone: "muted",
      }).map((w) => ({
        ...w,
        dashed: true,
      })),
    );
    labels.push(
      <WireLabel key="wait" x={560} y={152} style={{ fontSize: 11 }}>
        계획 먼저 · 주도 대기
      </WireLabel>,
    );
  }
  if (m.failure) {
    const rv = extById("review");
    wires.push(
      ...wiresFor(rv, laneOf("review"), { tone: "danger" }).map((w) => ({ ...w, dashed: true })),
    );
    const ac = extById("acme-notes");
    wires.push(...wiresFor(ac, laneOf("acme-notes"), { tone: "warning" }));
    labels.push(
      <WireLabel key="rv" x={520} y={158} tone="danger">
        timeout 5s × 5
      </WireLabel>,
      <WireLabel key="ac" x={420} y={176} tone="warning">
        예외 → 거부 2
      </WireLabel>,
    );
  }
  if (sel !== undefined && !m.failure && (sel.layer === "L3" || sel.layer === "plugin"))
    wires.push(...wiresFor(sel, laneOf(sel.id)));
  // 둘러보기 3단계: Helm이 놓이고 핀이 소켓에 꽂힌다
  const install = m.tour === 2;
  if (install) wires.push(...wiresFor(extById("helm"), laneOf("helm"), { tone: "accent" }));

  const lit = new Set<string>(
    install
      ? (extById("helm").points ?? [])
      : sel !== undefined && !m.failure
        ? (sel.points ?? [])
        : [],
  );
  const providers = new Set(
    (sel?.consumes ?? []).flatMap((c) =>
      EXTS.filter((e) =>
        e.provides?.some(
          (p) => p === c.cap || (c.cap.startsWith("knowledge") && p.startsWith("knowledge")),
        ),
      ).map((e) => e.id),
    ),
  );
  const related = (id: string) =>
    sel === undefined || m.failure || id === sel.id || providers.has(id);

  const hull: Rect[] = [
    { x: 6, y: 22, w: 472, h: 156 },
    { x: 640, y: 22, w: 132, h: 156 },
    { x: 6, y: 168, w: 888, h: 152 },
    { x: 6, y: 314, w: 702, h: 146 },
  ];

  const statusFor = (e: Ext) => {
    if (t1 && e.id === "helm") return holderMark;
    return undefined;
  };
  const metaFor = (e: Ext) => {
    if (t1 && e.id === "helm") return `drive 보유 · 턴 ${T1_LEASE.turns[0]}/${T1_LEASE.turns[1]}`;
    if (t1 && e.id === "plan-first") return "주도 대기 · 구성 정보 없음";
    if (t1 && e.id === "dialog") return "다음 경계에 켜짐";
    return undefined;
  };

  return (
    <div className="wbv2 relative" style={{ width: LW.w, height: LW.h }}>
      <Plate
        y={FLOORS.L3.y}
        h={FLOORS.L3.h}
        hue="l3"
        layer="L3"
        title="플러그인 그룹"
        count="켜짐 3/4"
        w={624}
      />
      <div
        className="absolute rounded-2xl"
        style={{
          left: PLUGIN_PLATE.x - 8,
          top: 0,
          width: LW.w - PLUGIN_PLATE.x + 8,
          height: FLOORS.L3.h,
          background: "var(--plate-pl)",
        }}
      >
        <span className="absolute top-2 left-4 flex items-baseline gap-1.5">
          <span className="font-mono text-mono-micro" style={{ color: "var(--ink-pl)" }}>
            plugin
          </span>
          <span className="text-ui-sm text-text-secondary">외부</span>
          <span className="text-ui-xs text-text-tertiary">켜짐 1/2</span>
        </span>
      </div>
      <Plate
        y={FLOORS.X.y}
        h={FLOORS.X.h}
        hue="x"
        layer="X"
        title="에이전트 루프 · 훅"
        count="46개 · 쓰는 곳 7"
      />
      <Plate y={FLOORS.L2.y} h={FLOORS.L2.h} hue="l2" layer="L2" title="서비스(기능)" count="5" />
      <Plate
        y={FLOORS.base.y}
        h={FLOORS.base.h}
        hue="base"
        layer="L1·L0"
        title="기반"
        count="코어 5 · 플랫폼 4"
      />
      <div
        className="absolute flex items-center gap-3 rounded-xl px-4 text-ui-xs text-text-tertiary"
        style={{
          left: 0,
          top: FLOORS.F.y,
          width: LW.w,
          height: FLOORS.F.h,
          background: "var(--plate-base)",
        }}
      >
        <span className="font-mono text-mono-micro">F</span>
        <span className="text-text-secondary">계약</span>
        <span>
          매니페스트 · 훅 표 46 · 연산 4(on · post · drive · scope) · 그룹 레코드 · 기능 계약 · wire
        </span>
      </div>

      {t1 && <Hull id="h-t1" rects={hull} color="var(--hull-thread)" w={LW.w} h={LW.h} />}

      <LoopTrack
        plugged={plugged}
        lit={lit}
        alarm={
          m.failure ? { "boundary.settle.after": "danger", "tool.call.before": "warning" } : {}
        }
        drive={
          t1
            ? { holder: "helm", line: `차수 ${T1_LEASE.epoch} · 턴 1/4 · spawn 3/8`, live: true }
            : undefined
        }
        postCount={t1 ? 1 : undefined}
      />

      <svg aria-hidden className="pointer-events-none absolute inset-0" width={LW.w} height={LW.h}>
        {wires.map((w, i) => (
          <path
            key={i}
            d={w.d}
            fill="none"
            stroke={w.tone === "hue" ? hueVar(w.hue ?? "l3", "ink") : STROKE[w.tone]}
            strokeWidth={w.tone === "accent" ? 2.25 : 1.6}
            strokeLinecap="round"
            strokeDasharray={w.dashed ? "5 5" : undefined}
            className={w.flow ? "wbv2-flow" : undefined}
            opacity={w.tone === "muted" ? 0.8 : 1}
          />
        ))}
        {/* 흐름 위에 같은 길 실선 바탕 */}
        {wires
          .filter((w) => w.flow)
          .map((w, i) => (
            <path
              key={`b${i}`}
              d={w.d}
              fill="none"
              stroke="var(--cs-color-accent-solid)"
              strokeWidth={2.25}
              opacity={0.25}
            />
          ))}
      </svg>
      {labels}

      {EXTS.map((e) => {
        const off = !isOnIn(ctx, e) && !(m.diff && e.id === "dialog");
        const d = m.diff ? DIFF_EXPLORE[e.id]?.mark : undefined;
        return (
          <Block
            key={e.id}
            e={e}
            off={off}
            selected={m.selected === e.id}
            faded={!related(e.id) || (t1 && off && e.id !== "dialog")}
            status={statusFor(e)}
            meta={m.diff && DIFF_EXPLORE[e.id] ? DIFF_EXPLORE[e.id]!.note : metaFor(e)}
            diff={d}
            onSelect={(id) => m.select(id)}
            className={
              install && e.id === "helm"
                ? "wbv2-drop"
                : m.diff && e.id === "dialog"
                  ? "[&>button]:border-diff-add-text [&>button]:bg-diff-add-bg/40"
                  : sel !== undefined && providers.has(e.id) && !m.failure
                    ? "[&>button]:ring-2 [&>button]:ring-offset-2 [&>button]:ring-offset-bg-app [&>button]:ring-[var(--ink-l2)]"
                    : ""
            }
          />
        );
      })}

      {/* 기반 칩 */}
      <div className="absolute flex gap-2" style={{ left: 120, top: FLOORS.base.y + 28 }}>
        {BASE_CHIPS.map((c, i) => (
          <span
            key={c.id}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg bg-surface-raised px-2.5 font-mono text-mono-sm text-text-secondary shadow-1 ${
              i === 5 ? "ms-6" : ""
            } ${sel?.id === "helm" && c.id === "agents" ? "ring-2 ring-[var(--ink-base)]" : ""}`}
          >
            <span className="size-1.5 rounded-full" style={{ background: "var(--ink-base)" }} />
            {c.label}
          </span>
        ))}
      </div>
      <span
        className="absolute font-mono text-mono-micro text-text-tertiary"
        style={{ left: 120 + 5 * 92 - 2, top: FLOORS.base.y + 10 }}
      >
        L0
      </span>

      {t1 && (
        <span
          className="absolute flex h-6 -translate-y-1/2 items-center gap-1.5 rounded-full px-2.5 text-ui-xs text-text-primary shadow-2"
          style={{ left: 250, top: 12, background: "var(--cs-color-surface-raised)" }}
        >
          <span className="size-2 rounded-full bg-accent-solid" />
          <span className="text-ui-sm">대화 · 캐시 무효화 조사</span>
          <span className="text-text-tertiary">실시간 · 턴 7 · 켜짐 8</span>
        </span>
      )}
      {sel !== undefined && !m.failure && sel.consumes !== undefined && (
        <span className="absolute" style={{ left: sel.x + 8, top: sel.y + sel.h + 18 }}>
          <WireLabel x={0} y={0} style={{ transform: "none" }}>
            기능 {sel.consumes.length} · 아래 서비스에서
          </WireLabel>
        </span>
      )}
      {overlay}
    </div>
  );
}

function extById(id: string) {
  return EXTS.find((e) => e.id === id)!;
}
