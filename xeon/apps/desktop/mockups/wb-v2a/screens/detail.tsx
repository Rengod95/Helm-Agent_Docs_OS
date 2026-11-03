// 지도 3단계 "상세": 고른 블록 하나를 펼친다. 왼쪽 = 루프를 세로로 편 소켓 줄(꽂힌 소켓만 진하게), 가운데 = 블록의 포트
// (왼쪽 on 핀, 오른쪽 기능 받는 곳, 아래 post·drive), 오른쪽 = 기능을 내주는 서비스. 같은 높이 끼리 수평 엣지로 잇는다.
// 지도는 운영 화면이라 구조를 고치지 않는다(사용자 결정 2): 블록 머리에 "구성기에서 열기" 하나.
import { Lock, Play, SquarePen } from "../../_shell";
import { POINT_STATS, SOCKETS, T1_LEASE } from "../data";
import { useMock } from "../store";
import { EXT_ICON } from "../parts/block";
import { FOLD_LABEL, FoldGlyph, HueTile, Mark, orthH, orthV } from "../parts/kit";

export const DW = { w: 780, h: 600 };
const SY = (i: number) => 92 + i * 62;
const BX = 252;
const BW = 270;
const SX = 580;

const SERVICES = [
  {
    id: "agents",
    label: "에이전트",
    sub: "L1 코어",
    hue: "base" as const,
    y: 100,
    caps: [{ cap: "loop.spawn", need: "requires" as const }],
  },
  {
    id: "web-exa",
    label: "Exa 검색",
    sub: "L2 · web.search 제공",
    hue: "l2" as const,
    y: 190,
    caps: [{ cap: "web.search", need: "optional" as const }],
  },
  {
    id: "knowledge",
    label: "지식",
    sub: "L2 · 내장",
    hue: "l2" as const,
    y: 272,
    caps: [
      { cap: "knowledge.search", need: "optional" as const },
      { cap: "knowledge.skills", need: "optional" as const },
      { cap: "knowledge.memory", need: "optional" as const },
    ],
  },
  {
    id: "work",
    label: "작업",
    sub: "L2 · 내장",
    hue: "l2" as const,
    y: 412,
    caps: [{ cap: "work.tasks", need: "optional" as const }],
  },
];
const capY = (svc: (typeof SERVICES)[number], i: number) => svc.y + 46 + i * 24;

export function Detail() {
  const m = useMock();
  const stats = POINT_STATS.helm!;
  const used = new Set(stats.map((s) => s.point));
  const statOf = (p: string) => stats.find((s) => s.point === p);
  const wires: { d: string; dashed?: boolean; color: string; w?: number }[] = [];
  SOCKETS.forEach((s, i) => {
    if (!used.has(s.point)) return;
    wires.push({ d: `M${62} ${SY(i)} L${BX} ${SY(i)}`, color: "var(--ink-l3)" });
  });
  SERVICES.forEach((svc) =>
    svc.caps.forEach((c, i) => {
      wires.push({
        d: orthH([BX + BW, capY(svc, i)], [SX, capY(svc, i)], SX - 30),
        color: svc.hue === "base" ? "var(--ink-base)" : "var(--ink-l2)",
        dashed: c.need === "optional",
      });
    }),
  );
  wires.push({
    d: orthV([BX + 70, 528], [BX + 60, 560], 544),
    color: "var(--cs-color-text-tertiary)",
  });
  wires.push({
    d: orthV([BX + 190, 528], [BX + 180, 560], 544),
    color: "var(--cs-color-accent-solid)",
    w: 2.25,
  });

  return (
    <div className="wbv2 relative" style={{ width: DW.w, height: DW.h }}>
      {/* 루프 세로 줄 */}
      <div
        className="absolute rounded-full"
        style={{ left: 34, top: 40, width: 12, height: 500, background: "var(--track)" }}
      />
      <span className="absolute text-ui-sm text-text-secondary" style={{ left: 16, top: 12 }}>
        <span className="me-1.5 font-mono text-mono-micro" style={{ color: "var(--ink-x)" }}>
          X
        </span>
        루프의 소켓
      </span>
      {SOCKETS.map((s, i) => {
        const on = used.has(s.point);
        const st = statOf(s.point);
        return (
          <div
            key={s.point}
            className={`absolute flex items-center gap-2.5 ${on ? "" : "opacity-40"}`}
            style={{ left: 27, top: SY(i) - 13 }}
          >
            <span
              className="grid size-[26px] place-items-center rounded-full bg-surface-raised shadow-2"
              style={{
                boxShadow: `0 0 0 2px ${on ? "var(--ink-x)" : "var(--track-edge)"}, var(--cs-elevation-2)`,
              }}
            >
              <FoldGlyph
                fold={s.fold}
                color={on ? "var(--ink-x)" : "var(--cs-color-text-tertiary)"}
              />
            </span>
            <span className="grid leading-tight" style={{ width: 172 }}>
              <span className="truncate text-ui-sm text-text-primary">{s.point}</span>
              <span className="flex items-center gap-1 text-ui-xs text-text-tertiary [&_svg]:size-2.5">
                {s.failure === "closed" ? (
                  <>
                    <Lock /> 실패하면 거부
                  </>
                ) : (
                  FOLD_LABEL[s.fold]
                )}
                {on && st?.p95 != null && (
                  <span className="ms-auto tabular-nums">
                    p95 {st.p95 >= 1000 ? `${st.p95 / 1000}s` : `${st.p95}ms`}
                  </span>
                )}
              </span>
            </span>
          </div>
        );
      })}

      <svg aria-hidden className="pointer-events-none absolute inset-0" width={DW.w} height={DW.h}>
        {wires.map((w, i) => (
          <path
            key={i}
            d={w.d}
            fill="none"
            stroke={w.color}
            strokeWidth={w.w ?? 1.6}
            strokeDasharray={w.dashed ? "5 4" : undefined}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {/* 펼친 블록 */}
      <div
        className="absolute rounded-2xl bg-surface-raised shadow-3 ring-2 ring-accent-solid ring-offset-2 ring-offset-bg-app"
        style={{ left: BX, top: 40, width: BW, height: 488 }}
      >
        <div className="flex items-start gap-2.5 p-3.5">
          <HueTile hue="l3" size={36}>
            {EXT_ICON.helm}
          </HueTile>
          <div className="grid min-w-0 flex-1 leading-tight">
            <span className="text-title-4 text-text-primary" style={{ fontWeight: 700 }}>
              Helm
            </span>
            <span className="text-ui-xs text-text-tertiary">
              <span className="font-mono">helm</span> · L3 플러그인 그룹 · user 0.1.0
            </span>
          </div>
          <Mark tone="accent" icon={<Play />}>
            drive
          </Mark>
        </div>
        <div className="flex items-center gap-2 px-3.5 text-ui-xs text-text-secondary">
          차수 {T1_LEASE.epoch} · 턴 1/4 · spawn 3/8 · 토큰 120k/400k
        </div>
        <div className="mx-3.5 mt-3 grid gap-1">
          <span className="text-ui-xs text-text-tertiary">부품 7 · 매니페스트 선언</span>
          <div className="flex h-2 gap-[3px] overflow-hidden rounded-full">
            {["on", "on", "on", "on", "drive", "drive", "record"].map((op, i) => (
              <span
                key={i}
                className="flex-1"
                style={{
                  background:
                    op === "on"
                      ? "var(--tint-l3)"
                      : op === "drive"
                        ? "var(--ink-l3)"
                        : "var(--cs-color-neutral-track)",
                }}
              />
            ))}
          </div>
        </div>
        {/* 왼쪽 on 포트 이름 */}
        {SOCKETS.map((s, i) =>
          used.has(s.point) ? (
            <span
              key={s.point}
              className="absolute flex items-center gap-1.5 text-ui-xs text-text-secondary"
              style={{ left: 0, top: SY(i) - 40 - 9 }}
            >
              <span className="h-[5px] w-2 rounded-e-sm" style={{ background: "var(--ink-l3)" }} />
              on
            </span>
          ) : null,
        )}
        {/* 오른쪽 기능 포트 이름 */}
        {SERVICES.flatMap((svc) =>
          svc.caps.map((c, i) => (
            <span
              key={c.cap}
              className="absolute right-0 flex items-center gap-1.5 text-ui-xs text-text-secondary"
              style={{ top: capY(svc, i) - 40 - 9 }}
            >
              <span className="font-mono text-mono-micro">{c.cap}</span>
              {c.need === "requires" ? (
                <span className="size-2 rounded-full" style={{ background: "var(--ink-base)" }} />
              ) : (
                <span className="size-2 rounded-full border-[1.5px] border-[var(--ink-l2)]" />
              )}
            </span>
          )),
        )}
        <div className="absolute inset-x-3.5 bottom-3 flex items-center justify-between">
          <span className="text-ui-xs text-text-tertiary">post · drive</span>
          <button
            type="button"
            onClick={() => m.set({ screen: "compose", composeView: "parts" })}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-ui-xs text-text-secondary outline-none hover:bg-fill-hover focus-visible:focus-ring [&_svg]:size-3.5"
          >
            <SquarePen /> 구성기에서 열기
          </button>
        </div>
      </div>

      {/* 서비스 */}
      {SERVICES.map((svc) => (
        <div
          key={svc.id}
          className="absolute rounded-xl bg-surface-raised p-2.5 shadow-2"
          style={{ left: SX, top: svc.y, width: 192, height: 40 + svc.caps.length * 24 }}
        >
          <div className="flex items-center gap-2">
            <HueTile hue={svc.hue} size={24}>
              {EXT_ICON[svc.id] ?? EXT_ICON.helm}
            </HueTile>
            <span className="grid leading-tight">
              <span className="text-ui-strong text-text-primary">{svc.label}</span>
              <span className="text-micro text-text-tertiary">{svc.sub}</span>
            </span>
          </div>
          {svc.caps.map((c, i) => (
            <span
              key={c.cap}
              className="absolute left-0 flex items-center gap-1.5"
              style={{ top: capY(svc, i) - svc.y - 7 }}
            >
              <span
                className="h-2.5 w-1.5 rounded-e-full"
                style={{ background: svc.hue === "base" ? "var(--ink-base)" : "var(--ink-l2)" }}
              />
              <span className="font-mono text-mono-micro text-text-secondary">{c.cap}</span>
            </span>
          ))}
        </div>
      ))}
      <span className="absolute text-ui-sm text-text-secondary" style={{ left: SX, top: 64 }}>
        <span className="me-1.5 font-mono text-mono-micro" style={{ color: "var(--ink-l2)" }}>
          L2
        </span>
        기능을 내주는 서비스
      </span>
      <span
        className="absolute flex flex-wrap items-center gap-x-3 gap-y-1 w-[190px] text-micro text-text-tertiary"
        style={{ left: SX, top: 486 }}
      >
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: "var(--ink-base)" }} /> 꼭 필요
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full border-[1.5px] border-[var(--ink-l2)]" /> 없으면 그
          기능만 빠짐
        </span>
      </span>

      {/* 역 */}
      <span
        className="absolute grid h-7 place-items-center rounded-lg bg-surface-raised px-3 text-ui-xs text-text-secondary shadow-2"
        style={{ left: BX + 20, top: 560, width: 80 }}
      >
        post 큐
      </span>
      <span
        className="absolute flex h-7 items-center gap-1.5 rounded-lg bg-accent-soft px-3 text-ui-xs text-accent-text shadow-2 [&_svg]:size-3"
        style={{ left: BX + 130, top: 560 }}
      >
        <Play /> drive 자리 · 보유 중
      </span>
    </div>
  );
}
