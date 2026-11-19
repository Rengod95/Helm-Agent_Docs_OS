// 메트릭 화면(C9)의 순수 모델. 엔진 값(`MetricValue`)을 칸으로 바꾸고, 플러그인 표·컨텍스트 분해·날별 흐름·인사이트 묶음을 만든다.
// 규칙: 엔진이 값을 주지 않은 칸(`unavailable`, 행 없음)은 0이 아니라 "아직 기록되지 않음"이고, 표본이 적은 칸은 "표본 부족"이다(M5d 규칙 39).
// 테스트 런과 테스트 챗의 기록은 기본 범위에서 빠진다(M5d §4.6 규칙 33). 사용자가 켤 때만 범위에 든다.
import type {
  Finding,
  MetricFilter,
  MetricReason,
  MetricRow,
  MetricValue,
  MetricsQueryResult,
  ScopeKind,
} from "@fresnel/contracts/wire";

// ───────── 거르기 ─────────

export const PERIODS = [1, 7, 30] as const;
export type PeriodDays = (typeof PERIODS)[number];

export interface MetricsFilter {
  readonly days: PeriodDays;
  /** null이면 모든 프로필 */
  readonly profileId: string | null;
  /** 참이면 테스트 런·드래프트 덧씌우기·테스트 챗의 기록도 넣는다 */
  readonly includeTests: boolean;
}

export const DEFAULT_FILTER: MetricsFilter = { days: 7, profileId: null, includeTests: false };

/** 일반 대화와 검토된 일회 덧씌우기. 엔진의 기본 범위와 같다 */
const LIVE_SCOPES: readonly ScopeKind[] = ["live", "overlay_reviewed"];
/** 테스트 기록까지 */
const ALL_SCOPES: readonly ScopeKind[] = [
  "live",
  "overlay_reviewed",
  "overlay_draft",
  "test",
  "craft",
];

export function isPeriod(value: number): value is PeriodDays {
  return PERIODS.some((p) => p === value);
}

/** 화면의 거르기를 엔진의 거르기로 바꾼다. 범위는 늘 명시해 엔진 기본값이 바뀌어도 테스트 기록이 섞이지 않는다 */
export function metricFilterOf(filter: MetricsFilter): MetricFilter {
  return {
    period: { days: filter.days },
    scopes: [...(filter.includeTests ? ALL_SCOPES : LIVE_SCOPES)],
    ...(filter.profileId === null ? {} : { profileId: filter.profileId }),
  };
}

// ───────── 칸 ─────────

/**
 * 표의 칸 하나.
 * - `value`: 값이 있다. `approx`면 근사값이다
 * - `sample`: 표본이 적어 숫자를 내지 않는다(`n`은 지금 표본 수)
 * - `absent`: 엔진이 이 값을 주지 않는다. `reason`이 null이면 행 자체가 없다
 */
export type Cell =
  | { readonly kind: "value"; readonly value: number; readonly approx: boolean; readonly n: number }
  | { readonly kind: "sample"; readonly n: number }
  | { readonly kind: "absent"; readonly reason: MetricReason | null };

const ABSENT: Cell = { kind: "absent", reason: null };

export function cellOf(value: MetricValue | undefined): Cell {
  if (value === undefined) return ABSENT;
  if (value.state === "insufficient_sample") return { kind: "sample", n: value.n };
  if (value.state === "unavailable" || value.value === null) {
    return { kind: "absent", reason: value.reason ?? null };
  }
  return { kind: "value", value: value.value, approx: value.state === "approx", n: value.n };
}

/** 비율 값을 횟수로 되돌린다(값 × 분모). 분모가 없거나 값이 없으면 칸 그대로다 */
export function countCellOf(value: MetricValue | undefined): Cell {
  const cell = cellOf(value);
  if (cell.kind !== "value" || value?.denom === undefined) return cell;
  return { kind: "value", value: Math.round(cell.value * value.denom), approx: false, n: cell.n };
}

export function valueOf(cell: Cell): number | null {
  return cell.kind === "value" ? cell.value : null;
}

// ───────── 지표 묶음 ─────────

/** 플러그인 표가 읽는 지표(groupBy plugin) */
export const PLUGIN_METRICS = {
  always: "cost.always",
  drive: "cost.drive",
  onDemand: "cost.on_demand",
  hookRuns: "hook.runs",
  blocked: "hook.outcomes.blocked",
  asked: "hook.outcomes.asked",
  modified: "hook.outcomes.modified",
  fault: "hook.fault_rate",
  defied: "inst.defied_calls",
  calls: "tool.calls",
} as const;

/** 블록별 시간(턴 하나 평균, ms). 모델 호출 시간은 엔진이 아직 기록하지 않는다 */
export const BLOCK_TIME_METRICS = {
  total: "block.time_split",
  model: "block.time_split.model",
  tools: "block.time_split.tools",
  hook: "block.time_split.hook",
  ask: "block.time_split.ask",
  rest: "block.time_split.rest",
} as const;

/** 날별 흐름(groupBy day). 턴 수는 `block.time_split`의 표본 수다 */
export const DAILY_METRICS = {
  turns: "block.time_split",
  calls: "tool.calls",
  hookRuns: "hook.runs",
  blocked: "hook.outcomes.blocked",
  asked: "hook.outcomes.asked",
} as const;

/** 버전 전후 비교가 나란히 놓는 지표 */
export const COMPARE_METRICS = [
  "hook.outcomes.blocked",
  "hook.outcomes.asked",
  "hook.fault_rate",
  "tool.error_rate",
  "cost.always",
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export function metricIdsOf(table: Readonly<Record<string, string>>): string[] {
  return [...new Set(Object.values(table))];
}

// ───────── 플러그인 표 ─────────

export interface PluginRow {
  readonly plugin: string;
  readonly always: Cell;
  readonly drive: Cell;
  readonly onDemand: Cell;
  /** 아는 컨텍스트 값의 합(토큰/턴). 셋 다 값이 없으면 null */
  readonly context: number | null;
  readonly hookRuns: Cell;
  readonly blocked: Cell;
  readonly asked: Cell;
  readonly modified: Cell;
  readonly fault: Cell;
  readonly defied: Cell;
  readonly calls: Cell;
}

function sumKnown(cells: readonly Cell[]): number | null {
  const known = cells.map(valueOf).filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

function pluginRowOf(plugin: string, values: MetricRow["values"]): PluginRow {
  const always = cellOf(values[PLUGIN_METRICS.always]);
  const drive = cellOf(values[PLUGIN_METRICS.drive]);
  const onDemand = cellOf(values[PLUGIN_METRICS.onDemand]);
  return {
    plugin,
    always,
    drive,
    onDemand,
    context: sumKnown([always, drive, onDemand]),
    hookRuns: cellOf(values[PLUGIN_METRICS.hookRuns]),
    blocked: countCellOf(values[PLUGIN_METRICS.blocked]),
    asked: countCellOf(values[PLUGIN_METRICS.asked]),
    modified: countCellOf(values[PLUGIN_METRICS.modified]),
    fault: cellOf(values[PLUGIN_METRICS.fault]),
    defied: cellOf(values[PLUGIN_METRICS.defied]),
    calls: cellOf(values[PLUGIN_METRICS.calls]),
  };
}

/** 플러그인 표의 행. 컨텍스트를 많이 쓰는 순, 같으면 Hook을 많이 돈 순, 그다음 이름 순이다 */
export function pluginRowsOf(result: MetricsQueryResult): PluginRow[] {
  const rows = result.rows
    .map((row) => ({ plugin: row.key.plugin ?? "", values: row.values }))
    .filter((row) => row.plugin !== "")
    .map((row) => pluginRowOf(row.plugin, row.values));
  return rows.toSorted(
    (a, b) =>
      (b.context ?? -1) - (a.context ?? -1) ||
      (valueOf(b.hookRuns) ?? -1) - (valueOf(a.hookRuns) ?? -1) ||
      a.plugin.localeCompare(b.plugin),
  );
}

/** 표에서 정렬할 수 있는 열 */
export type PluginSort = "context" | "blocked" | "asked" | "defied" | "calls";

export function sortPluginRows(rows: readonly PluginRow[], by: PluginSort): PluginRow[] {
  if (by === "context") return [...rows];
  const key = (row: PluginRow): number => valueOf(row[by]) ?? -1;
  return rows.toSorted((a, b) => key(b) - key(a) || a.plugin.localeCompare(b.plugin));
}

// ───────── 컨텍스트 분해 ─────────

/** 컨텍스트의 세 갈래: 늘 실림(지침, 도구 정의), Drive가 실음, 필요할 때 실림(스킬 본문) */
export const CONTEXT_PARTS = ["always", "drive", "onDemand"] as const;
export type ContextPart = (typeof CONTEXT_PARTS)[number];

export interface ContextSlice {
  readonly plugin: string;
  readonly parts: Readonly<Record<ContextPart, number>>;
  readonly total: number;
}

export interface ContextBreakdown {
  /** 값이 있는 플러그인. 많이 쓰는 순 */
  readonly slices: readonly ContextSlice[];
  /** 갈래별 합 */
  readonly totals: Readonly<Record<ContextPart, number>>;
  readonly total: number;
  /** 값이 없는 플러그인(표본 부족 또는 기록 없음) */
  readonly missing: readonly string[];
}

export function contextOf(rows: readonly PluginRow[]): ContextBreakdown {
  const slices: ContextSlice[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    if (row.context === null) {
      missing.push(row.plugin);
      continue;
    }
    const parts = {
      always: valueOf(row.always) ?? 0,
      drive: valueOf(row.drive) ?? 0,
      onDemand: valueOf(row.onDemand) ?? 0,
    };
    slices.push({ plugin: row.plugin, parts, total: parts.always + parts.drive + parts.onDemand });
  }
  const sorted = slices.toSorted((a, b) => b.total - a.total || a.plugin.localeCompare(b.plugin));
  const totals = {
    always: sorted.reduce((s, x) => s + x.parts.always, 0),
    drive: sorted.reduce((s, x) => s + x.parts.drive, 0),
    onDemand: sorted.reduce((s, x) => s + x.parts.onDemand, 0),
  };
  return {
    slices: sorted,
    totals,
    total: totals.always + totals.drive + totals.onDemand,
    missing,
  };
}

/** 막대에 이름을 달 플러그인 수. 나머지는 "그 밖의 N개"로 접는다 */
export const CONTEXT_TOP = 6;

export interface FoldedSlices {
  readonly shown: readonly ContextSlice[];
  readonly rest: { readonly count: number; readonly total: number } | null;
}

export function foldSlices(slices: readonly ContextSlice[], top: number): FoldedSlices {
  if (slices.length <= top) return { shown: slices, rest: null };
  const rest = slices.slice(top);
  return {
    shown: slices.slice(0, top),
    rest: { count: rest.length, total: rest.reduce((s, x) => s + x.total, 0) },
  };
}

// ───────── 블록별 시간 ─────────

const TIME_BLOCKS = ["model", "tools", "hook", "ask", "rest"] as const;
export type TimeBlock = (typeof TIME_BLOCKS)[number];

export interface BlockTime {
  readonly total: Cell;
  readonly blocks: readonly { readonly block: TimeBlock; readonly cell: Cell }[];
}

export function blockTimeOf(result: MetricsQueryResult): BlockTime {
  const values = result.rows[0]?.values ?? {};
  return {
    total: cellOf(values[BLOCK_TIME_METRICS.total]),
    blocks: TIME_BLOCKS.map((block) => ({
      block,
      cell: cellOf(values[BLOCK_TIME_METRICS[block]]),
    })),
  };
}

// ───────── 날별 흐름 ─────────

export interface DayPoint {
  /** `YYYY-MM-DD`(UTC 날짜, 엔진의 `day` 차원) */
  readonly day: string;
  /** 그날 기록된 턴 수. 그날 행이 없으면 0이다(기록이 없었다) */
  readonly turns: number;
  readonly calls: number | null;
  readonly blocked: number | null;
  readonly asked: number | null;
}

const DAY_MS = 86_400_000;

export function dayKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 창(`window`)의 날마다 한 점. 엔진이 행을 주지 않은 날은 턴 0이다 */
export function dailyOf(result: MetricsQueryResult): DayPoint[] {
  const byDay = new Map<string, MetricRow["values"]>();
  for (const row of result.rows) {
    const day = row.key.day;
    if (day !== undefined) byDay.set(day, row.values);
  }
  const days: string[] = [];
  const start = Date.parse(`${dayKeyOf(result.window.from)}T00:00:00Z`);
  for (let at = start; at < result.window.to; at += DAY_MS) days.push(dayKeyOf(at));
  return days.map((day) => {
    const values = byDay.get(day);
    if (values === undefined) return { day, turns: 0, calls: 0, blocked: 0, asked: 0 };
    return {
      day,
      turns: values[DAILY_METRICS.turns]?.n ?? 0,
      calls: valueOf(cellOf(values[DAILY_METRICS.calls])),
      blocked: valueOf(countCellOf(values[DAILY_METRICS.blocked])),
      asked: valueOf(countCellOf(values[DAILY_METRICS.asked])),
    };
  });
}

// ───────── 인사이트 ─────────

const IMPACT_UNITS = ["tokens_per_turn", "hits", "turns"] as const;
export type ImpactUnit = (typeof IMPACT_UNITS)[number];

export interface InsightGroup {
  readonly unit: ImpactUnit;
  readonly items: readonly Finding[];
}

/** 단위별로 묶고 묶음 안은 영향이 큰 순이다. 빈 묶음은 뺀다 */
export function insightGroupsOf(findings: readonly Finding[]): InsightGroup[] {
  return IMPACT_UNITS.map((unit) => ({
    unit,
    items: findings
      .filter((f) => f.impact.unit === unit)
      .toSorted((a, b) => b.impact.value - a.impact.value || a.id.localeCompare(b.id)),
  })).filter((group) => group.items.length > 0);
}

/** 인사이트 하나가 화면에 보이는 숫자 근거. 값이 있는 것 먼저, 많아야 `limit`개 */
export function insightFiguresOf(
  finding: Finding,
  limit: number,
): readonly { readonly metric: string; readonly cell: Cell }[] {
  const all = Object.entries(finding.metrics).map(([metric, value]) => ({
    metric,
    cell: cellOf(value),
  }));
  return all
    .toSorted((a, b) => Number(b.cell.kind === "value") - Number(a.cell.kind === "value"))
    .slice(0, limit);
}
