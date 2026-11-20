// 메트릭 화면(C9)의 순수 모델. 엔진 값(`MetricValue`)을 칸으로 바꾸고, 플러그인 표·컨텍스트 분해·날별 흐름·인사이트 묶음을 만든다.
// 규칙: 엔진이 값을 주지 않은 칸(`unavailable`, 행 없음)은 0이 아니라 "아직 기록되지 않음"이고, 표본이 적은 칸은 "표본 부족"이다(M5d 규칙 39).
// 테스트 런과 테스트 챗의 기록은 기본 범위에서 빠진다(M5d §4.6 규칙 33). 사용자가 켤 때만 범위에 든다.
import type {
  Finding,
  TurnSummary,
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
  /**
   * 좁혀 볼 플러그인. null이면 모든 플러그인. 플러그인 칸이 있는 값(컨텍스트, Hook 결정, 표, 인사이트)만 좁혀지고
   * 턴 수와 블록별 시간은 턴 전체의 값이다(엔진 카운터의 블록 칸에는 플러그인이 없다)
   */
  readonly plugin: string | null;
}

export const DEFAULT_FILTER: MetricsFilter = {
  days: 7,
  profileId: null,
  includeTests: false,
  plugin: null,
};

/** 일반 대화와 검토된 일회 덧씌우기. 엔진의 기본 범위와 같다 */
export const LIVE_SCOPES: readonly ScopeKind[] = ["live", "overlay_reviewed"];
/** 테스트 기록까지 */
export const ALL_SCOPES: readonly ScopeKind[] = [
  "live",
  "overlay_reviewed",
  "overlay_draft",
  "test",
  "craft",
];

export function isPeriod(value: number): value is PeriodDays {
  return PERIODS.some((p) => p === value);
}

/**
 * 화면의 거르기를 엔진의 거르기로 바꾼다. 범위는 늘 명시해 엔진 기본값이 바뀌어도 테스트 기록이 섞이지 않는다.
 * 플러그인 좁히기는 `withPlugin`이 참일 때만 싣는다(턴 수·블록별 시간은 턴 전체로 읽는다)
 */
export function metricFilterOf(filter: MetricsFilter, withPlugin = false): MetricFilter {
  return {
    period: { days: filter.days },
    scopes: [...(filter.includeTests ? ALL_SCOPES : LIVE_SCOPES)],
    ...(filter.profileId === null ? {} : { profileId: filter.profileId }),
    ...(withPlugin && filter.plugin !== null ? { plugin: filter.plugin } : {}),
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
  modified: "hook.outcomes.modified",
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
  readonly modified: number | null;
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
    if (values === undefined) {
      return { day, turns: 0, calls: 0, blocked: 0, asked: 0, modified: 0 };
    }
    return {
      day,
      turns: values[DAILY_METRICS.turns]?.n ?? 0,
      calls: valueOf(cellOf(values[DAILY_METRICS.calls])),
      blocked: valueOf(countCellOf(values[DAILY_METRICS.blocked])),
      asked: valueOf(countCellOf(values[DAILY_METRICS.asked])),
      modified: valueOf(countCellOf(values[DAILY_METRICS.modified])),
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

// ───────── 최근 턴(트레이스로 가는 길) ─────────
// 엔진은 대화마다 턴 목록을 준다(`turnRecord.list { threadId }`). 모든 대화를 한 번에 보는 목록은 없다.
// 그래서 화면이 아는 대화 목록에서 기간 안에 움직인 대화를 최근 순으로 `RECENT_THREADS`개까지 골라 한 쪽씩 읽고 합친다.

/** 최근 턴을 읽을 대화 수와 대화마다 읽을 턴 수 */
const RECENT_THREADS = 12;
export const RECENT_PER_THREAD = 50;

export interface RecentTurn {
  readonly turn: TurnSummary;
  /** 대화 제목. 없으면 null(화면은 "제목 없는 대화") */
  readonly title: string | null;
}

/** 대화 후보. 화면의 대화 목록(`thread.list`)에서 온다 */
export interface ThreadCandidate {
  readonly threadId: string;
  readonly title: string | null;
  readonly updatedAt: number;
  readonly profileId: string | null;
  /** 테스트 런·테스트 챗 대화 */
  readonly test: boolean;
}

/** 기간 안에 움직였고 프로필·테스트 거르기에 맞는 대화. 최근 순이다 */
export function eligibleThreadsOf(
  threads: readonly ThreadCandidate[],
  filter: MetricsFilter,
  now: number,
): ThreadCandidate[] {
  const from = now - filter.days * DAY_MS;
  return threads
    .filter((th) => th.updatedAt >= from)
    .filter((th) => filter.includeTests || !th.test)
    .filter((th) => filter.profileId === null || th.profileId === filter.profileId)
    .toSorted((a, b) => b.updatedAt - a.updatedAt || a.threadId.localeCompare(b.threadId));
}

/** 읽을 대화: 맞는 대화 가운데 최근 `RECENT_THREADS`개 */
export function recentThreadsOf(
  threads: readonly ThreadCandidate[],
  filter: MetricsFilter,
  now: number,
): ThreadCandidate[] {
  return eligibleThreadsOf(threads, filter, now).slice(0, RECENT_THREADS);
}

/** 대화마다 읽은 턴을 합친다. 기간 밖과 다른 프로필의 턴은 빼고 최근 순이다 */
export function mergeRecent(
  pages: readonly { readonly title: string | null; readonly items: readonly TurnSummary[] }[],
  filter: MetricsFilter,
  now: number,
): RecentTurn[] {
  const from = now - filter.days * DAY_MS;
  return pages
    .flatMap((p) => p.items.map((turn) => ({ turn, title: p.title })))
    .filter((r) => r.turn.startedAt >= from)
    .filter((r) => filter.profileId === null || r.turn.profileId === filter.profileId)
    .toSorted(
      (a, b) => b.turn.startedAt - a.turn.startedAt || a.turn.turnId.localeCompare(b.turn.turnId),
    );
}

export function turnsOnDay(turns: readonly RecentTurn[], day: string): RecentTurn[] {
  return turns.filter((r) => dayKeyOf(r.turn.startedAt) === day);
}

/** 턴 요약의 결정 수(있는 그대로의 합). 막음은 의도한 막음만, 고장으로 막힌 것은 `fault`다 */
export interface RawDecisions {
  readonly blocked: number;
  readonly asked: number;
  readonly modified: number;
  readonly fault: number;
}

export function rawDecisionsOf(turns: readonly TurnSummary[]): RawDecisions {
  return turns.reduce<RawDecisions>(
    (acc, t) => ({
      blocked: acc.blocked + t.flags.blockedIntent,
      asked: acc.asked + t.flags.asked,
      modified: acc.modified + t.flags.modified,
      fault: acc.fault + t.flags.blockedFault + t.flags.timedOut + t.flags.failed,
    }),
    { blocked: 0, asked: 0, modified: 0, fault: 0 },
  );
}

/** 끊겼다 이어졌거나 기록이 모자란 턴(`complete: false`). 도는 턴(`open`)은 아직 모른다 */
export function isPartialTurn(turn: TurnSummary): boolean {
  return !turn.complete && turn.status !== "open";
}

/**
 * 날마다 읽은 턴이 그날 턴 전부인가. 메트릭의 그날 턴 수와 읽은 턴 수가 같으면 그날의 결정 수를 턴 요약의 합으로 보일 수 있다.
 * 메트릭이 그날 턴 수를 모르면(0) 덮었다고 보지 않는다
 */
export function coveredDays(
  daily: readonly DayPoint[],
  turns: readonly RecentTurn[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const r of turns) {
    const day = dayKeyOf(r.turn.startedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return new Set(
    daily.filter((p) => p.turns > 0 && (counts.get(p.day) ?? 0) >= p.turns).map((p) => p.day),
  );
}

// ───────── 표본 ─────────

/**
 * 기간 안에 모인 턴 수와 엔진의 최소 표본 수(설정 `x.operations.metrics.minSample`). 최소 표본을 못 읽었으면 null이다.
 * `short`는 비율·평균이 보이려면 더 모여야 할 턴 수(0이면 다 모였다)
 */
export interface SampleStatus {
  readonly turns: number;
  readonly min: number | null;
  readonly short: number | null;
}

export function sampleStatusOf(turns: number, min: number | null): SampleStatus {
  return { turns, min, short: min === null ? null : Math.max(0, min - turns) };
}
