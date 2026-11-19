// 메트릭 화면의 그림 섹션: 컨텍스트 분해, 블록별 시간, 플러그인 표, 날별 흐름, 버전 전후, 머리 숫자.
// 모든 그림은 같은 내용의 표로 바꿔 볼 수 있다. 값이 없는 칸은 0이 아니라 "아직 기록되지 않음"·"표본 부족"이다.
import { activeLocale, t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { MetricsQueryResult } from "@fresnel/contracts/wire";
import { Button, Select, SelectOption } from "@caustic/react";
import { ArrowDown } from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChartTable,
  Columns,
  FigureToggle,
  Legend,
  PairBars,
  SegmentBar,
  placeAlong,
  StackRows,
  Swatch,
  type Series,
} from "./charts.tsx";
import { cellText, countText, msText, percentText, tokensText } from "./format.ts";
import { KIND_COLOR } from "./glyphs.tsx";
import {
  CONTEXT_PARTS,
  CONTEXT_TOP,
  COMPARE_METRICS,
  blockTimeOf,
  cellOf,
  contextOf,
  dailyOf,
  foldSlices,
  pluginRowsOf,
  sortPluginRows,
  valueOf,
  type Cell,
  type CompareMetric,
  type ContextPart,
  type PluginRow,
  type PluginSort,
  type TimeBlock,
} from "./model.ts";
import { Card, Gate, LoadProblem, LoadingBlock, Section, Stat } from "./parts.tsx";
import type { MetricsActions, MetricsData, PluginVersionRow } from "./source.ts";

// ───────── 컨텍스트 ─────────

const PART_WORD: Readonly<Record<ContextPart, MessageId>> = {
  always: "desktop.craft.metrics.context.part.always",
  drive: "desktop.craft.metrics.context.part.drive",
  onDemand: "desktop.craft.metrics.context.part.onDemand",
};

/** 갈래 색: Drive만 종류 색이고, 늘 실림과 필요할 때 실림은 Inject의 진하기 둘이다 */
const PART_COLOR: Readonly<Record<ContextPart, string>> = {
  always: "var(--viz-inject)",
  drive: KIND_COLOR.drive,
  onDemand: "color-mix(in oklab, var(--viz-inject) 45%, transparent)",
};

export function partSeries(): readonly Series[] {
  return CONTEXT_PARTS.map((part) => ({
    id: part,
    label: t(PART_WORD[part]),
    color: PART_COLOR[part],
  }));
}

/** 플러그인마다 먹 진하기를 바꿔 이어 붙인 막대의 칸이 갈린다(색은 종류에만 쓴다) */
const SLICE_INK = [
  "color-mix(in oklab, var(--cs-color-text-primary) 72%, transparent)",
  "color-mix(in oklab, var(--cs-color-text-primary) 56%, transparent)",
  "color-mix(in oklab, var(--cs-color-text-primary) 44%, transparent)",
  "color-mix(in oklab, var(--cs-color-text-primary) 34%, transparent)",
  "color-mix(in oklab, var(--cs-color-text-primary) 26%, transparent)",
  "color-mix(in oklab, var(--cs-color-text-primary) 20%, transparent)",
];

export function ContextSection(props: {
  readonly data: MetricsData;
  readonly hero: boolean;
}): ReactNode {
  const [table, setTable] = useState(false);
  return (
    <Section
      id="cm-context"
      title={t("desktop.craft.metrics.context.title")}
      info={t("desktop.craft.metrics.context.info")}
      actions={
        <FigureToggle
          table={table}
          onToggle={() => {
            setTable(!table);
          }}
        />
      }
    >
      <Gate
        load={props.data.plugins}
        height={props.hero ? 260 : 200}
        label={t("desktop.craft.metrics.context.title")}
        onRetry={props.data.actions.reload}
      >
        {(result) => {
          const breakdown = contextOf(pluginRowsOf(result));
          if (breakdown.slices.length === 0) {
            return (
              <div className="flex min-h-12 items-center rounded-xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
                {breakdown.missing.length === 0
                  ? t("desktop.craft.metrics.context.none")
                  : t("desktop.craft.metrics.context.sampleOnly", {
                      n: String(breakdown.missing.length),
                    })}
              </div>
            );
          }
          if (table) {
            return (
              <ChartTable
                caption={t("desktop.craft.metrics.context.title")}
                columns={[
                  { id: "plugin", label: t("desktop.craft.metrics.table.plugin") },
                  ...CONTEXT_PARTS.map((part) => ({
                    id: part,
                    label: t(PART_WORD[part]),
                    numeric: true,
                  })),
                  { id: "total", label: t("desktop.craft.metrics.context.perTurn"), numeric: true },
                ]}
                rows={breakdown.slices.map((s) => ({
                  id: s.plugin,
                  cells: [
                    s.plugin,
                    ...CONTEXT_PARTS.map((part) => tokensText(s.parts[part])),
                    tokensText(s.total),
                  ],
                }))}
              />
            );
          }
          const folded = foldSlices(breakdown.slices, CONTEXT_TOP);
          const segments = [
            ...folded.shown.map((s, i) => ({
              id: s.plugin,
              label: s.plugin,
              value: s.total,
              color: SLICE_INK[i % SLICE_INK.length] ?? "var(--viz-pass)",
              valueText: tokensText(s.total),
            })),
            ...(folded.rest === null
              ? []
              : [
                  {
                    id: "__rest",
                    label: t("desktop.craft.metrics.context.rest", {
                      n: String(folded.rest.count),
                    }),
                    value: folded.rest.total,
                    color: "color-mix(in oklab, var(--cs-color-text-primary) 13%, transparent)",
                    valueText: tokensText(folded.rest.total),
                  },
                ]),
          ];
          return (
            <div className="grid gap-5">
              <div className="grid gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="viz-figure text-title-1 leading-8 font-semibold text-text-primary">
                    {tokensText(breakdown.total)}
                  </span>
                  <span className="text-ui text-text-secondary">
                    {t("desktop.craft.metrics.context.perTurnLong")}
                  </span>
                  <span className="ml-auto flex items-center gap-4 text-ui-sm text-text-secondary">
                    {CONTEXT_PARTS.map((part) => (
                      <span key={part} className="flex items-center gap-1.5">
                        <Swatch color={PART_COLOR[part]} />
                        {t(PART_WORD[part])}
                        <span className="viz-figure text-text-primary">
                          {tokensText(breakdown.totals[part])}
                        </span>
                      </span>
                    ))}
                  </span>
                </div>
                <SegmentBar
                  segments={segments}
                  height={props.hero ? 32 : 24}
                  labels
                  label={t("desktop.craft.metrics.context.byPlugin")}
                />
              </div>
              <div className="grid gap-2">
                <div className="text-ui-sm text-text-tertiary">
                  {t("desktop.craft.metrics.context.byPart")}
                </div>
                <StackRows
                  series={partSeries()}
                  label={t("desktop.craft.metrics.context.byPart")}
                  format={tokensText}
                  rows={breakdown.slices.slice(0, props.hero ? 10 : 6).map((s) => ({
                    id: s.plugin,
                    name: s.plugin,
                    label: s.plugin,
                    parts: CONTEXT_PARTS.map((part) => ({ series: part, value: s.parts[part] })),
                    totalText: tokensText(s.total),
                  }))}
                />
              </div>
              {breakdown.missing.length === 0 ? null : (
                <p className="text-ui-sm text-text-tertiary">
                  {t("desktop.craft.metrics.context.missing", {
                    names: breakdown.missing.slice(0, 4).join(", "),
                    n: String(breakdown.missing.length),
                  })}
                </p>
              )}
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

// ───────── 블록별 시간 ─────────

const BLOCK_WORD: Readonly<Record<TimeBlock, MessageId>> = {
  model: "desktop.craft.metrics.block.model",
  tools: "desktop.craft.metrics.block.tools",
  hook: "desktop.craft.metrics.block.hook",
  ask: "desktop.craft.metrics.block.ask",
  rest: "desktop.craft.metrics.block.rest",
};

const BLOCK_COLOR: Readonly<Record<TimeBlock, string>> = {
  model: "var(--viz-model)",
  tools: KIND_COLOR.tool,
  hook: KIND_COLOR.hook,
  ask: "var(--viz-asked)",
  rest: "var(--viz-pass)",
};

export function TimeSection(props: { readonly data: MetricsData }): ReactNode {
  const [table, setTable] = useState(false);
  return (
    <Section
      id="cm-time"
      title={t("desktop.craft.metrics.time.title")}
      info={t("desktop.craft.metrics.time.info")}
      actions={
        <FigureToggle
          table={table}
          onToggle={() => {
            setTable(!table);
          }}
        />
      }
    >
      <Gate
        load={props.data.blocks}
        height={120}
        label={t("desktop.craft.metrics.time.title")}
        onRetry={props.data.actions.reload}
      >
        {(result) => {
          const time = blockTimeOf(result);
          if (table) {
            return (
              <ChartTable
                caption={t("desktop.craft.metrics.time.title")}
                columns={[
                  { id: "block", label: t("desktop.craft.metrics.table.block") },
                  { id: "ms", label: t("desktop.craft.metrics.time.perTurn"), numeric: true },
                ]}
                rows={time.blocks.map((b) => ({
                  id: b.block,
                  cells: [t(BLOCK_WORD[b.block]), cellText(b.cell, msText)],
                }))}
              />
            );
          }
          const known = time.blocks.filter((b) => b.cell.kind === "value");
          const missing = time.blocks.filter((b) => b.cell.kind !== "value");
          return (
            <div className="grid gap-3">
              <div className="flex items-baseline gap-2">
                <span className="viz-figure text-title-2 leading-7 font-semibold text-text-primary">
                  {cellText(time.total, msText)}
                </span>
                <span className="text-ui text-text-secondary">
                  {t("desktop.craft.metrics.time.perTurnLong")}
                </span>
              </div>
              {known.length === 0 ? (
                <div className="viz-hatch h-5 rounded-md" aria-hidden="true" />
              ) : (
                <SegmentBar
                  segments={known.map((b) => ({
                    id: b.block,
                    label: t(BLOCK_WORD[b.block]),
                    value: valueOf(b.cell) ?? 0,
                    color: BLOCK_COLOR[b.block],
                    valueText: cellText(b.cell, msText),
                  }))}
                  height={20}
                  label={t("desktop.craft.metrics.time.title")}
                />
              )}
              <Legend
                series={known.map((b) => ({
                  id: b.block,
                  label: `${t(BLOCK_WORD[b.block])} ${cellText(b.cell, msText)}`,
                  color: BLOCK_COLOR[b.block],
                }))}
              />
              {missing.length === 0 ? null : (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-text-tertiary">
                  {missing.map((b) => (
                    <li key={b.block} className="flex items-center gap-1.5">
                      <Swatch color="" hatch />
                      {t(BLOCK_WORD[b.block])} · {cellText(b.cell, msText)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

// ───────── 플러그인 표 ─────────

const SORT_WORD: Readonly<Record<PluginSort, MessageId>> = {
  context: "desktop.craft.metrics.table.context",
  blocked: "desktop.craft.metrics.table.blocked",
  asked: "desktop.craft.metrics.table.asked",
  defied: "desktop.craft.metrics.table.defied",
  calls: "desktop.craft.metrics.table.calls",
};

/** 표의 숫자 칸. 값이 없으면 사유를 흐리게(0이 아니다) */
function Num(props: { readonly cell: Cell; readonly format: (v: number) => string }): ReactNode {
  if (props.cell.kind !== "value") {
    return (
      <span className="text-ui-sm text-text-tertiary">{cellText(props.cell, props.format)}</span>
    );
  }
  return <span className="viz-figure text-text-primary">{cellText(props.cell, props.format)}</span>;
}

/** 컨텍스트 칸의 작은 막대(가장 큰 줄 = 칸 폭) */
function ContextBar(props: { readonly row: PluginRow; readonly max: number }): ReactNode {
  if (props.row.context === null) {
    return <Num cell={props.row.always} format={tokensText} />;
  }
  const parts = CONTEXT_PARTS.map((part) => ({ part, v: valueOf(props.row[part]) ?? 0 })).filter(
    (p) => p.v > 0,
  );
  const total = props.row.context;
  const width = 72;
  const placed = placeAlong(
    parts.map((p, i) =>
      Math.max(1.5, (p.v / Math.max(props.max, 1)) * width - (i < parts.length - 1 ? 1.5 : 0)),
    ),
    1.5,
  );
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={width} height={8} aria-hidden="true" className="block shrink-0">
        <rect width={width} height={8} rx={3} fill="var(--viz-track)" />
        {parts.map((p, i) => (
          <rect
            key={p.part}
            x={placed[i]?.x ?? 0}
            width={placed[i]?.w ?? 0}
            height={8}
            rx={i === 0 || i === parts.length - 1 ? 3 : 1}
            fill={PART_COLOR[p.part]}
          />
        ))}
      </svg>
      <span className="viz-figure w-14 text-right text-text-primary">{tokensText(total)}</span>
    </span>
  );
}

const TABLE_LIMIT = 12;

export function PluginTableSection(props: { readonly data: MetricsData }): ReactNode {
  const [sort, setSort] = useState<PluginSort>("context");
  const [all, setAll] = useState(false);
  return (
    <Section
      id="cm-plugins"
      title={t("desktop.craft.metrics.table.title")}
      info={[t("desktop.craft.metrics.table.info"), t("desktop.craft.metrics.table.defiedInfo")]}
    >
      <Gate
        load={props.data.plugins}
        height={240}
        label={t("desktop.craft.metrics.table.title")}
        onRetry={props.data.actions.reload}
      >
        {(result) => {
          const rows = sortPluginRows(pluginRowsOf(result), sort);
          if (rows.length === 0) {
            return (
              <div className="flex min-h-12 items-center rounded-xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
                {t("desktop.craft.metrics.table.none")}
              </div>
            );
          }
          const max = Math.max(1, ...rows.map((r) => r.context ?? 0));
          const shown = all ? rows : rows.slice(0, TABLE_LIMIT);
          const header = (id: PluginSort | null, label: string, numeric: boolean): ReactNode => (
            <th
              scope="col"
              aria-sort={id !== null && sort === id ? "descending" : undefined}
              className={`h-8 px-3 font-normal ${numeric ? "text-right" : "text-left"}`}
            >
              {id === null ? (
                label
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  aria-pressed={sort === id}
                  className={`-mx-1.5 font-normal ${sort === id ? "text-text-primary" : "text-text-tertiary"}`}
                  onClick={() => {
                    setSort(id);
                  }}
                >
                  {label}
                  {sort === id ? <ArrowDown size={12} /> : null}
                </Button>
              )}
            </th>
          );
          return (
            <div className="grid gap-2">
              <div className="overflow-x-auto rounded-xl border border-border-subtle">
                <table className="viz-figure w-full border-collapse text-ui">
                  <caption className="sr-only">{t("desktop.craft.metrics.table.title")}</caption>
                  <thead>
                    <tr className="border-b border-border-subtle text-ui-sm text-text-tertiary">
                      {header(null, t("desktop.craft.metrics.table.plugin"), false)}
                      {header("context", t(SORT_WORD.context), true)}
                      {header(null, t("desktop.craft.metrics.table.hookRuns"), true)}
                      {header("blocked", t(SORT_WORD.blocked), true)}
                      {header("asked", t(SORT_WORD.asked), true)}
                      {header("defied", t(SORT_WORD.defied), true)}
                      {header(null, t("desktop.craft.metrics.table.fault"), true)}
                      {header("calls", t(SORT_WORD.calls), true)}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr
                        key={row.plugin}
                        className="h-9 border-b border-border-subtle last:border-b-0 hover:bg-neutral-hover"
                      >
                        <th
                          scope="row"
                          className="max-w-56 truncate px-3 text-left font-normal text-text-primary"
                        >
                          {row.plugin}
                        </th>
                        <td className="px-3 text-right">
                          <ContextBar row={row} max={max} />
                        </td>
                        <td className="px-3 text-right">
                          <Num cell={row.hookRuns} format={countText} />
                        </td>
                        <td className="px-3 text-right">
                          <Num cell={row.blocked} format={countText} />
                        </td>
                        <td className="px-3 text-right">
                          <Num cell={row.asked} format={countText} />
                        </td>
                        <td className="px-3 text-right">
                          <Num cell={row.defied} format={countText} />
                        </td>
                        <td className="px-3 text-right">
                          <Num cell={row.fault} format={percentText} />
                        </td>
                        <td className="px-3 text-right">
                          <Num cell={row.calls} format={countText} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!all && rows.length > TABLE_LIMIT ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-fit"
                  onClick={() => {
                    setAll(true);
                  }}
                >
                  {t("desktop.craft.metrics.table.more", { n: String(rows.length - TABLE_LIMIT) })}
                </Button>
              ) : null}
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

// ───────── 날별 흐름 ─────────

function decisionSeries(): readonly Series[] {
  return [
    { id: "blocked", label: t("desktop.craft.metrics.daily.blocked"), color: "var(--viz-blocked)" },
    { id: "asked", label: t("desktop.craft.metrics.daily.asked"), color: "var(--viz-modified)" },
  ];
}

function dayTick(day: string, long: boolean): string {
  const at = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat(
    activeLocale(),
    long
      ? { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }
      : { month: "numeric", day: "numeric", timeZone: "UTC" },
  ).format(at);
}

export function DailySection(props: {
  readonly data: MetricsData;
  readonly height?: number;
}): ReactNode {
  const [table, setTable] = useState(false);
  return (
    <Section
      id="cm-daily"
      title={t("desktop.craft.metrics.daily.title")}
      actions={
        <FigureToggle
          table={table}
          onToggle={() => {
            setTable(!table);
          }}
        />
      }
    >
      <Gate
        load={props.data.daily}
        height={220}
        label={t("desktop.craft.metrics.daily.title")}
        onRetry={props.data.actions.reload}
      >
        {(result) => {
          const points = dailyOf(result);
          if (table) {
            return (
              <ChartTable
                caption={t("desktop.craft.metrics.daily.title")}
                columns={[
                  { id: "day", label: t("desktop.craft.metrics.table.day") },
                  { id: "turns", label: t("desktop.craft.metrics.daily.turns"), numeric: true },
                  { id: "blocked", label: t("desktop.craft.metrics.daily.blocked"), numeric: true },
                  { id: "asked", label: t("desktop.craft.metrics.daily.asked"), numeric: true },
                ]}
                rows={points.map((p) => ({
                  id: p.day,
                  cells: [
                    dayTick(p.day, true),
                    countText(p.turns),
                    p.blocked === null
                      ? t("desktop.craft.metrics.cell.sample")
                      : countText(p.blocked),
                    p.asked === null ? t("desktop.craft.metrics.cell.sample") : countText(p.asked),
                  ],
                }))}
              />
            );
          }
          const h = props.height ?? 120;
          return (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <div className="text-ui-sm text-text-tertiary">
                  {t("desktop.craft.metrics.daily.turns")}
                </div>
                <Columns
                  series={[
                    {
                      id: "turns",
                      label: t("desktop.craft.metrics.daily.turns"),
                      color: "var(--viz-asked)",
                    },
                  ]}
                  points={points.map((p) => ({
                    id: p.day,
                    tick: dayTick(p.day, false),
                    title: dayTick(p.day, true),
                    parts: [{ series: "turns", value: p.turns }],
                  }))}
                  height={h}
                  label={t("desktop.craft.metrics.daily.turns")}
                  format={countText}
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-ui-sm text-text-tertiary">
                    {t("desktop.craft.metrics.daily.decisions")}
                  </span>
                  <Legend series={decisionSeries()} />
                </div>
                <Columns
                  series={decisionSeries()}
                  points={points.map((p) => ({
                    id: p.day,
                    tick: dayTick(p.day, false),
                    title: dayTick(p.day, true),
                    parts: [
                      { series: "blocked", value: p.blocked ?? 0 },
                      { series: "asked", value: p.asked ?? 0 },
                    ],
                  }))}
                  height={Math.round(h * 0.8)}
                  label={t("desktop.craft.metrics.daily.decisions")}
                  format={countText}
                />
              </div>
            </div>
          );
        }}
      </Gate>
    </Section>
  );
}

// ───────── 버전 전후 ─────────

const COMPARE_WORD: Readonly<Record<CompareMetric, MessageId>> = {
  "hook.outcomes.blocked": "desktop.craft.metrics.compare.blocked",
  "hook.outcomes.asked": "desktop.craft.metrics.compare.asked",
  "hook.fault_rate": "desktop.craft.metrics.compare.fault",
  "tool.error_rate": "desktop.craft.metrics.compare.toolError",
  "cost.always": "desktop.craft.metrics.compare.always",
};

function compareFormat(metric: CompareMetric): (v: number) => string {
  return metric === "cost.always" ? tokensText : percentText;
}

function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 7);
}

type CompareState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "single" }
  | { readonly kind: "failed"; readonly unsupported: boolean }
  | {
      readonly kind: "ready";
      readonly a: PluginVersionRow;
      readonly b: PluginVersionRow;
      readonly result: MetricsQueryResult;
    };

export function CompareSection(props: { readonly data: MetricsData }): ReactNode {
  const plugins =
    props.data.plugins.kind === "ready"
      ? pluginRowsOf(props.data.plugins.value).map((r) => r.plugin)
      : [];
  const [picked, setPicked] = useState<string | null>(null);
  const plugin = picked !== null && plugins.includes(picked) ? picked : (plugins[0] ?? null);
  const actions = props.data.actions;
  const live = props.data.link === "live";
  // 읽은 결과는 그 플러그인·거르기(= `actions`)의 것일 때만 쓴다. 아니면 읽는 중이다
  const [slot, setSlot] = useState<{
    readonly plugin: string;
    readonly actions: MetricsActions;
    readonly state: CompareState;
  } | null>(null);
  useEffect(() => {
    if (plugin === null || !live) return undefined;
    let active = true;
    const settle = (state: CompareState): void => {
      if (active) setSlot({ plugin, actions, state });
    };
    const run = async (): Promise<void> => {
      const versions = await actions.versions(plugin);
      if (!versions.ok) {
        settle({ kind: "failed", unsupported: versions.error.kind === "unsupported" });
        return;
      }
      const sorted = versions.value.toSorted((x, y) => y.approvedAt.localeCompare(x.approvedAt));
      const b = sorted.find((v) => v.current) ?? sorted[0];
      const a = sorted.find((v) => v !== b);
      if (a === undefined || b === undefined) {
        settle({ kind: "single" });
        return;
      }
      const result = await actions.compare(plugin, a.hash, b.hash);
      settle(
        result.ok
          ? { kind: "ready", a, b, result: result.value }
          : { kind: "failed", unsupported: result.error.kind === "unsupported" },
      );
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [plugin, live, actions]);
  const state: CompareState =
    plugin === null
      ? { kind: "idle" }
      : slot !== null && slot.plugin === plugin && slot.actions === actions
        ? slot.state
        : { kind: "loading" };

  return (
    <Section
      id="cm-compare"
      title={t("desktop.craft.metrics.compare.title")}
      info={t("desktop.craft.metrics.compare.info")}
      actions={
        plugins.length === 0 ? undefined : (
          <Select
            size="xs"
            variant="soft"
            aria-label={t("desktop.craft.metrics.compare.pick")}
            value={plugin ?? ""}
            onValueChange={setPicked}
            className="w-52"
          >
            {plugins.map((name) => (
              <SelectOption key={name} value={name}>
                {name}
              </SelectOption>
            ))}
          </Select>
        )
      }
    >
      <CompareBody state={state} />
    </Section>
  );
}

function CompareBody(props: { readonly state: CompareState }): ReactNode {
  const s = props.state;
  switch (s.kind) {
    case "idle":
      return (
        <div className="flex min-h-12 items-center rounded-xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
          {t("desktop.craft.metrics.compare.noPlugins")}
        </div>
      );
    case "loading":
      return <LoadingBlock height={120} label={t("desktop.craft.metrics.compare.title")} />;
    case "single":
      return (
        <div className="flex min-h-12 items-center rounded-xl border border-dashed border-border-default px-4 text-ui text-text-secondary">
          {t("desktop.craft.metrics.compare.single")}
        </div>
      );
    case "failed":
      return <LoadProblem kind={s.unsupported ? "unsupported" : "error"} />;
    case "ready": {
      const [left, right] = s.result.rows;
      const confounded = s.result.notes.some((n) => n.code === "confounded");
      const partial = s.result.notes.some((n) => n.code === "partial_window");
      return (
        <Card>
          <PairBars
            label={t("desktop.craft.metrics.compare.title")}
            aLabel={t("desktop.craft.metrics.compare.before", { v: shortHash(s.a.hash) })}
            bLabel={t("desktop.craft.metrics.compare.after", { v: shortHash(s.b.hash) })}
            rows={COMPARE_METRICS.map((metric) => {
              const a = cellOf(left?.values[metric]);
              const b = cellOf(right?.values[metric]);
              const fmt = compareFormat(metric);
              return {
                id: metric,
                label: t(COMPARE_WORD[metric]),
                a: valueOf(a),
                b: valueOf(b),
                aText: cellText(a, fmt),
                bText: cellText(b, fmt),
              };
            })}
          />
          {confounded ? (
            <p role="note" className="text-ui-sm text-warning-text">
              {t("desktop.craft.metrics.compare.confounded")}
            </p>
          ) : null}
          {partial ? (
            <p className="text-ui-sm text-text-tertiary">
              {t("desktop.craft.metrics.compare.partial")}
            </p>
          ) : null}
        </Card>
      );
    }
    default:
      return assertNever(s, "CompareState");
  }
}

// ───────── 머리 숫자 ─────────

/** 판 나의 머리 줄: 기록된 턴, 턴당 컨텍스트, 막음, 물음, 지침이 있는데도 막음 */
export function KpiStrip(props: { readonly data: MetricsData }): ReactNode {
  const d = props.data;
  if (d.plugins.kind !== "ready" || d.daily.kind !== "ready") {
    return <LoadingBlock height={64} label={t("desktop.craft.metrics.kpi.label")} />;
  }
  const rows = pluginRowsOf(d.plugins.value);
  const turns = dailyOf(d.daily.value).reduce((s, p) => s + p.turns, 0);
  const sum = (pick: (r: PluginRow) => Cell): Cell => {
    const known = rows.map(pick).filter((c) => c.kind === "value");
    if (known.length === 0) return rows.map(pick)[0] ?? { kind: "absent", reason: null };
    const partial = known.length < rows.length;
    return {
      kind: "value",
      value: known.reduce((s, c) => s + (valueOf(c) ?? 0), 0),
      approx: partial,
      n: 0,
    };
  };
  const context = contextOf(rows);
  const cells: readonly {
    readonly id: string;
    readonly label: string;
    readonly cell: Cell;
    readonly fmt: (v: number) => string;
    readonly info?: string;
  }[] = [
    {
      id: "turns",
      label: t("desktop.craft.metrics.kpi.turns"),
      cell: { kind: "value", value: turns, approx: false, n: turns },
      fmt: countText,
    },
    {
      id: "context",
      label: t("desktop.craft.metrics.kpi.context"),
      cell:
        context.slices.length === 0
          ? { kind: "sample", n: 0 }
          : { kind: "value", value: context.total, approx: true, n: 0 },
      fmt: tokensText,
    },
    {
      id: "blocked",
      label: t("desktop.craft.metrics.kpi.blocked"),
      cell: sum((r) => r.blocked),
      fmt: countText,
    },
    {
      id: "asked",
      label: t("desktop.craft.metrics.kpi.asked"),
      cell: sum((r) => r.asked),
      fmt: countText,
    },
    {
      id: "defied",
      label: t("desktop.craft.metrics.kpi.defied"),
      cell: sum((r) => r.defied),
      fmt: countText,
      info: t("desktop.craft.metrics.table.defiedInfo"),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border-subtle px-5 py-4 compact:grid-cols-5">
      {cells.map((c) => (
        <Stat
          key={c.id}
          label={c.label}
          value={cellText(c.cell, c.fmt)}
          muted={c.cell.kind !== "value"}
          {...(c.info === undefined ? {} : { info: c.info })}
        />
      ))}
    </div>
  );
}
