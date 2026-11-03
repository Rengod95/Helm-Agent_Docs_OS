// 표 보기: 층 × 훅 열지도 + 지표 표(인라인 스파크라인). 투명한 가운데 위(DP-01, DP-26).
// 칸 색 = 예산 대비 p95(로그 눈금, on 포트와 같은 아이리스 한 색상), 예산을 넘으면 danger 면, 실패는 모서리 점과 수.
// 열은 캔버스 훅 열과 같은 루프 순서·가족 묶음이라 지도와 표가 한 체계로 읽힌다.
import { SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useState } from "react";
import { LayoutGrid, Rows3 } from "../../_shell";
import { FAMILIES, HEAT, HEAT_ROWS, METRICS, SOCKETS, extById } from "../data";
import { ExtIcon, Face, FoldGlyph, Spark } from "../parts/kit";
import { useMock } from "../store";

type Metric = "p95" | "fail" | "calls";

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}`);

function fill(ratio: number) {
  if (ratio >= 1) return "var(--cs-color-danger-soft)";
  const t = Math.max(0, Math.min(1, (Math.log10(Math.max(ratio, 0.0005)) + 3.3) / 3.3));
  return `color-mix(in oklab, var(--port-on) ${Math.round(8 + t * 72)}%, var(--cs-color-surface-base))`;
}

export function TableScreen() {
  const m = useMock();
  const [metric, setMetric] = useState<Metric>("p95");
  const lanes = ["L3", "plugin"];
  const maxCalls = 212;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6">
      <div className="flex h-12 flex-none items-center gap-3">
        <h1 className="text-title-4 text-text-primary">층 × 훅</h1>
        <span className="text-ui-xs text-text-tertiary">지난 7일 · 핸들러가 걸린 훅 7/46</span>
        <div className="ms-auto flex items-center gap-1.5">
          <SegmentedControl
            aria-label="값"
            size="sm"
            value={metric}
            onValueChange={(v) => setMetric(v as Metric)}
          >
            <SegmentedControlItem value="p95">지연 p95</SegmentedControlItem>
            <SegmentedControlItem value="fail">실패</SegmentedControlItem>
            <SegmentedControlItem value="calls">호출</SegmentedControlItem>
          </SegmentedControl>
          <SegmentedControl
            aria-label="보기"
            size="sm"
            content="icon"
            value="table"
            onValueChange={(v) => v === "map" && m.set({ screen: "map" })}
          >
            <SegmentedControlItem value="map" aria-label="지도" icon={<LayoutGrid />} />
            <SegmentedControlItem value="table" aria-label="층 × 훅 표" icon={<Rows3 />} />
          </SegmentedControl>
        </div>
      </div>

      {/* 열지도 */}
      <div className="overflow-x-auto">
        <div
          role="table"
          aria-label="층 × 훅 열지도"
          className="grid w-max gap-x-1 gap-y-1"
          style={{ gridTemplateColumns: `160px repeat(${SOCKETS.length}, 84px) 92px` }}
        >
          {/* 가족 머리 */}
          <div />
          {FAMILIES.map((f) => {
            const n = SOCKETS.filter((s) => s.family === f.id).length;
            return (
              <div
                key={f.id}
                className="flex h-5 items-end border-b border-[var(--block-edge)] pb-0.5 font-mono text-[10px] text-text-tertiary"
                style={{ gridColumn: `span ${n}` }}
              >
                {f.label}.
              </div>
            );
          })}
          <div />
          <div
            role="columnheader"
            className="flex h-8 items-end pb-1 text-ui-xs text-text-tertiary"
          >
            확장
          </div>
          {SOCKETS.map((s) => (
            <div
              key={s.point}
              role="columnheader"
              className="flex h-8 flex-col justify-end gap-0.5 pb-1"
              title={s.point}
            >
              <span className="flex items-center gap-1 text-[11px] text-text-secondary">
                <FoldGlyph fold={s.fold} />
                <span className="truncate">{s.short}</span>
              </span>
              <span className="font-mono text-[9.5px] text-text-tertiary">
                예산 {fmtMs(s.budgetMs)}
              </span>
            </div>
          ))}
          <div
            role="columnheader"
            className="flex h-8 items-end justify-end pb-1 text-ui-xs text-text-tertiary"
          >
            최악
          </div>

          {lanes.map((lane) => (
            <div key={lane} className="contents">
              <div className="col-span-full flex h-7 items-end gap-1.5 pb-1">
                <span className="font-mono text-[10.5px] font-medium text-text-tertiary">
                  {lane}
                </span>
                <span className="text-ui-xs text-text-tertiary">
                  {lane === "L3" ? "플러그인 그룹" : "외부 확장"}
                </span>
              </div>
              {HEAT_ROWS.filter((r) => r.lane === lane).map((r) => {
                const e = extById(r.id);
                const row = HEAT[r.id] ?? {};
                const worst = Math.max(
                  0,
                  ...SOCKETS.map((s) => (row[s.point]?.p95 ?? 0) / s.budgetMs),
                );
                return (
                  <div key={r.id} role="row" className="contents">
                    <div role="rowheader" className="flex h-10 items-center gap-2">
                      <Face health={e.health} size={20}>
                        <ExtIcon name={e.icon} />
                      </Face>
                      <span className="truncate text-ui-sm text-text-primary">{e.label}</span>
                      <span className="truncate font-mono text-[10px] text-text-tertiary">
                        {e.id}
                      </span>
                    </div>
                    {SOCKETS.map((s) => {
                      const c = row[s.point];
                      if (c === undefined)
                        return (
                          <div key={s.point} role="cell" className="grid h-10 place-items-center">
                            <span className="size-1 rounded-full bg-border-default" />
                          </div>
                        );
                      const ratio = c.p95 === null ? 0 : c.p95 / s.budgetMs;
                      const bg =
                        metric === "p95"
                          ? c.p95 === null
                            ? "transparent"
                            : fill(ratio)
                          : metric === "fail"
                            ? c.fail > 0
                              ? `color-mix(in oklab, var(--cs-color-danger-solid) ${20 + c.fail * 12}%, var(--cs-color-surface-base))`
                              : "var(--cs-color-surface-base)"
                            : `color-mix(in oklab, var(--port-on) ${Math.round(6 + (c.calls / maxCalls) * 70)}%, var(--cs-color-surface-base))`;
                      const text =
                        metric === "p95"
                          ? c.p95 === null
                            ? "—"
                            : fmtMs(c.p95)
                          : metric === "fail"
                            ? String(c.fail)
                            : String(c.calls);
                      const over = metric === "p95" && ratio >= 1;
                      return (
                        <div
                          key={s.point}
                          role="cell"
                          aria-label={`${e.label} ${s.point} p95 ${c.p95 ?? "없음"}ms 실패 ${c.fail}`}
                          className="relative flex h-10 flex-col justify-center rounded-md px-2"
                          style={{
                            background: bg,
                            boxShadow: over
                              ? "inset 0 0 0 1px var(--cs-color-danger-border)"
                              : "inset 0 0 0 1px var(--block-edge)",
                          }}
                        >
                          <span
                            className={`font-mono text-[12px] font-medium tabular-nums ${over ? "text-danger-text" : "text-text-primary"}`}
                          >
                            {text}
                            {metric === "p95" && c.p95 !== null && c.p95 < 1000 && (
                              <span className="text-[9.5px] font-normal text-text-secondary">
                                ms
                              </span>
                            )}
                          </span>
                          {metric === "p95" && c.p95 !== null && (
                            <span className="font-mono text-[9.5px] text-text-secondary tabular-nums">
                              {ratio < 0.01 ? "<1" : Math.round(ratio * 100)}%
                            </span>
                          )}
                          {c.fail > 0 && metric !== "fail" && (
                            <span className="absolute top-1 right-1 flex items-center gap-0.5 font-mono text-[9.5px] text-danger-text">
                              <span className="size-1.5 rounded-full bg-danger-solid" />
                              {c.fail}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    <div role="cell" className="flex h-10 items-center justify-end gap-2">
                      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-neutral-track">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.max(3, Math.min(1, worst) * 100)}%`,
                            background:
                              worst >= 1
                                ? "var(--cs-color-danger-solid)"
                                : worst >= 0.5
                                  ? "var(--cs-color-warning-solid)"
                                  : "var(--port-on)",
                          }}
                        />
                      </span>
                      <span className="w-8 text-end font-mono text-[10.5px] text-text-tertiary tabular-nums">
                        {Math.round(Math.min(worst, 9.99) * 100)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 범례 */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-text-tertiary">
        <span className="flex items-center gap-2">
          예산 대비 p95
          <span className="flex h-2.5 w-36 overflow-hidden rounded-full">
            {[0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 0.7].map((r) => (
              <span key={r} className="flex-1" style={{ background: fill(r) }} />
            ))}
          </span>
          <span className="font-mono">0.1% → 100%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-danger-soft shadow-[inset_0_0_0_1px_var(--cs-color-danger-border)]" />
          예산 넘음
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-danger-solid" />
          실패 수
        </span>
        <span className="flex items-center gap-1.5">
          <FoldGlyph fold="collect" /> collect <FoldGlyph fold="first" /> first{" "}
          <FoldGlyph fold="chain" /> chain <FoldGlyph fold="tap" /> tap
        </span>
      </div>

      {/* 지표 표 */}
      <h2 className="mt-7 mb-1 text-ui-sm text-text-secondary">확장 지표 · 7일</h2>
      <div
        role="table"
        aria-label="확장 지표"
        className="grid w-full max-w-[880px] items-center gap-x-4"
        style={{ gridTemplateColumns: "minmax(140px,1.4fr) 110px 70px 64px 110px 54px 54px" }}
      >
        {["확장", "토큰", "비용", "주도", "p95 추이", "실패", "거부"].map((h, i) => (
          <div
            key={h}
            role="columnheader"
            className={`flex h-8 items-center text-ui-xs text-text-tertiary ${i > 0 && i !== 1 && i !== 4 ? "justify-end" : ""}`}
          >
            {h}
          </div>
        ))}
        {METRICS.map((r) => {
          const e = extById(r.id);
          return (
            <div key={r.id} role="row" className="contents">
              <div className="flex h-9 items-center gap-2">
                <Face health={e.health} size={20}>
                  <ExtIcon name={e.icon} />
                </Face>
                <span className="truncate text-ui-sm text-text-primary">{e.label}</span>
                <span className="font-mono text-[10px] text-text-tertiary">{e.layer}</span>
              </div>
              <div className="flex items-center gap-2">
                <Spark data={r.spark} w={46} h={14} />
                <span className="font-mono text-[11.5px] text-text-primary tabular-nums">
                  {r.tokens >= 1000 ? `${(r.tokens / 1000).toFixed(1)}M` : `${r.tokens}k`}
                </span>
              </div>
              <span className="text-end font-mono text-[11.5px] text-text-primary tabular-nums">
                ${r.cost.toFixed(2)}
              </span>
              <span className="text-end font-mono text-[11.5px] text-text-secondary tabular-nums">
                {r.leaseMin}분
              </span>
              <div className="flex items-center gap-2">
                <Spark
                  data={r.p95}
                  w={56}
                  h={14}
                  tone={
                    Math.max(...r.p95) >= 5000 ? "var(--cs-color-danger-solid)" : "var(--port-on)"
                  }
                  fill
                />
              </div>
              <span
                className={`text-end font-mono text-[11.5px] tabular-nums ${r.failures > 0 ? "text-danger-text" : "text-text-tertiary"}`}
              >
                {r.failures}
              </span>
              <span className="text-end font-mono text-[11.5px] text-text-tertiary tabular-nums">
                {r.denies}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
