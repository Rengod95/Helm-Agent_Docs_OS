// 층 × 훅 표(보기 "표"): 행 = 훅을 건 플러그인(층별 묶음, 묶음마다 "더하기"), 열 = 쓰인 훅(턴 흐름 순서, 단계 머리).
// 칸 = fold 글리프(층 ink) + p95, 예산 대비로 면 단계(옅음 → warning → danger). 아무도 안 건 단계는 빗금 좁은 열.
import { SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useState } from "react";
import { Plus } from "../../_shell";
import { HOOKS, LAYERS, STAGES, pluginById, stageOf, type LayerId } from "../data";
import { FOLD_LABEL, Face, FoldGlyph, ICON, LayerCode, Mine, ink, tint } from "../parts/kit";
import { useMock } from "../store";

const COLS = [...new Set(HOOKS.map((h) => h.point))].sort(
  (a, b) =>
    STAGES.findIndex((s) => s.id === stageOf(a)) - STAGES.findIndex((s) => s.id === stageOf(b)),
);
const GROUPS: LayerId[] = ["L3", "L2", "L1", "X"];

function Hatch() {
  return (
    <div
      aria-hidden
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, var(--edge-strong) 0 1px, transparent 1px 6px)",
      }}
    />
  );
}

export function MatrixView() {
  const m = useMock();
  const [val, setVal] = useState<"link" | "p95" | "fail">("p95");
  const rowsOf = (l: LayerId) => [
    ...new Set(HOOKS.filter((h) => pluginById(h.plugin).layer === l).map((h) => h.plugin)),
  ];
  const stagesUsed = STAGES.map((s) => ({ s, cols: COLS.filter((c) => stageOf(c) === s.id) }));
  const grid = `208px ${stagesUsed.map(({ cols }) => (cols.length === 0 ? "28px" : cols.map(() => "minmax(58px,1fr)").join(" "))).join(" ")}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      <div className="flex items-center gap-2">
        <SegmentedControl
          size="xs"
          aria-label="칸 값"
          value={val}
          onValueChange={(v) => setVal(v as typeof val)}
        >
          <SegmentedControlItem value="link">연결</SegmentedControlItem>
          <SegmentedControlItem value="p95">지연 p95</SegmentedControlItem>
          <SegmentedControlItem value="fail">실패</SegmentedControlItem>
        </SegmentedControl>
        <span className="text-ui-xs text-text-tertiary">
          {Object.entries(FOLD_LABEL).map(([k, v]) => (
            <span key={k} className="me-2.5 inline-flex items-center gap-1">
              <FoldGlyph fold={k} color="var(--cs-color-text-secondary)" />
              {v}
            </span>
          ))}
        </span>
      </div>
      <div
        role="table"
        aria-label="층 × 훅"
        className="grid min-w-[880px]"
        style={{ gridTemplateColumns: grid }}
      >
        {/* 단계 머리 */}
        <div />
        {stagesUsed.map(({ s, cols }) => (
          <div
            key={s.id}
            className="flex items-end gap-1 px-1 pb-0.5 text-ui-xs text-text-secondary"
            style={{ gridColumn: `span ${Math.max(1, cols.length)}` }}
          >
            {cols.length === 0 ? (
              <span className="text-text-tertiary" title={`${s.label} · 아무도 없음`}>
                {s.label.slice(0, 1)}
              </span>
            ) : (
              <>
                <span className="text-ui-sm text-text-primary">{s.label}</span>
                <span className="font-mono text-mono-sm text-text-tertiary">{s.id}</span>
              </>
            )}
          </div>
        ))}
        {/* 훅 머리 */}
        <div className="pb-2 text-ui-xs text-text-tertiary">플러그인 · 훅</div>
        {stagesUsed.map(({ s, cols }) =>
          cols.length === 0 ? (
            <Hatch key={s.id} />
          ) : (
            cols.map((c) => (
              <div key={c} className="truncate px-1 pb-2 text-ui-xs text-text-secondary" title={c}>
                {c.split(".").slice(1).join(".")}
              </div>
            ))
          ),
        )}
        {GROUPS.map((l) => {
          const layer = LAYERS.find((x) => x.id === l)!;
          return [
            <div
              key={`${l}-h`}
              className="flex items-center gap-1.5 pt-2.5 pb-1"
              style={{ gridColumn: `1 / span 1` }}
            >
              <LayerCode l={l} />
              <span className="text-ui-sm text-text-primary">{layer.name}</span>
              <button
                type="button"
                onClick={() =>
                  l === "L1"
                    ? m.set({ screen: "layers", overlay: "add-l1" })
                    : m.notify(`${layer.name}에 ${layer.addNoun} 더하기`)
                }
                className="ms-auto flex h-5 items-center gap-0.5 rounded-md px-1.5 text-ui-xs text-text-tertiary outline-none hover:bg-surface-raised hover:text-text-primary focus-visible:shadow-focus [&_svg]:size-3"
                style={{ boxShadow: "inset 0 0 0 1px var(--edge-strong)" }}
              >
                <Plus />
                {layer.addNoun}
              </button>
            </div>,
            ...stagesUsed.flatMap(({ s, cols }) =>
              cols.length === 0
                ? [<Hatch key={`${l}-h-${s.id}`} />]
                : cols.map((c) => <div key={`${l}-h-${c}`} className="pt-2.5" />),
            ),
            ...rowsOf(l).flatMap((pid) => {
              const p = pluginById(pid);
              return [
                <button
                  key={pid}
                  type="button"
                  onClick={() => m.set({ screen: "layers", focus: pid })}
                  className="flex h-9 min-w-0 items-center gap-1.5 rounded-md pe-2 text-start outline-none hover:bg-surface-raised focus-visible:shadow-focus"
                >
                  <Face l={p.layer} icon={ICON[p.icon]} size={20} />
                  <span
                    className={`min-w-0 truncate text-ui-xs ${p.health === "off" || p.health === "auto_off" ? "text-text-tertiary" : "text-text-primary"}`}
                  >
                    {p.name}
                  </span>
                  <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
                    {p.id}
                  </span>
                  <span className="flex-1" />
                  {p.origin !== "builtin" && <Mine origin={p.origin as "user"} compact />}
                </button>,
                ...stagesUsed.flatMap(({ s, cols }) =>
                  cols.length === 0
                    ? [<Hatch key={`${pid}-${s.id}`} />]
                    : cols.map((c) => {
                        const h = HOOKS.find((x) => x.plugin === pid && x.point === c);
                        if (h === undefined) return <div key={`${pid}-${c}`} className="h-9" />;
                        const r =
                          h.p95 !== undefined && h.budget !== undefined ? h.p95 / h.budget : 0;
                        const bg =
                          val === "fail"
                            ? (h.fails ?? 0) > 0
                              ? "var(--cs-color-danger-soft)"
                              : "var(--cs-color-surface-raised)"
                            : val === "link"
                              ? tint(p.layer)
                              : r > 1
                                ? "var(--cs-color-danger-soft)"
                                : r > 0.5
                                  ? "var(--cs-color-warning-soft)"
                                  : tint(p.layer);
                        return (
                          <div key={`${pid}-${c}`} className="h-9 p-0.5">
                            <div
                              className="relative flex h-full items-center justify-center gap-1 rounded-md"
                              style={{ background: bg }}
                              title={`${p.name} · ${c} · ${FOLD_LABEL[h.fold]}`}
                            >
                              <FoldGlyph fold={h.fold} color={ink(p.layer)} />
                              {val !== "link" && (
                                <span className="font-mono text-mono-sm tabular-nums text-text-primary">
                                  {val === "fail"
                                    ? (h.fails ?? 0)
                                    : h.p95 === undefined
                                      ? "–"
                                      : h.p95 >= 1000
                                        ? `${(h.p95 / 1000).toFixed(1)}s`
                                        : `${h.p95}`}
                                </span>
                              )}
                              {(h.fails ?? 0) > 0 && val !== "fail" && (
                                <span className="absolute right-0.5 top-0.5 grid h-3 min-w-3 place-items-center rounded-full bg-danger-solid px-0.5 font-mono text-mono-micro text-danger-on">
                                  {h.fails}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }),
                ),
              ];
            }),
          ];
        })}
      </div>
      <p className="m-0 text-ui-xs text-text-tertiary">
        p95는 ms, 외부 훅 예산은 30초예요. L0 어댑터와 공통 규약은 훅에 훅을 걸지 않아 표에 없어요.
      </p>
    </div>
  );
}
