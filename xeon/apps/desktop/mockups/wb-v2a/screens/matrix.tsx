// "표" 보기: 층 × 훅 행렬(누가 어느 소켓에 꽂혔나)과 그룹 구성 부품 목록. 행 = 훅을 거는 확장(층 색 등줄),
// 열 = 훅(종류별 묶음, 아무도 안 건 종류는 좁은 빈 열로 접음). 칸 = 꽂힘. 보기 바꾸기: 연결 · 지연(p95/예산 열지도) · 실패.
import { SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useState } from "react";
import { Lock } from "../../_shell";
import { GROUP_PARTS, HUE_OF, MATRIX_COLS, MATRIX_ROWS, POINT_STATS, type Op } from "../data";
import { useMock } from "../store";
import { EXT_ICON } from "../parts/block";
import { FoldGlyph, HueTile, hueVar } from "../parts/kit";

type Mode = "link" | "latency" | "fail";
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}s` : `${v}ms`);

function heat(ratio: number) {
  if (ratio >= 0.95) return "var(--cs-color-danger-soft)";
  if (ratio >= 0.2) return "var(--cs-color-warning-soft)";
  if (ratio >= 0.05)
    return "color-mix(in oklab, var(--cs-color-warning-soft) 45%, var(--cs-color-neutral-well))";
  return "var(--cs-color-neutral-well)";
}

const OP_FACE: Record<Op, { bg: string; fg: string; label: string }> = {
  on: { bg: "var(--tint-l3)", fg: "var(--cs-color-text-primary)", label: "on" },
  drive: { bg: "var(--ink-l3)", fg: "var(--cs-color-text-inverse)", label: "drive" },
  post: { bg: "var(--cs-color-neutral-track)", fg: "var(--cs-color-text-primary)", label: "post" },
  record: {
    bg: "var(--cs-color-neutral-well)",
    fg: "var(--cs-color-text-secondary)",
    label: "기록",
  },
};

export function Matrix() {
  const m = useMock();
  const [mode, setMode] = useState<Mode>("latency");
  const cols = MATRIX_COLS.flatMap((g) => g.points.map((p) => p.point));
  const count = (p: string) =>
    MATRIX_ROWS.filter((r) => POINT_STATS[r.id]?.some((s) => s.point === p)).length;
  const grid = `11rem ${MATRIX_COLS.map((g) => (g.points.length === 0 ? "1.75rem" : g.points.map(() => "5.5rem").join(" "))).join(" ")} minmax(4.5rem,1fr)`;

  return (
    <div className="wbv2 min-h-0 flex-1 overflow-auto">
      <div className="mx-auto grid w-full max-w-[58rem] gap-6 px-3 pt-2 pb-8">
        <section className="grid gap-2">
          <div className="flex items-center gap-3">
            <h2 className="m-0 text-ui-strong text-text-primary">누가 어느 소켓에 꽂혔나</h2>
            <span className="text-ui-sm text-text-tertiary">훅 6 · 쓰는 훅 7/46</span>
            <SegmentedControl
              size="xs"
              aria-label="칸 보기"
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="ms-auto"
            >
              <SegmentedControlItem value="link">연결</SegmentedControlItem>
              <SegmentedControlItem value="latency">지연</SegmentedControlItem>
              <SegmentedControlItem value="fail">실패</SegmentedControlItem>
            </SegmentedControl>
          </div>
          <div
            role="table"
            aria-label="층 × 훅"
            className="grid items-center gap-x-1 gap-y-1"
            style={{ gridTemplateColumns: grid }}
          >
            {/* 종류 머리 */}
            <span />
            {MATRIX_COLS.map((g) => (
              <span
                key={g.kind}
                className="truncate border-b border-border-subtle pb-1 text-ui-xs text-text-tertiary tabular-nums"
                style={{ gridColumn: `span ${Math.max(1, g.points.length)}` }}
                title={`${g.kind} ${g.points.length + g.quiet}`}
              >
                {g.points.length === 0
                  ? g.kind.slice(0, 3)
                  : `${g.kind} ${g.points.length + g.quiet}`}
              </span>
            ))}
            <span />
            {/* 훅 머리 + 꽂힌 수 막대 */}
            <span className="text-ui-xs text-text-tertiary"></span>
            {MATRIX_COLS.map((g) =>
              g.points.length === 0 ? (
                <span
                  key={g.kind}
                  className="h-12 rounded-md bg-[repeating-linear-gradient(135deg,var(--cs-color-neutral-well)_0_3px,transparent_3px_6px)]"
                  title={`${g.kind} · 비어 있음`}
                />
              ) : (
                g.points.map((p) => (
                  <span key={p.point} className="grid h-12 content-end gap-1 px-0.5">
                    <span className="flex items-end gap-[2px]">
                      {Array.from({ length: count(p.point) }).map((_, i) => (
                        <span
                          key={i}
                          className="h-1.5 w-2 rounded-[2px]"
                          style={{ background: "var(--ink-x)" }}
                        />
                      ))}
                    </span>
                    <span className="flex items-center gap-1 text-ui-xs leading-tight text-text-primary">
                      <FoldGlyph fold={p.fold} size={8} color="var(--ink-x)" />
                      <span className="truncate">{p.short}</span>
                    </span>
                    <span className="flex items-center gap-0.5 text-micro text-text-tertiary [&_svg]:size-2.5">
                      {p.failure === "closed" ? (
                        <>
                          <Lock /> 거부
                        </>
                      ) : p.failure === "skip" ? (
                        "건너뜀"
                      ) : (
                        "통과"
                      )}
                    </span>
                  </span>
                ))
              ),
            )}
            <span />
            {/* 행 */}
            {MATRIX_ROWS.map((r, ri) => {
              const stats = POINT_STATS[r.id] ?? [];
              const hue = HUE_OF[r.layer];
              const fails = stats.reduce((a, s) => a + s.failures, 0);
              const prevLayer = ri > 0 ? MATRIX_ROWS[ri - 1]!.layer : r.layer;
              const gapTop = prevLayer !== r.layer ? "mt-2" : "";
              return [
                <button
                  key={`${r.id}-h`}
                  type="button"
                  onClick={() => m.select(r.id)}
                  className={`flex h-11 items-center gap-2 rounded-lg ps-1 pe-2 text-left outline-none hover:bg-fill-hover focus-visible:focus-ring ${gapTop} ${m.selected === r.id ? "bg-fill-selected" : ""}`}
                >
                  <span
                    className="h-7 w-[3px] rounded-full"
                    style={{ background: hueVar(hue, "ink") }}
                  />
                  <HueTile hue={hue} size={24}>
                    {EXT_ICON[r.id] ?? EXT_ICON.review}
                  </HueTile>
                  <span className="grid min-w-0 leading-tight">
                    <span
                      className={`truncate text-ui-sm ${r.note === "자동 꺼짐" ? "text-text-tertiary" : "text-text-primary"}`}
                    >
                      {r.label}
                    </span>
                    <span className="truncate text-micro text-text-tertiary">
                      <span className="font-mono">{r.layer}</span>
                      {r.note !== undefined ? ` · ${r.note}` : ""}
                    </span>
                  </span>
                </button>,
                ...MATRIX_COLS.flatMap((g) =>
                  g.points.length === 0
                    ? [<span key={`${r.id}-${g.kind}`} className={`h-11 ${gapTop}`} />]
                    : g.points.map((p) => {
                        const s = stats.find((x) => x.point === p.point);
                        if (s === undefined)
                          return (
                            <span
                              key={`${r.id}-${p.point}`}
                              className={`grid h-11 place-items-center ${gapTop}`}
                            >
                              <span className="size-1 rounded-full bg-neutral-track" />
                            </span>
                          );
                        const ratio = s.p95 === null ? 0 : s.p95 / s.budgetMs;
                        const bg =
                          mode === "latency"
                            ? heat(ratio)
                            : mode === "fail"
                              ? s.failures > 0
                                ? "var(--cs-color-danger-soft)"
                                : "var(--cs-color-neutral-well)"
                              : hueVar(hue, "tint");
                        return (
                          <span
                            key={`${r.id}-${p.point}`}
                            title={`${r.label} · ${p.point} · p95 ${s.p95 === null ? "—" : ms(s.p95)} / ${ms(s.budgetMs)} · 실패 ${s.failures}`}
                            className={`relative grid h-11 content-center justify-items-center rounded-lg ${gapTop} ${r.note === "자동 꺼짐" ? "opacity-60" : ""}`}
                            style={{ background: bg }}
                          >
                            {mode === "link" ? (
                              <span
                                className="h-2 w-5 rounded-full"
                                style={{ background: hueVar(hue, "ink") }}
                              />
                            ) : mode === "latency" ? (
                              <>
                                <span className="text-ui-xs text-text-primary tabular-nums">
                                  {s.p95 === null ? "—" : ms(s.p95)}
                                </span>
                                <span className="text-micro text-text-tertiary tabular-nums">
                                  {Math.round(ratio * 100)}%
                                </span>
                              </>
                            ) : (
                              <span className="text-ui-xs text-text-secondary tabular-nums">
                                {s.failures}
                              </span>
                            )}
                            {s.failures > 0 && mode !== "fail" && (
                              <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-solid px-1 text-micro text-danger-on tabular-nums">
                                {s.failures}
                              </span>
                            )}
                          </span>
                        );
                      }),
                ),
                <span
                  key={`${r.id}-sum`}
                  className={`ps-2 text-ui-xs text-text-tertiary tabular-nums ${gapTop}`}
                >
                  소켓 {stats.length}
                  {fails > 0 ? ` · 실패 ${fails}` : ""}
                </span>,
              ];
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 text-micro text-text-tertiary">
            {mode === "latency" && (
              <span className="flex items-center gap-1.5">
                p95 / 예산
                {[0.01, 0.1, 0.4, 1].map((r) => (
                  <span key={r} className="h-3 w-5 rounded-sm" style={{ background: heat(r) }} />
                ))}
                5% · 20% · 95%+
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="grid h-3.5 min-w-3.5 place-items-center rounded-full bg-danger-solid px-1 text-danger-on">
                n
              </span>{" "}
              최근 실패
            </span>
            <span>{cols.length}개 열 · 빗금 = 아무도 안 건 종류(request 9, guard 3)</span>
          </div>
        </section>

        <section className="grid gap-2">
          <div className="flex items-baseline gap-3">
            <h2 className="m-0 text-ui-strong text-text-primary">그룹 구성 · 부품 목록</h2>
            <span className="text-ui-sm text-text-tertiary">
              매니페스트 composition 선언에서 읽어요
            </span>
          </div>
          <div className="grid gap-2">
            {Object.entries(GROUP_PARTS).map(([id, parts]) => (
              <div key={id} className="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-1">
                <span className="flex items-center gap-2 ps-1">
                  <span
                    className="h-7 w-[3px] rounded-full"
                    style={{ background: "var(--ink-l3)" }}
                  />
                  <span className="text-ui-sm text-text-primary">
                    {MATRIX_ROWS.find((r) => r.id === id)?.label}
                  </span>
                  <span className="text-micro text-text-tertiary tabular-nums">
                    {parts === null ? "" : `부품 ${parts.length}`}
                  </span>
                </span>
                {parts === null ? (
                  <span className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border-default px-3 text-ui-xs text-text-tertiary">
                    <span className="text-text-secondary">구성 정보 없음</span>
                    매니페스트에 composition이 없어 한 블록으로 보여요
                  </span>
                ) : (
                  <span className="flex h-9 gap-[3px]">
                    {parts.map((p, i) => (
                      <span
                        key={i}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-ui-xs first:rounded-s-lg last:rounded-e-lg"
                        style={{
                          background: p.failed ? "var(--cs-color-danger-soft)" : OP_FACE[p.op].bg,
                          color: p.failed ? "var(--cs-color-danger-text)" : OP_FACE[p.op].fg,
                        }}
                      >
                        <span className="truncate">{p.title}</span>
                        <span className="ms-auto flex-none font-mono text-mono-micro opacity-70">
                          {OP_FACE[p.op].label}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
